---
author: flow-machine-draft
created_at: 2026-10-13T01:07:19.831Z
---
# 需求规格（Requirements）— 2026-10-13-agent-task-stuck-running

## 功能需求

### FR-01: daemon 侧 task_notification 到达但内存注册表无对应条目时,不再静默丢弃:尽力归属到会话并照常上报终态事件,有日志可查

- 后台子代理「已完成但状态卡 running」的主根因是 tool_use 派生路径与 SDK 真帧路径的双 id 分裂：assistant `Task`/`Agent` tool_use 派生的 running 事件以 call id 冒充 task_id 且**不带 tool_use_id**（claude-events.ts `_toolUseSessionSignals`），backend 写侧幽灵收口（agent_task_store.py `_resolve_row_with_ghost_reconciliation`，依赖「事件携带 tool_use_id 且异于 task_id」）对冒名行永不生效，冒名行永卡 running。daemon **必须**在该派生事件的 metadata 补带 `tool_use_id`（值 = tool_use block 的 call id），使冒名行进入既有收口轨道。
- task_notification 终态到达时，除主 task_id 条目外，daemon **必须**扫描注册表将「task_id 不同但 toolUseId 相同」的别名条目一并注销；若主 task_id 条目不存在（task_started 帧丢失、注册表仅剩别名），**必须**为别名条目补发同状态终态事件并落 `[TASK_NOTIFICATION]` 行，保证别名侧前端卡片与时间线收敛；若主条目存在则仅静默注销（表侧归 backend 收口、SSE 归主路径，避免产生重复行）。
- 终态通知在注册表无任何可归属条目且无在跑 runId 时（三无场景），**禁止**再静默 return：**必须**输出含 sessionId/taskId/status/摘要的 WARN 级日志后跳过，保证「丢终态」可事后排查。

#### 场景：task_started 帧丢失、注册表仅剩 tool_use 派生的别名条目

- Given 某 `Task` tool_use（call id=T）已由 tool_use 派生路径注册别名条目（task_id=T，toolUseId=T），SDK `task_started` 帧丢失、真条目（task_id=K）从未注册；
- When 终态 `task_notification`（task_id=K，tool_use_id=T，status=completed）到达；
- Then daemon 为别名条目补发 `agent_task_status`（task_id=T，status=completed）事件并落 `[TASK_NOTIFICATION]` 行（parent_tool_use_id=T），注销别名条目；主 task_id K 不产生额外事件。

#### 场景：三无孤儿终态（注册表缺失且无在跑 runId）

- Given 注册表无该 task_id 条目、别名扫描无命中、`info.runId` 与 `state.currentRunId` 均空；
- When 终态 `task_notification` 到达；
- Then daemon 不落行、不 emit，但输出 WARN 日志（含 sessionId/taskId/status/summary 摘要），函数正常返回不抛错。

### FR-02: 前端时间线装配对找不到父段的 [TASK_NOTIFICATION] 终态行,按 task_id 兜底匹配既有子代理段吸收终态,派发段不再永久转圈

- 装配器解析 `[TASK_*]` 行时**必须**提取 payload 的 `task_id` 写入 task kind 产物（`SessionLogSegment.taskTaskId`），并在应用进派发 tool 段时持久为段元数据（`ToolTurnSegment.taskTaskId`），使段可被 task_id 反查。
- task 行按行级 `parent_tool_use_id` 路由未命中（含行缺失 parent 的形态）时，装配器**必须**按本行 `task_id` 在当前轮 segments 全树 DFS 反查「段元数据 taskTaskId 相同」的 tool 段并吸收该行元数据；仍无命中才维持现状丢弃。taskStatus 的终态覆盖语义不变（NOTIFICATION 覆盖 STARTED 的 running，到达顺序即权威）。

#### 场景：TASK_NOTIFICATION 行 parent 缺失/错位，派发段在本轮已存在

- Given 派发轮内已有 tool 段（task 元数据 taskTaskId=K，taskStatus=running），后续 `[TASK_NOTIFICATION] {"task_id":"K","status":"completed"}` 行 parent_tool_use_id 缺失或指向不存在的段；
- When 该行进入装配器；
- Then 按 task_id=K 反查命中派发 tool 段，段元数据更新为 taskStatus=completed（含 elapsed/summary），行不产生正文段；派发段 UI 不再显示「运行中」。

#### 场景：task_id 也无法命中（任务从未在本轮出现）

- Given 轮内无任何段元数据 taskTaskId 与行 task_id 相同；
- When 该行进入装配器；
- Then 维持现状：丢弃该行、不建 stub 空壳、不落顶层（原引用返回），行为与修复前一致。

### FR-03: 为上述两处修复补回归测试,daemon 与 frontend 现有相关测试不回归

- daemon 侧**必须**新增覆盖：tool_use 派生事件带 tool_use_id；别名条目补发/静默注销两分支；三无孤儿 WARN 日志。frontend 侧**必须**新增覆盖：task_id 提取落段元数据、parent 未命中按 task_id 兜底吸收、无命中维持丢弃。既有相关测试套件（daemon background-tasks/claude-events、frontend task-line-assembler 等）**必须**全绿。

#### 场景：回归防线

- Given 上述新增用例与既有相关套件；
- When 在本变更内运行；
- Then 新增用例全部通过且既有相关套件无回归（禁止跑全量测试，仅跑本变更触达模块的测试）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「task_notification 别名条目补发终态/静默注销/三无 WARN 日志」+ sillyhub-daemon/tests/interactive/claude-events.test.ts「Task/Agent tool_use 派生 agent_task_status 必带 tool_use_id」
FR-02: frontend/src/components/daemon/__tests__/task-line-assembler.test.ts「[TASK_*] parent 未命中按 task_id 兜底反查（FR-02）」四用例
FR-03: sillyhub-daemon/tests/interactive/（task-lifecycle + claude-events + golden）与 frontend/src/components/daemon/__tests__/（task-line-assembler + turn-state-subagent-routing + runtime-session-helpers + session-log-assembler + turn-segment-views）全量用例
