---
author: flow-machine-draft
created_at: 2026-10-10T10:35:27.990Z
---
# 需求规格（Requirements）— 2026-10-10-session-turn-token-speed

## 功能需求

### FR-01: turn_completed SSE 事件携带 duration_api_ms（close_run_steps.py 从 AgentRun 既有列透传，None 亦如实下发）

close_run_steps 往 session channel 发布的 turn_completed 事件 payload **必须**携带
`duration_api_ms` 键，值直取 `AgentRun.duration_api_ms` 既有列（收尾时已由 daemon
结果元数据写入）；引擎未上报时值为 None，**必须**照实下发 null 不许省略键——消费方
（前端）以「键缺失 / null」统一视为无数据。

#### 场景：Claude 引擎轮收尾带 API 时长

- Given：一次交互轮正常收尾，daemon 结果元数据携带 `duration_api_ms=3900`，AgentRun 行已写入该列
- When：close_run_steps 发布 turn_completed 事件到 `agent_session:{id}` channel
- Then：payload 含 `"duration_api_ms": 3900`

#### 场景：无时长引擎轮收尾

- Given：一次交互轮收尾时 `AgentRun.duration_api_ms` 为 NULL（引擎未上报 / 旧数据）
- When：turn_completed 事件发布
- Then：payload 含 `"duration_api_ms": null`，不含其它新增键

### FR-02: GET /api/daemon/sessions/{id}/runs 的 SessionRunRead 增加 duration_api_ms 字段（from_attributes 直映，零查询改动），跑 pnpm gen:types 同步 api-types.ts 与 backend/openapi.json

`SessionRunRead` DTO **必须**新增 `duration_api_ms: int | None` 字段，经
`from_attributes` 直映 `AgentRun.duration_api_ms` 列（runs 查询零改动）；后端
schema 变更后**必须**在同一变更内运行 `pnpm gen:types`，使
`frontend/src/lib/api-types.ts` 与 `backend/openapi.json` 同步提交，类型不落后端。

#### 场景：历史轮读取

- Given：某历史 run 行 `duration_api_ms=12500`
- When：`GET /api/daemon/sessions/{id}/runs` 返回该 run
- Then：响应 JSON 该 run 条目含 `"duration_api_ms": 12500`；生成类型 `SessionRunRead` 出现同名可选字段

### FR-03: 前端会话面板轮尾两处（对话视图 RoundDivider meta、全部视图 TurnStatusBadge）在终态轮显示『N tok/s』：output_tokens ÷ duration_api_ms，格式化口径 ≥10 取整、<10 保留 1 位小数、负值钳 0

会话面板轮尾（对话视图 RoundDivider 的 meta 文本、全部视图 TurnStatusBadge）在轮
进入终态且 `outputTokens` 与 `apiDurationMs` 均可得、`apiDurationMs > 0` 时，**必须**
在既有 token 计数后追加『N tok/s』段（`N = outputTokens ÷ (apiDurationMs/1000)`，
格式化：≥10 四舍五入取整、<10 保留 1 位小数、负值钳 0——对齐 deepseek-harness
formatTokensPerSecond 口径）；速度段**必须**与 token 计数同色同级（辅助信息，
不抢正文视觉）。

#### 场景：终态轮显示速度

- Given：一轮已完成，`outputTokens=1250`、`apiDurationMs=12500`（=12.5s）
- When：轮尾渲染
- Then：meta 显示 `↑… ↓1,250 · 100 tok/s`

#### 场景：低速保留一位小数

- Given：终态轮 `outputTokens=31`、`apiDurationMs=10000`
- When：轮尾渲染
- Then：速度段显示 `3.1 tok/s`

### FR-04: 运行中轮 / 旧数据 / 无时长引擎（duration_api_ms 为空或非正）如实不显示速度，不伪造不降级

当轮处于非终态（running/pending/interrupting）、或 `apiDurationMs` 缺失/null/≤0、
或 `outputTokens` 为 null 时，轮尾**禁止**渲染速度段（不显示 0 tok/s、不显示占位
文案、不得用墙钟时长估速充数）——数据不可得即不显示。

#### 场景：运行中轮

- Given：一轮正在运行，实时 token 计数在涨，但 duration_api_ms 尚未产生
- When：轮尾渲染
- Then：只显示 `↑执行中… ↓执行中…` 既有形态，无速度段

#### 场景：老数据无时长

- Given：历史轮 outputTokens 有值但 duration_api_ms 为 null（旧 daemon 时代数据）
- When：轮尾渲染
- Then：只显示 token 计数，无速度段

### FR-05: page 与 dialog 两种面板模式、断线 resync 合成轮、历史回填（enrichDisplayTurns）路径均接线一致

`duration_api_ms` 的前端接线**必须**覆盖全部四条数据路径且口径一致：
page 模式与 dialog 模式的 onTurnCompleted 终态写入、断线 resync 的 run 快照合成
turn_completed 事件（dispatchRunSyns 透传）、page 模式历史回填
（enrichDisplayTurns ?? 链只补缺）；新建 turn（upsertTurn）**必须**初始化
`apiDurationMs` 字段，外部构造者（logsToTurns 等既有形状）不受影响（字段可选）。

#### 场景：断线重连合成终态

- Given：SSE 断线期间某轮收尾，重连 resync 从 run 快照合成 turn_completed
- When：合成事件分发到 onTurnCompleted
- Then：事件携带 `duration_api_ms`，轮尾速度与在线收到的终态轮显示一致

#### 场景：刷新后历史回看

- Given：页面刷新后 attach 历史 turn（实时值清零）
- When：enrichDisplayTurns 用 run 快照回填
- Then：历史轮同样显示速度段；turn 已有实时值时快照不覆盖（?? 链优先级不变）

### FR-06: 后端与前端相关测试通过（不跑全量）

本变更触及的后端测试文件与前端新增/既有相关测试**必须**全部通过；**禁止**运行
全量测试套件（CI 职责）。

#### 场景：相关测试绿

- When：运行本次修改涉及的 pytest 用例文件与前端 vitest 相关文件
- Then：全部通过，无因本变更引入的失败

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py「test_publishes_turn_completed_duration_api_ms」
FR-02: backend/app/modules/daemon/tests/test_session_runs_endpoint.py「test_returns_duration_api_ms_column」
FR-03: frontend/src/components/daemon/__tests__/turn-speed.test.ts「turnTokenSpeedText > 终态轮双值可得 → 返回 tok/s 文本」；frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx「终态轮双值可得 → token 计数后显示『· 100 tok/s』」「对话视图（RoundDivider meta）同样追加速度段」
FR-04: frontend/src/components/daemon/__tests__/turn-speed.test.ts「turnTokenSpeedText > 非终态/缺失不显示三连」；frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx「运行中轮不显示速度」「终态但缺 apiDurationMs → 不显示」
FR-05: frontend/src/lib/__tests__/daemon-session-stream-sync.test.ts「cursor：runs+logs 前置同步…（合成 turn_completed 透传 duration_api_ms 断言）」；page/dialog/enrich 接线面由 pnpm typecheck 编译门覆盖（SessionTurnView.apiDurationMs 可选字段 + 手工镜像 SessionRunRead 同步）
FR-06: backend 两测试文件 pytest（5+2 passed）+ frontend 相关 vitest 批（turn-speed 12 / 渲染 4 / 回归 33 passed）+ pnpm typecheck 零错
