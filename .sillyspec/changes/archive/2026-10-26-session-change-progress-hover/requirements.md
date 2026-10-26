---
author: qinyi
created_at: 2026-10-26T13:52:00
---
# 需求规格（Requirements）— 2026-10-26-session-change-progress-hover

## 功能需求

### FR-01: 全量变更下拉项内嵌 5 阶段进度圈行

- ChangeSummary 新增 stage_progress（主线 5 阶段各：stage/status/steps_total/steps_completed/started_at/completed_at/duration_seconds/revision）；前端全量项渲染头脑风暴/计划/执行/验证/归档五圈横排：圈按 steps_completed/steps_total 占比填充、阶段 completed 打勾、圈下标耗时（已完成=completed−started，进行中=now−started）；异常态（waiting/blocked/revising/stale/failed）异色圈+状态字（D-002@v1）。

#### 场景：主路径

- Given latest_progress 含 stages（brainstorm=completed 3 步、plan=in-progress 2/4 步、execute/verify/archive=pending）
- When 会话关联变更列表返回
- Then stage_progress 五条；前端渲染 plan 圈半填充+时长字、brainstorm 打勾；plan 后续三圈空心

#### 场景：降级

- Given latest_progress 缺 steps 明细/字段畸形
- Then stage_progress=None，前端该项不渲染进度行（现状保底），不报错

### FR-02: execute 圈按 Task 表 n/m 展示任务进度

- execute 阶段圈旁展示 task_progress（tasks 表按 change_id 聚合：done 计分子、total 排除 cancelled 计分母），文案"n/m 任务"；不使用 Wave 步骤数（D-005@v1）。

#### 场景：主路径

- Given 变更有 12 个 task 行（8 done、1 cancelled、3 draft）
- When 列表返回
- Then task_progress={total: 11, done: 8}；前端 execute 圈显示"8/11 任务"

#### 场景：批量无 N+1

- Given 会话关联 5 个变更
- When enrich_summaries 执行
- Then tasks 聚合为单条 IN 查询（R-03/usage 同款断言模式）

### FR-03: 轻量变更下拉项内嵌 ①→②→③ 相位行

- daemon 采集 flow status --json，heartbeat sillyspec_status.thin_flows[] 上行；backend 归一 phase 四枚举（spec/awaiting_approval/executing/closing）落 change.stages["thin_flow"]；ChangeSummary.thin_flow 投影（phase/approved/autopilot/tasks_total/tasks_done/substeps_done/substeps_total=8/upgraded/adopted_from）。
- 前端轻量项渲染相位指示器（①spec→②执行→③归档，①含"待批准"子态高亮）+ 批准态徽标（已批准/autopilot 豁免/未批准）+ 执行阶段"任务 n/m"+ 收口阶段"子步 n/8"+ 总时长（created_at→updated_at 人性化格式，D-001@v1）。

#### 场景：主路径

- Given thin 变更 flow status：designFilled+frFilled+bindings 齐、spec_approved=true、tasks 4/12、substeps 空
- When heartbeat 携带 thin_flows 上行
- Then stages.thin_flow.phase='executing'、approved=true；前端 ② 高亮+"已批准"徽标+"任务 4/12"

#### 场景：收口阶段

- Given substeps 含 'ledger'（5 个 done）
- Then phase='closing'；前端 ③ 高亮+"子步 5/8"

#### 场景：降级

- Given 旧 daemon 无 thin_flows 键/CLI 无 flow 命令采集失败
- Then thin_flow=None；前端轻量项维持现状（徽标+"干活中"），不报错

### FR-04: 升厚与 brainstorm→thin 分流的渲染归属

- 升厚（upgraded=true）：显示"已升厚→走全量"标注并切换全量 5 圈渲染（D-007@v1）。
- brainstorm→thin 分流（adopted_from='brainstorm'）：归轻量 ①②③ 渲染 + "自头脑风暴转入"小字标注（D-006@v1）。

#### 场景：升厚切换

- Given thin 变更实测失败升厚（legacy_fallback=true，current_stage 已回阶段机值）
- Then 前端该项走全量渲染分支 + "已升厚"标注；thin_flow.upgraded=true 仍随行

#### 场景：分流标注

- Given is_thin=true 且 adopted_from='brainstorm'
- Then 轻量相位行渲染 + "自头脑风暴转入"小字

### FR-05: 入口旁单个总进度圈（最新进行中一个）

- 悬浮框"变更"按钮旁渲染单个总进度圆环+百分比，只取最新进行中——**前端显式按 updated_at 取 max 重排选取**（后端列表序是"未归档优先+created_at desc"，active[0] ≠ updated_at 最新，禁用列表序直接取首，D-013@v1）；全量口径=steps_completed/step_total，轻量口径=相位加权（spec=0.1, awaiting_approval=0.15, executing=0.33+0.34×tasks_done/max(tasks_total,1), closing=0.67+0.33×substeps_done/8）；数据缺失环不渲染（D-003@v1）。

#### 场景：多变更只显一个

- Given active 两个变更（列表序在前者 created_at 更新、后者 updated_at 更新）
- Then 仅渲染 updated_at 更新者的总圈（显式重排，不信列表序）

#### 场景：数据缺失

- Given 最新进行中变更无 step_progress/thin_flow
- Then 该圈不渲染，按钮与计数徽标不受影响

### FR-06: 数据链路三线落地（方案 A）

- backend：enrich_summaries 提取 stage_progress/thin_flow + Task 聚合（批量 IN、时钟注入保确定性）；heartbeat 消费 thin_flows（条目含 workspace_id）行锁事务归一落 stages JSON（坏条目/未匹配行单条丢弃整批不拒；不刷 changes.updated_at，D-014@v1）。
- daemon：flow status 采集（progress 同拍、三态矩阵、失败静默）；hub-client 载荷加 thin_flows（白名单字段）。
- frontend：api-types 再生成（pnpm gen:types + pnpm -C sillyhub-daemon gen:types 同 change 提交，CLAUDE.md 规则 21 双义务）。

#### 场景：heartbeat 坏条目

- Given thin_flows 含一条 phase 为空串的坏条目 + 一条好条目
- When backend 消费
- Then 好条目落库、坏条目丢弃，heartbeat 整体 200

#### 场景：采集失败

- Given sillyspec 版本过老无 flow 命令（exit 非零）
- Then 采集器三态矩阵 error 态静默，progress 采集与 heartbeat 其他载荷不受影响

### FR-07: 全链路 fail-open 兼容降级

- 全部新字段 optional default None；旧 daemon/存量 latest_progress/老 CLI 三类旧环境行为与现状一致（FR-01/03/05 各降级场景）；ChangeSummary 新字段对既有消费方 additive 无害。

#### 场景：旧 daemon

- Given daemon 未升级（heartbeat 无 thin_flows）
- Then 平台 thin_flow 不写不清；前端轻量项现状渲染

### FR-08: 计数徽标双色

- 悬浮框"变更"按钮计数徽标双态：active>0 蓝（**blue-* 固定阶真信息蓝，不随主题换肤**——semantic.info 两主题均为青不可用，D-012@v2）、active=0 保持绿色；呼吸动画逻辑不变。

#### 场景：双态断言

- Given active=2 → 徽标 blue 固定阶 class；active=0（仅归档）→ 绿色 class；running 呼吸动画条件不变

## 非功能需求

- NFR-01: 投影提取全路径 try/except fail-open（R-01），畸形 latest_progress 不阻塞列表响应。
- NFR-02: 前端色阶走主题语义 token，blue/ai-native 双主题下无裸 hex（R-05）；圈/环 aria-label 文本化进度。
- NFR-03: 只跑本变更聚焦测试（CLAUDE.md 规则 0），三端既有测试零回归。

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: backend/app/modules/change/tests/test_progress_projection_ext.py「stage_progress 主路径五阶段计数与耗时」「畸形 latest_progress fail-open 返回 None」+ frontend/src/components/daemon/__tests__/change-progress-row.test.tsx「全量五圈占比/打勾/耗时渲染」
FR-02: backend/app/modules/change/tests/test_progress_projection_ext.py「task_progress 聚合排除 cancelled」「批量聚合单条 IN 查询无 N+1」+ frontend/src/components/daemon/__tests__/change-progress-row.test.tsx「execute 圈任务 n/m 文案」
FR-03: backend/app/modules/daemon/tests/test_heartbeat_thin_flows.py「thin_flows 归一落库 executing/closing」「坏条目单条丢弃整批不拒」+ sillyhub-daemon/src/__tests__/sillyspec-flow-status-collector.test.ts「flow status 采集三态」+ frontend/src/components/daemon/__tests__/change-progress-row.test.tsx「轻量相位行/批准徽标/任务与子步计数」
FR-04: frontend/src/components/daemon/__tests__/change-progress-row.test.tsx「升厚切全量渲染+标注」「分流 adopted_from 轻量渲染+转入标注」
FR-05: frontend/src/components/daemon/__tests__/change-total-progress-ring.test.tsx「多变更 updated_at 显式重排取最新」「全量 steps 比口径」「轻量相位加权口径」「数据缺失环不渲染」
FR-06: backend/app/modules/daemon/tests/test_heartbeat_thin_flows.py「workspace_id 定位写入不刷 updated_at」+ sillyhub-daemon/src/__tests__/sillyspec-flow-status-collector.test.ts「CLI 缺 flow 命令失败静默」
FR-07: backend/app/modules/change/tests/test_progress_projection_ext.py「旧形态 latest_progress（无 steps）stage_progress=None」+ frontend/src/components/daemon/__tests__/change-progress-row.test.tsx「thin_flow 缺失降级现状渲染」
FR-08: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx「计数徽标 active>0 蓝/active=0 绿双态」

## 决策覆盖矩阵

| 决策 | 覆盖 FR | 备注 |
|---|---|---|
| D-001@v1 | FR-03 | 轻量总时长口径 |
| D-002@v1 | FR-01 | 异常态异色圈+状态字 |
| D-003@v1 | FR-05 | 入口单个总进度圈 |
| D-004@v1 | FR-06 | 方案 A 数据链路（B/C 落选见 D-010/D-011） |
| D-005@v1 | FR-02 | execute 圈 Task 表口径 |
| D-006@v1 | FR-04 | 分流态归轻量渲染 |
| D-007@v1 | FR-04 | 升厚切全量渲染 |
| D-008@v2 | FR-03/FR-06 | 轻量通道+workspace_id+行锁写入（supersedes D-008@v1） |
| D-009@v1 | FR-01/FR-03 | 归档项不渲染进度（非目标节） |
| D-010@v1 | —（rejected 存档） | 方案 B 落选 |
| D-011@v1 | —（rejected 存档） | 方案 C 落选 |
| D-012@v2 | FR-08 | 徽标蓝=blue 固定阶（supersedes D-012@v1） |
| D-013@v1 | FR-05 | 入口圈显式 updated_at 重排 |
| D-014@v1 | FR-05/FR-06 | heartbeat 写入不刷 updated_at |
