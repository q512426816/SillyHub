---
author: qinyi
created_at: 2026-10-09 11:31:17
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-10-09-tombstone-conflict-root-fix

## 背景

2026-10-09 实证（docs/sillyspec/tombstone-conflict-per-sync-accounting.md）：sillyspec 仓因本地保留平台已删除变更 `changes/salv/` 的目录，每轮整树同步被防复活守卫（`backend/app/modules/platform_sync/service.py` `_change_key_deleted`）整批拒收，自 09-29 起攒下 91 条墓碑冲突记录、spec 镜像冻结。根因是三个机制缺口叠加：

1. **CLI 记账不归因**：纯墓碑拒收（版本冲突面为空）按「当轮同步标签」落 `spec-sync-conflict-<当轮变更>.json`（`src/spec-sync.js:636-657`），一个根因伪装成 N 个变更的冲突；该批变更归档后永远不会再以同名同步成功，`clearSpecConflictMarker`（`src/spec-sync.js:459`）永远轮不到清理 → 记录单调累积。
2. **前端不露根因**：冲突记录已含 `platform_deleted` 路径与「resolve 重推无效」note，backend `_upsert_sync_conflict`（`backend/app/modules/spec_workspace/service.py:1283`）也已把 `details_json.platform_deleted` 落进 spec_conflicts 注册表，但变更中心冲突行（`frontend/src/components/changes/platform-sync-section.tsx`）只读机器快照三字段，墓碑形态与版本冲突渲染无差别，「查看对比/裁决」入口对墓碑形态必然无效。
3. **平台删除无本机收敛**：daemon sillyspec 指令集只有 `resolve`/`ghost_cleanup` 两个 action（`sillyhub-daemon/src/sillyspec-manager.ts:1189`），平台删除变更后本机目录无人收敛，「平台删了、本地留着」的组合每轮必撞墓碑。

## 设计目标

- FR-01（缺陷①）：CLI 纯墓碑拒收按**被删变更**归因记账——一个被删变更一条记录；全绿同步时自动清除全部纯墓碑形态陈旧记录，杜绝 91 条式累积。
- FR-02（缺陷②）：前端冲突行识别墓碑形态（数据源=backend spec-conflicts 注册表，零心跳 schema 改动），露出「非版本冲突·平台已删除」根因与真凶变更名，隐藏无效裁决入口，提供「收敛本机目录」手动触发。
- FR-03（缺陷③）：平台删除变更时向绑定数据源机器下发 `tombstone_cleanup` 指令；daemon 把本机目录移入 `.sillyspec/.runtime/tombstone-quarantine/` 隔离区（移动不删除）并归档进度库行，回执走既有 `sillyspec_command_result` 链路。

## 非目标

- 不改防复活守卫本身（`_change_key_deleted` 拒收语义是 D-005@v1/D-006@v1 已固化的正确行为）。
- 不做墓碑自动清除通道以外的 manifest-heal 扩展（heal 端点已存在，`POST /spec-workspace/manifest-heal`）。
- 不改 daemon 心跳摘要 schema（`MachineSillySpecStatusRead` 的 pending_conflicts 三字段不动）——②走注册表直读，避免 model→openapi→api-types 四层透传。
- 不处理 daemon 自身的 spec-sync.ts 链路（daemon 推送撞墓碑仅记日志行，注册表已记录，前端可见即可）。
- 不做隔离区管理界面/自动过期清理（目录在 .runtime/ 下随 doctor/手工清理路径走）。

## 拆分判断

跨仓变更：主仓（backend+daemon+frontend 的 ②③）+ sillyspec 仓（① CLI 归因记账）。① 与 ②③ 无代码依赖（daemon 收敛是纯文件移动+doctor，不依赖 CLI 新版；②读的是 backend 注册表不是 CLI 记录格式），可独立交付独立验证，故按 local.yaml `repos: sillyspec` 注册分两段文件清单。不走批量模式：①属 CLI 仓自己的 dogfood 变更，须在该仓自己的流程里收口。

## 总体方案

### Phase 1 — sillyspec 仓（FR-01 归因记账）

`src/spec-sync.js` 纯墓碑分支（`realPaths.length === 0 && tombstoned.length > 0`）：

- 从 `body.platform_deleted` 路径剥被删变更名：`changes/<name>/…` 与归档区 `changes/archive/<name>/…` 两种前缀；剥不出的路径归入 `__unattributed__` 桶（防御，正常不出现）。
- 按**被删变更**落 `spec-sync-conflict-<被删变更>.json`（不再用当轮同步标签）：记录 `{ change, kind: 'tombstone', created_at（首见保持）, last_seen（本轮刷新）, platform_deleted: [该变更名下的路径], note }`；文件已存在则幂等合并（路径并集、created_at 不动）。
- 横幅单根因叙事：每个被删变更一行「变更 X 被平台删除墓碑拒收（N 路径，M 轮未消解）」。
- 全绿同步（`body.conflict` 假且无拒收）时新增清理：扫描 `.runtime/` 下全部 `spec-sync-conflict-*.json`，删除**纯墓碑形态**记录——判定式为 `conflicting_paths` 为空 **且** `platform_deleted` 非空（kind 无关：现行纯墓碑分支写的 `kind:'spec-tree'`〔`src/spec-sync.js:644`〕与新写的 `kind:'tombstone'` 均被此式覆盖，存量 91 条旧格式同样命中；混合形态 `conflicting_paths` 非空天然排除——现逻辑只按当轮 changeName 清，归档变更永远轮不到，正是累积机制缺口）。
- `src/progress/stage-machine.js` `_listPendingConflicts`：type 判定改为优先读记录 JSON 的 `kind`（`'tombstone'` → type `'tombstone'`），文件名前缀判定保留为兜底——`progress show`/daemon 摘要从而能区分墓碑形态。

### Phase 2 — 主仓 backend + daemon（FR-03 收敛指令）

- backend 新端点 `POST /machines/{instance_id}/sillyspec-tombstone-cleanup`（`machines.py`，同 `sillyspec-ghost-cleanup` 先例形态：RuntimeAdminUser + `_get_owned_instance` 归属校验 + `ensure_workspace_member` + fire-and-forget WS + 离线 504）：body `{workspace_id, change}`，`ws_hub.send_sillyspec_tombstone_cleanup(instance_id, change, workspace_id)`。
- backend `delete_change`（`backend/app/modules/change/service.py:334`）收敛环落墓碑后顺带下发：**时点钉死在主事务最终 commit 之后**（源码双 commit 结构 349/423 行，取 423 终 commit 后——消除「落墓碑后」歧义，防指令先于事务提交到达），查该 workspace 绑定的数据源机器（成员绑定 daemon_id），`send_sillyspec_tombstone_cleanup`；**fire-and-forget 失败仅记日志，不阻塞删除流程**（机器离线时的兜底=前端墓碑行「收敛本机目录」按钮手动补发，见 Phase 3）。
- daemon `daemon.ts` WS 分发加 `daemon:sillyspec_tombstone_cleanup`（change+workspace_id 必填校验，同 resolve 分发形态 7364-7378 行）；`sillyspec-manager.ts` 新执行器 `runTombstoneCleanup(change, workspaceId)`：
  1. `resolveWorkspaceRoot(workspaceId)` 定位根（未命中报 `workspace_root_unknown`，不回退单槽位——2026-09-09-conflict-root-workspace-scoping 既定语义）；
  2. 目录定位：活跃区 `changes/<name>/`，不存在则归档区 `changes/archive/<name>/`；两者都不在 → 幂等成功（回执 state=success，error 注明「目录已不在本地」）；
  3. `fs.rename` 移动到 `<根>/.sillyspec/.runtime/tombstone-quarantine/<name>-<yyyymmdd-HHmmss>/`（移动失败如跨盘/占用 → 失败回执带错误摘要）；
  4. 调 CLI `sillyspec doctor --cleanup-ghosts --confirm`（目录已移走，该行即 ghost，doctor 归档之；同 `runGhostCleanup` 1084-1105 行既有链路）；
  5. 回执 `_recordCommandOutcome('tombstone_cleanup', { change }, outcome)` → 心跳 `sillyspec_command_result`（action 联合类型加 `tombstone_cleanup`，backend model.py 155 行注释同步）。**收敛闭环走既有全绿关闭路径，心跳落槽不新增关闭逻辑**：目录隔离后下一轮同步不再撞墓碑 → 全绿时守卫 if/else 走 else 分支调 `_close_open_sync_conflicts` 自动把开放行置 resolved（`backend/app/modules/spec_workspace/service.py:2723-2725` 既有语义，注释「全绿 → 自动把开放行置 resolved」）。不选「心跳处理顺带关行」的原因（增量复审 P1 实锤）：① 心跳结果槽载荷无 workspace_id（heartbeat.py:168-177），backend 无法定位目标工作区；② spec_conflicts 开放行是 workspace+stage 聚合单行，单变更收敛即整行 resolved 会过早关掉行内其他未决真版本冲突——依赖全绿关闭两个缺口都不存在，且与既有闭环职责零重叠。
- **不硬删**：隔离区在同步树外（walkSpecTree 不扫 `.runtime/`）、不进 git，用户可随时手工取回。

### Phase 3 — 主仓 frontend（FR-02 墓碑行三态）

`platform-sync-section.tsx` 冲突行数据源改双源 join：

- 注册表侧：复用既有 `listSpecConflicts`（`frontend/src/lib/spec-workspaces.ts:335`，60s 轮询先例同 banner，调用带 `status=open` 过滤）拿开放行；**墓碑形态判定谓词**：`details_json.platform_deleted` 非空 **且** `conflicting_paths ∖ platform_deleted` 为空（注册表行 conflicting_paths 是 server_versions ∪ platform_deleted 并集〔`backend/app/modules/spec_workspace/service.py:1311`〕——混合行〔真版本冲突+墓碑路径〕的 platform_deleted 也非空，单看非空会把混合行整体判成墓碑、错 hide 有效裁决入口；差集为空才是纯墓碑行，与 CLI 侧 R-04 口径对齐）；按被删变更名（platform_deleted 路径剥名，同 Phase 1 规则）建墓碑索引。混合行走现有版本冲突渲染（墓碑路径部分在对比弹窗内提示，不在本变更范围）。
- 快照侧行 join：机器快照 `pending_conflicts[]` 行的 change 命中墓碑索引，或快照行 type 为 `tombstone`（Phase 1 透传）→ 渲染墓碑形态行：徽章「平台已删」（error token）、正文=被删变更名、note 说明非版本冲突·裁决无效；**隐藏**「查看对比」按钮（compare 读不到有效 spec 树差）；新增「收敛本机目录」按钮（权限同裁决=access.canOperate，调 Phase 2 新端点，回显复用既有 pendingMap/waiting/succeeded/timeout 链路，`matchesCommandResult` 加 tombstone_cleanup 分支）。
- 注册表墓碑行若快照侧没有对应行（CLI 已清但注册表未关，或反之）——以注册表为准渲染墓碑行（计数并入「未决冲突」总数），快照独有行维持现状渲染。三态视觉基准=本变更 prototype-tombstone-conflict-row.html。

## 文件变更清单

（主仓，段头前 = main）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/router/machines.py | 新增 `POST /machines/{instance_id}/sillyspec-tombstone-cleanup` 端点（同 ghost-cleanup 先例：归属校验+成员校验+WS fire-and-forget+离线 504） |
| 修改 | backend/app/modules/daemon/ws_hub.py | 新增 `send_sillyspec_tombstone_cleanup(instance_id, change, workspace_id)`（同 send_sillyspec_resolve 428 行形态） |
| 修改 | backend/app/modules/daemon/model.py | `MachineSillySpecCommandResultRead.action` 联合类型加 `tombstone_cleanup`（producer=daemon 回执 → 心跳 heartbeat 落槽 → consumer=前端 matchesCommandResult） |
| 修改 | backend/app/modules/daemon/router/heartbeat.py | sillyspec_command_result 落槽对 action='tombstone_cleanup' 的透传（不新增关闭逻辑——收敛闭环走既有全绿关闭路径，见 Phase 2 第 5 步；producer=daemon 回执 → consumer=前端回显） |
| 修改 | backend/app/modules/change/service.py | `delete_change` 收敛环落墓碑后查绑定数据源机器并 fire-and-forget 下发（失败仅日志） |
| 修改 | backend/app/modules/daemon/schema.py | 新端点请求体 `MachineSillySpecTombstoneCleanupRequest{workspace_id, change}`（若无独立 schema 文件则以实际模块结构为准） |
| 修改 | sillyhub-daemon/src/daemon.ts | WS 分发 `daemon:sillyspec_tombstone_cleanup`（change/workspace_id 必填校验 + executor 调用，同 7364-7483 行 resolve/ghost 形态） |
| 修改 | sillyhub-daemon/src/sillyspec-manager.ts | 新执行器 `runTombstoneCleanup(change, workspaceId)`：根解析→目录定位→隔离区移动→doctor 归档→回执（action='tombstone_cleanup'） |
| 修改 | sillyhub-daemon/src/api-types.ts | `pnpm gen:types` 重生成（新端点+action 枚举） |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 重生成（同上） |
| 修改 | frontend/src/lib/daemon/machines.ts | 新增 `triggerMachineSillySpecTombstoneCleanup(instanceId, {workspace_id, change})` 封装（同 triggerMachineSillySpecGhostCleanup 先例） |
| 修改 | frontend/src/components/changes/platform-sync-section.tsx | 冲突行双源 join+墓碑形态渲染+收敛按钮+回显登记（matchesCommandResult 加 tombstone_cleanup 分支） |
| 修改 | frontend/src/components/changes/__tests__/platform-sync-section.test.tsx | 墓碑行渲染/按钮权限/回显用例（既有测试文件扩展） |
| 新增 | NEW:backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py | 端点权限/离线 504/透传用例 |
| 新增 | NEW:sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts | runTombstoneCleanup 执行器用例（幂等/跨区定位/移动失败/回执） |

## sillyspec 仓变更

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | src/spec-sync.js | 纯墓碑分支归因记账（按被删变更落文件+幂等合并+kind='tombstone'）；全绿同步清全部 tombstone 陈旧记录；横幅单根因叙事 |
| 修改 | src/progress/stage-machine.js | `_listPendingConflicts` type 判定优先读记录 kind（'tombstone'），文件名前缀兜底（producer=spec-sync.js 记录 → consumer=progress show --json → daemon 摘要 pending_conflicts[].type） |
| 修改 | test/spec-sync-platform-deleted-receipt.test.mjs | 既有 2 用例扩展：归因文件名/幂等合并/全绿清理 |
| 新增 | NEW:test/spec-sync-tombstone-attribution.test.mjs | 归因记账矩阵用例（多路径剥名/归档区前缀/unattributed 桶/混合形态不误清） |
| 修改 | docs/sillyspec/file-lifecycle.md | 运行时文件类型变更登记（冲突记录归因形态+全绿清理语义+updated_at 批次头）——task-05 constraints 按该仓「文件生命周期文档同步」规则要求 |

## 接口定义

- `POST /api/daemon/machines/{instance_id}/sillyspec-tombstone-cleanup` — body `MachineSillySpecTombstoneCleanupRequest {workspace_id: UUID, change: str}`；resp `{"sent": true}`；404/403/504 同 sillyspec-ghost-cleanup；权限 RuntimeAdminUser+owner。
- WS 消息 `daemon:sillyspec_tombstone_cleanup` — payload `{change: string, workspace_id: string}`（对齐 send_sillyspec_resolve 透传形态）。
- daemon 执行器 `runTombstoneCleanup(change: string, workspaceId: string): Promise<void>`。
- 回执 action 联合类型：`'resolve' | 'ghost_cleanup' | 'tombstone_cleanup'`（identify 携带 change）。
- CLI 记录结构（sillyspec 仓）：`{change, kind:'tombstone', created_at, last_seen, platform_deleted: string[], note}`。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 下发 tombstone_cleanup（删除环自动） | backend delete_change | daemon | instance_id, change, workspace_id | 本机 changes/<name>/ → 隔离区；进度库行 → ghost 归档 |
| 下发 tombstone_cleanup（前端按钮） | frontend | backend → daemon | workspace_id, change | 同上 |
| 回执 sillyspec_command_result | daemon 心跳 | backend | action='tombstone_cleanup', change, state, exit_code | 结果槽 latest-wins 更新；注册表开放行由后续全绿同步既有路径关闭（收敛→隔离→全绿→resolved，非心跳即时关） |
| 归因记账落盘 | CLI spec-sync | 本地 .runtime | change, kind='tombstone', platform_deleted | 无服务器状态变化（本地文件） |
| 全绿清理 | CLI spec-sync | 本地 .runtime | （无额外字段） | tombstone 记录文件删除 |

（表中五事件对应任务：端点/下发/执行器/回执在主仓 task 覆盖，CLI 两行在 sillyspec 仓 task 覆盖。）

## 数据模型

无表结构变更。spec_conflicts 注册表 `details_json.platform_deleted` 字段已存在（`_upsert_sync_conflict`），本变更只做读侧消费。

## 兼容策略（brownfield 必填）

- 旧 daemon（不识别 `daemon:sillyspec_tombstone_cleanup`）：静默忽略——删除环下发无回执仅日志；前端按钮走既有 150s 超时回显恢复（R-03 同款兜底），重试无副作用（执行器幂等：目录不在=成功）。
- 旧 CLI（无归因记账）：行为=现状（按当轮标签记账），不阻塞 ②③；升级后存量旧格式记录由全绿清理收编——判定式（`conflicting_paths` 空 + `platform_deleted` 非空，kind 无关）对现行 `kind:'spec-tree'` 纯墓碑记录与存量 91 条同样命中，防残留复发后无法自清。
- 未删除任何变更时：端点/指令/按钮均不触发，前端渲染与现状一致（join 无命中走原路径）。
- 回退路径：墓碑形态渲染异常时前端 join 判定收紧为仅快照 type==='tombstone'（Phase 1 数据）也可工作；③ 指令不下发不影响任何现有功能（纯增量）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | daemon 隔离区移动跨盘/文件占用失败 | P2 | rename 失败回执带错误摘要；用户关闭占用进程后重试（幂等）；隔离区在 .runtime/ 内同盘，跨盘实际不可达 |
| R-02 | 删除环下发时机器离线，本机目录残留 | P1 | 前端墓碑行「收敛本机目录」手动补发（双通道兜底）；CLI 撞墓碑时注册表持续可见 |
| R-03 | 前端双源 join 口径不一致（注册表行与快照行时间差） | P2 | 以注册表为准渲染墓碑行；心跳 15s+采集 ≤75s+注册表 60s 轮询，最终一致窗口 <2.5min；收敛成功后注册表行关闭依赖下一轮全绿同步（窗口=一个同步周期，期间墓碑行可能短暂保留但目录已隔离无实害） |
| R-04 | 全绿清理误删混合形态记录（既有版本冲突又有墓碑路径） | P1 | 清理判定=`conflicting_paths` 为空且 `platform_deleted` 非空（kind 无关）——混合形态（conflicting_paths 非空）永不清理；现行 `kind:'spec-tree'` 旧格式与存量 91 条均被此式覆盖（归因记账只处理纯墓碑分支） |
| R-05 | 平台删除→指令下发→本机收敛链路中，用户同时在本地编辑该变更目录 | P2 | 移动是原子 rename；编辑器句柄占用导致 rename 失败走失败回执+重试，无数据丢失（不硬删） |
| R-06 | `__unattributed__` 桶路径（platform_deleted 剥不出变更名） | P2 | 正常不出现（守卫只对 changes/ 前缀写墓碑）；出现时并入单条聚合记录+note 提示人工核查 |
| 无长驻进程/外部资源 | 生命周期面 | — | 本变更不引入长驻进程/后台任务/外部资源持有；指令执行器为一次性命令执行（execFile+fs.rename，自灭） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-01/FR-02/FR-03 范围界定 + 隔离区形态（总体方案 Phase 2 第 3 步、R-05） | 已覆盖 |
| D-002@v1 | 架构=方案 A：②注册表直读（Phase 3 数据源）+③指令通道复用（Phase 2 端点/WS/回执全复用先例形态）；拒 B/C 理由见 decisions.md | 已覆盖 |

与 D-005@v1（知识库，镜像驱动收敛）关系：本变更是**本机磁盘收敛层**补充，不触碰平台镜像收敛环本身；拒「墓碑上行驱动」的裁定不受影响（①只改本地记账，不上行）。无组合约束（本变更两裁定互不作用：范围裁定不约束架构裁定的实现自由度）。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001@v1、D-002@v1 均入决策追踪）
- [x] 生命周期契约表已含（涉及 daemon/heartbeat 关键词；五事件均有对应任务落点）
- [x] UI 原型分级核对（组件级变化·建议生成档 → prototype-tombstone-conflict-row.html 已产出）
- [x] 跨仓清单按 `## sillyspec 仓变更` 段头分段，段内路径相对各仓根，repo-key=sillyspec（local.yaml:307 已注册）
- [x] 字段数据流标注（action 枚举 / pending_conflicts[].type / platform_deleted 三条链路 producer→consumer 已交代）
- [x] NEW: 前缀核对（3 个新建文件均带前缀；frontend 测试文件标注「若无则 NEW:」——execute 前落实存在性）
- ⚠️ 自审存疑：`backend/app/modules/daemon/schema.py` 的实际文件位置以 execute 时模块结构为准（清单已注明）；删除环查绑定数据源机器的具体查询（成员绑定表）在 execute 时按现有 binding 模型实现，设计只锁「fire-and-forget+失败仅日志」语义。
