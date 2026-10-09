---
author: qinyi
created_at: 2026-10-09 11:39:02
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户（机器所有者/管理员） | 在变更中心查看同步冲突、触发收敛/裁决操作 |
| daemon（数据源机器） | 接收并执行 tombstone_cleanup 指令，回传结果 |
| sillyspec CLI | 本地归因记账、陈旧记录清理、进度总览透传 |

## 功能需求

### FR-01: 纯墓碑冲突按被删变更归因记账并自动清理（sillyspec CLI 仓）

覆盖决策：D-001@v1, D-002@v1

#### 场景：纯墓碑拒收归因落盘
Given 本地存在平台已删除变更 `<X>` 的目录路径，CLI 同步收到纯墓碑拒收（版本冲突面为空、`platform_deleted` 非空）
When CLI 落冲突记录
Then 记录文件为 `spec-sync-conflict-<X>.json`（按被删变更名，非当轮同步标签），内容含 `kind:'tombstone'`、`platform_deleted` 路径清单、`created_at`（首见保持）与 `last_seen`（每轮刷新）；同一被删变更多轮拒收只维护同一条记录（路径并集幂等合并）

#### 场景：归档区路径剥名
When `platform_deleted` 路径含归档区前缀 `changes/archive/<X>/…`
Then 同样归因到变更 `<X>`；剥不出变更名的路径归入 `__unattributed__` 聚合记录

#### 场景：全绿同步清陈旧墓碑记录
Given `.runtime/` 下存在纯墓碑形态记录（`conflicting_paths` 为空且 `platform_deleted` 非空——kind 无关，涵盖新 `kind:'tombstone'`、现行 `kind:'spec-tree'` 纯墓碑与存量旧格式）
When 本轮同步全绿（无冲突无拒收）
Then 全部纯墓碑形态记录被删除；混合形态记录（`conflicting_paths` 非空）不受影响

#### 场景：进度总览透传墓碑形态
When `sillyspec progress show --json` 列出未决冲突
Then 墓碑记录的 `type` 为 `'tombstone'`（优先读记录 `kind` 字段，文件名前缀判定保留兜底）

### FR-02: 前端冲突行识别墓碑形态并露出根因

覆盖决策：D-001@v1, D-002@v1

#### 场景：墓碑行渲染
Given backend spec-conflicts 注册表开放行（status=open）满足纯墓碑判定——`details_json.platform_deleted` 非空且 `conflicting_paths ∖ platform_deleted` 为空（混合行走版本冲突渲染，不隐藏其裁决入口）
When 变更中心「平台同步」卡渲染冲突行
Then 该行显示「平台已删」徽章（error 语义色）+ 被删变更名（真凶）+ 非版本冲突说明（裁决无效+恢复指引），**不显示**「查看对比」与裁决入口；数据源为注册表直读（心跳 schema 零改动）

#### 场景：普通版本冲突行不变
Given 冲突行未命中墓碑判定
When 渲染
Then 与现状渲染一致（type 徽章/名称/时间/查看对比/活跃警示）

#### 场景：收敛按钮与回显
Given 用户对墓碑行点「收敛本机目录」（权限=机器所有者/平台管理员，同裁决权限集）
When 后端下发 tombstone_cleanup 指令成功
Then 行内回显「已下发·等待机器回报」→ 心跳 `sillyspec_command_result`（action='tombstone_cleanup' 且 change 匹配）到达后转成功/失败态；150s 无回报恢复可重试（旧 daemon 兜底）

### FR-03: 平台删除变更时下发本机收敛指令

覆盖决策：D-001@v1, D-002@v1

#### 场景：删除环自动下发
Given 平台删除变更 `<X>`（墓碑落库完成）且该工作区有绑定数据源机器
When 删除流程收敛环执行
When' （补充）机器在线
Then 经 WS 通道下发 `daemon:sillyspec_tombstone_cleanup`（payload 含 change 与 workspace_id）；下发失败（含机器离线）仅记日志，**不阻塞删除流程**

#### 场景：daemon 执行器隔离区收敛
When daemon 收到 tombstone_cleanup 指令
Then 按 workspace_id 映射定位 spec 根（未命中报 `workspace_root_unknown` 不回退单槽位）；把 `changes/<X>/`（不在则查归档区 `changes/archive/<X>/`）移动到 `<根>/.sillyspec/.runtime/tombstone-quarantine/<X>-<时间戳>/`（移动不删除）；随后执行 `sillyspec doctor --cleanup-ghosts --confirm` 归档进度库行；回经心跳回执（action='tombstone_cleanup'，state=success/failed）

#### 场景：执行器幂等
When 指令重放/重试时本机目录已不在（已收敛或从未存在）
Then 回执 state=success，error 注明「目录已不在本地」，无副作用

## 非功能需求

- 兼容性：旧 daemon 静默忽略新 WS 消息（150s 回显超时兜底）；旧 CLI 存量记录被清理判定收编（无 kind 的旧格式按字段形态识别）；无墓碑时全链路行为与现状一致。
- 可回退：③ 指令通道纯增量（不下发不影响现有功能）；②渲染异常时 join 判定可收紧为仅快照 type 判定。
- 可测试：daemon 执行器（幂等/跨区定位/移动失败）、backend 端点（权限/离线 504/透传）、前端（三态渲染/回显）、CLI（归因矩阵/清理判定）各有独立测试面。
- 安全：收敛只做目录移动（同盘 rename 原子性），不硬删；隔离区在 `.runtime/`（同步树外、不进 git）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-03 | 范围三件全做+隔离区不硬删形态 |
| D-002@v1 | FR-01, FR-02, FR-03 | 方案 A：注册表直读+指令通道复用 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
