---
author: qinyi
created_at: 2026-08-27 09:20:00
change: 2026-08-27-background-subagent-progress
module_impact: sillyhub-daemon/interactive, backend/daemon.run_sync, backend/daemon.session, frontend/components-daemon, frontend/components-sessions
scale: large
---

# 后台异步子代理进度可视化 · design

## 1. 背景

主 agent（Claude Agent SDK 0.3.181 interactive session）用 `Agent` 工具**后台异步模式**（run_in_background）派发子代理时，平台四层链路对"异步生命周期"全部失明。生产实证（会话 dd345992-6577-422c-a3bf-c44f8735fd71，2026-08-26/27，阿里云）：

1. **假完成 + 假时长**：异步派发的 tool_use 与 tool_result（"Async agent launched successfully… agentId: xxx"启动回执）0.1 秒内配对。前端子代理块/目录由日志时间戳推导状态与时长（`turn-status-bar.tsx:165` `collectSubagents` 内 :185 `s.result === undefined ? "running" : "done"`；`session-log-assembler.ts:1028/1076` startedAt/endedAt=两条日志时间戳）→ 子代理被标"已完成"、时长"00:00"，而真实进程持续运行 1h45m+。
2. **无终态事件**：daemon 仅在 Task/Agent tool_use 时发一次 `agent_task_status: running`（`session-manager.ts:4166-4180`，全仓唯一发送点），此后无 progress、无 completed/failed/stopped。头部"后台"卡片永远转圈，`progress`/`message` 字段自 2026-08-24 FR-03 落地后从未被填充。
3. **SDK 信号被丢弃**：钉死版 SDK 0.3.181 的 `sdk.d.ts` 已声明完整任务生命周期系统消息——`SDKTaskStartedMessage`（task_id/tool_use_id/description/subagent_type）、`SDKTaskProgressMessage`（usage.duration_ms/total_tokens/tool_uses + last_tool_name + summary）、`SDKTaskNotificationMessage`（status: completed|failed|stopped + summary + usage.duration_ms）。daemon 默认透传后，backend `_extract_sdk_messages`（`run_sync/service.py:2281`）只认 assistant/user 两型，system 类**静默返回 []**。
4. **跨轮孤儿**：后台子代理 transcript 确实带 `parent_tool_use_id` 流入（生产 98 条、跨 3 个 run），但后续轮次到达的子代理日志在当轮组装时找不到派发轮的 tool 段 → 变成 `subagent_stub` 孤儿块（时长"—"，与原块脱节）。
5. **沉默不可辨**：子代理最后一条日志 00:18:59 后沉默 26 分钟，用户无从判断卡死还是慢跑。
6. **空注入空轮**（顺带缺陷）：空 prompt `POST /inject` 创建 50ms 完成的零输出 run（生产 00:42:34，run c78044c8），UI 出现无意义的"已完成"轮。

前置依赖：`2026-06-28-daemon-subagent-transcript` 已建前台子代理 transcript 链路（`forwardSubagentText` + `parent_tool_use_id`/`subagent_type`/`depth` 落库 + 前端嵌套渲染），本变更在其上补异步生命周期，不重复建设。

## 2. 设计目标

- **G1 真状态**：后台异步子代理显示"后台运行中"直到真实终态（completed/failed/stopped），启动回执不再被当作完成信号；前台（阻塞式）子代理行为零回归。
- **G2 真进度**：卡片显示"正在做什么"（last_tool_name + summary）、走秒计时（服务端 duration_ms 校准 + 本地 tick）、tokens/工具次数；长时间无动静显示"最后活跃 X 分钟前"。
- **G3 真时长**：终态定格显示服务端权威 `usage.duration_ms`，替代日志时间戳差值。
- **G4 持久可回放**：生命周期节点以 `[TASK_*]` 日志行持久化（带 parent_tool_use_id），刷新/历史回看不依赖一次性 SSE。
- **G5 跨轮归位**：带 parent_tool_use_id 的日志行落库时归回派发 run，消除孤儿 stub。
- **G6 空轮防御**：空 prompt 注入被拒（422），前端空内容不可发送。

## 3. 非目标（不在范围内 / Non-Goals）

- **N1** 不覆盖 `dispatch_worker` 平台 worker 子会话——那是 team-mission 链路（`/team-missions` 5s 轮询 + mission_derive_status），有独立机制；本变更只管 Claude Code 原生 Task/Agent 后台子代理。
- **N2** 不做按子代理计费拆分（沿用 2026-06-28 变更 D-008 决策：usage 聚合到 AgentRun 总量）。
- **N3** 不做后台任务的暂停/恢复/停止控制 UI（`SDKControlStopTaskRequest` 存在但本期只读展示）。
- **N4** 历史数据不迁移（归位只对新写入行生效；项目未上线，CLAUDE.md 规则 11 允许）。
- **N5** 不做 Codex provider 的后台任务事件（SDK 特性差异，对齐 2026-06-28 变更 N3 口径）。
- **N6** 不新增 DB 表/列——`[TASK_*]` 复用 agent_run_logs 现有列（channel=stdout 文本前缀 + 既有 parent_tool_use_id 列；AgentRunLog 无 metadata 列为已知坑，不为此加列）。

## 4. 拆分判断

单一功能"后台异步子代理生命周期可视化"的端到端链路改造，daemon/backend/frontend 三端紧耦合（事件 schema 一体定义、三层必须同时改才端到端 work），无独立可交付子模块。**不拆分，不批量**，作为一个变更走完整流程（D-001@v1）。

## 5. 总体方案

数据流（复用 D-002@v1（前变更）确立的"复用 Redis `agent_session:{id}` 频道 + 新事件载荷"模式）：

```
CLI(0.3.181) ──system/task_*──> daemon session-manager（新增拦截）
                                   ├─ BackgroundTaskRegistry（会话级 task_id↔tool_use_id↔状态）
                                   ├─ SSE: hubClient.notifyAgentTaskStatus(扩展载荷)
                                   │        → backend notify_agent_task_status → Redis SSE → 前端卡片/目录
                                   └─ 持久: onTurnMessage 落 [TASK_STARTED/PROGRESS/NOTIFICATION] stdout 行
                                            （带 parent_tool_use_id → backend submit_messages 归位派发 run）
user tool_result(异步启动回执) ──> daemon 解析 agentId（兜底路径，CLI 不发 task_* 时保底 running 不假完成）
空 prompt inject ──> backend 422（中文文案）+ 前端发送按钮禁点
```

### Phase 1 — daemon：SDK task_* 消费 + 回执兜底 + 持久行

`sillyhub-daemon/src/interactive/session-manager.ts`（god 文件，改动聚焦三处）：

- **P1.1 system 拦截分支**（`_onMessage`，现 thinking_tokens 分支旁）：识别 `type==='system' && subtype in {task_started, task_progress, task_notification, task_updated}`，**不再走默认透传**（避免 backend 丢弃后无痕迹）：
  - `task_started`：注册 `state.backgroundTasks`（`Map<task_id, {toolUseId?, description, subagentType?, startedAt}>`；带 tool_use_id 时建立双向映射）→ emit `agent_task_status {status:'running', task_id, tool_use_id, task_name:description}` + 落 `[TASK_STARTED]` 行。
  - `task_progress`：emit `agent_task_status {status:'running', ..., last_tool_name, summary, elapsed_ms:usage.duration_ms, total_tokens, tool_uses}` + 落 `[TASK_PROGRESS]` 行（progress 行按节流合并不逐条落，见 R-03）。
  - `task_notification`：emit `agent_task_status {status:'completed'|'failed'|'stopped', task_id, tool_use_id, summary, elapsed_ms:usage.duration_ms}` + 落 `[TASK_NOTIFICATION]` 行 + 注销任务表。
  - `task_updated`：仅 patch.status/is_backgrounded 变化时转发轻量事件，不落行（噪声控制）。
- **P1.2 异步回执兜底**（现有 user tool_result 分支，bash 追踪旁）：result 文本匹配 `Async agent launched successfully` + 正则提取 `agentId: ([0-9a-f]+)` → 以 result 的 tool_use_id 注册任务表（无 task_id 映射时 task_id=agentId）→ emit `agent_task_status {status:'running', async:true, task_id:agentId, tool_use_id}`。**此路径保证 CLI 不发 task_* 时，前端至少不会假完成**。
- **P1.3 持久行格式**（stdout channel，前缀方言对齐既有 `[TOOL_USE]`/`[SYSTEM:...]`）：
  ```
  [TASK_STARTED] {"task_id":"abf5a98b…","tool_use_id":"call_0ef6…","task_name":"task-05 前端骨架核验补全","subagent_type":"general-purpose","async":true}
  [TASK_PROGRESS] {"task_id":"abf5a98b…","elapsed_ms":742000,"total_tokens":48200,"tool_uses":37,"last_tool_name":"Read","summary":"正在读取 design.md…"}
  [TASK_NOTIFICATION] {"task_id":"abf5a98b…","status":"completed","elapsed_ms":3600000,"summary":"骨架核验完成：…"}
  ```
  行载荷 JSON 单行、parent_tool_use_id 用消息既有字段（submit 通道透传），供前端 assembler 解析与回放。
- `interactive/types.ts`：`SessionEventForBackend` 的 agent_task_status 载荷扩展字段；`hub-client.ts` `NotifyAgentTaskStatusBody`（:141）同步扩展；`cli.ts`（:718 case）透传。

### Phase 2 — backend：schema 扩展 + 跨轮归位 + 空注入防御

- **P2.1 schema**（`daemon/schema.py` AgentTaskStatusEvent，:968 起）：`status: Literal["running","completed","failed","stopped"]`；新增可选字段 `task_id/tool_use_id/summary/last_tool_name/elapsed_ms/total_tokens/tool_uses/async_`（`async` 是 Python 关键字，DTO 字段名用 `async_` + alias `async`，OpenAPI 输出 `async`）。`router.py notify_agent_task_status`（:1555）与 `run_sync/service.py` 的 Redis publish 透传新字段。向后兼容：旧 daemon 只发 running + task_id/task_name 不受影响。
- **P2.2 跨轮归位**（`run_sync/service.py submit_messages` 落库路径）：flat 行带 `parent_tool_use_id` 时，查 `tool_use_id→run_id` 映射（进程内 LRU 缓存 + 未命中时从 agent_run_logs 的 tool_call 行按 session 反查冷启动），将 run_id 改写为**派发 run**。查不到（极端：派发 run 日志已被清理）保持现状落当前 run，不报错。历史行不回填（N4）。
- **P2.3 空 prompt 防御**（`daemon/session/service.py inject_session`，:2177）：`prompt` strip 后为空 → 抛 422（`SessionEmptyPrompt` 领域事件类，中文文案"消息内容不能为空"，过 `test_error_message_l10n.py` AST 守护）。schema 层同步 `min_length` 校验双保险。
- 无 alembic migration（N6）。

### Phase 3 — frontend：卡片/目录全生命周期 + 沉默提示

- **P3.1 类型与分发**（`lib/daemon.ts`）：`AgentTaskStatusEvent`（:1022）扩展对齐新 schema（api-types 重生成）；SSE 分发（:1331）透传新字段到 `onAgentTaskStatus`。
- **P3.2 卡片**（`components/daemon/agent-task-card.tsx` + `session-panel.tsx` agentTasks state :766/handler :1160）：运行中显示"正在做什么"行（last_tool_name + summary 摘要）、走秒（本地 tick，服务端 elapsed_ms 到达时校准锚点）、tokens/工具次数、进度条（elapsed 无任务总量基准，改为 tokens 累积的可视化趋势，不伪造百分比——**百分比仅在 usage 提供可信基准时显示，否则隐藏**）；终态定格（✓/✕/■ + 服务端 elapsed_ms 格式化 + summary 摘要行）；"最后活跃 X 分钟前"（最后 task_progress/子代理日志时间距今 >5min 显示橙色警示）。
- **P3.3 目录与会话块异步感知**：`session-log-assembler.ts` 识别 `[TASK_*]` 行 → 段元数据（taskStatus/taskElapsedMs/async）；`turn-status-bar.tsx collectSubagents`（:165）对 async 块不再因 result 存在判 done，状态/时长改由 TASK_* 元数据驱动；`subagent-catalog.tsx subagentDuration`（:75）运行中走秒、终态显示服务端时长；`turn-segment-views.tsx` 块头状态徽标同口径。
- **P3.4 发送禁点**（`session-panel.tsx` 发送按钮）：输入 strip 为空时 disabled。
- 回归保护：前台（阻塞式）子代理 tool_result 在真实完成时到达，状态推导路径不变（P3.3 仅对 async 标记生效）。

### Phase 4 — spike 验证与测试

- **P4.1 spike（先行）**：本地起 daemon + 后台 Agent 会话，在 session-manager 加临时 debug 日志确认 CLI 0.3.181 运行时是否真发 task_started/task_progress/task_notification（类型已声明 ≠ 运行时必发；生产日志无法证伪——backend 本来就丢弃 system 消息）。验证结论记入本 design §10 验证记录，决定兜底路径权重（不发 → 回执解析为 primary）。
- **P4.2 三端单测**：daemon vitest（task_* 映射 / 回执正则 / [TASK_*] 行格式）；backend pytest（notify 新字段透传 / 归位映射与冷启动 / 空 prompt 422 / l10n）；frontend vitest（卡片终态定格与走秒锚点 / collectSubagents async 感知 / assembler [TASK_*] 解析 / 目录显示）。

## 6. 生命周期契约表

本变更涉及 agent_run/daemon 生命周期事件，契约矩阵如下（事件 × 发起方 × 接收方 × 必需字段 × 状态变化）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| `system/task_started`（SDK） | CLI 运行时 | daemon session-manager | task_id, description；可选 tool_use_id/subagent_type | 注册 BackgroundTaskRegistry（无状态库表变化） |
| `system/task_progress`（SDK） | CLI 运行时 | daemon session-manager | task_id, usage(duration_ms/total_tokens/tool_uses)；可选 last_tool_name/summary | 更新任务表进度快照 |
| `system/task_notification`（SDK） | CLI 运行时 | daemon session-manager | task_id, status(completed/failed/stopped), summary（usage 可选——`usage.duration_ms` 缺失时 None 容错，走秒值兜底） | 注销任务表 |
| `system/task_updated`（SDK） | CLI 运行时 | daemon session-manager | task_id, patch（status/is_backgrounded/end_time/error 增量） | 仅 status/is_backgrounded 变化时转发轻量 SSE 事件，不落 [TASK_*] 行、不改任务表主状态（噪声控制） |
| `agent_task_status`（SSE，扩展） | daemon | backend notify 端点 → Redis `agent_session:{id}` → 前端 | event, task_id, task_name, status；新增可选 tool_use_id/summary/last_tool_name/elapsed_ms/total_tokens/tool_uses/async | 前端 agentTasks 上对应卡片状态迁移（running→terminal） |
| `[TASK_STARTED/PROGRESS/NOTIFICATION]`（stdout 日志行） | daemon | backend submit_messages → agent_run_logs | 前缀 + 单行 JSON（task_id 等）；行级 parent_tool_use_id | 无 run/session 状态变化；供回放重建 |
| 异步启动回执解析 | daemon（user tool_result 分支） | 任务表 + SSE | result.tool_use_id, 提取 agentId | 兜底注册（防假完成），不改 run 状态 |
| 跨轮归位 | backend submit_messages | agent_run_logs 写入 | 行 parent_tool_use_id → 派发 run_id | 仅日志行 run_id 归因，不动 AgentRun/AgentSession 状态机 |
| 空 prompt inject | 前端/任意调用方 | backend inject_session | — | 422 拒绝，不创建 AgentRun |

既有 `turn_completed` / `dispatch_worker` / lease 等生命周期事件**不变**（本变更不改 session/lease/agent_run 状态机，对齐 N6）。

## 7. 文件变更清单

| 文件 | 变更 |
|---|---|
| `sillyhub-daemon/src/interactive/session-manager.ts` | P1.1 task_* 拦截 + P1.2 回执兜底 + P1.3 [TASK_*] 行 + 任务表 |
| `sillyhub-daemon/src/interactive/types.ts` | agent_task_status 载荷扩展 |
| `sillyhub-daemon/src/hub-client.ts` | NotifyAgentTaskStatusBody 扩展（:141/:1018） |
| `sillyhub-daemon/src/cli.ts` | 事件透传（:718 case） |
| `sillyhub-daemon/tests/interactive/`（新增） | task_* 映射/回执解析/行格式 vitest（落 tests/interactive：vitest include 仅覆盖 tests/**） |
| `backend/app/modules/daemon/schema.py` | AgentTaskStatusEvent 扩展（:968） |
| `backend/app/modules/daemon/router.py` | notify_agent_task_status 透传（:1555） |
| `backend/app/modules/daemon/run_sync/service.py` | publish 透传 + submit_messages 跨轮归位 |
| `backend/app/modules/daemon/session/service.py` | inject_session 空 prompt 422（:2177）+ SessionEmptyPrompt |
| `backend/app/modules/daemon/tests/` | 透传/归位/422/l10n 测试 |
| `frontend/src/lib/daemon.ts` | 事件类型 + 分发扩展 |
| `frontend/src/lib/api-types.ts` + `backend/openapi.json` | pnpm gen:types 重生成（CLAUDE.md 规则 21） |
| `frontend/src/components/daemon/agent-task-card.tsx` | P3.2 卡片全生命周期 |
| `frontend/src/components/daemon/session-panel.tsx` | agentTasks state/handler 扩展 + 发送禁点 |
| `frontend/src/components/daemon/session-log-assembler.ts` | [TASK_*] 行解析 |
| `frontend/src/components/daemon/turn-status-bar.tsx` | collectSubagents async 感知 |
| `frontend/src/components/sessions/subagent-catalog.tsx` | 时长/状态口径 |
| `frontend/src/components/daemon/turn-segment-views.tsx` | 块头状态徽标 |
| `frontend/src/components/daemon/__tests__/`（扩展） | 卡片/目录/assembler vitest |

预估 ~12 源文件 + 测试，跨三端 → **scale=large**（step 8 复核）。

## 8. 接口定义（关键契约）

```python
# backend AgentTaskStatusEvent 扩展（daemon/schema.py）
class AgentTaskStatusEvent(BaseModel):
    event: Literal["agent_task_status"] = "agent_task_status"
    task_id: str
    task_name: str
    status: Literal["running", "completed", "failed", "stopped"]
    tool_use_id: str | None = None        # 与前端 tool 段 id（tool_use_id）关联
    summary: str | None = None            # 终态摘要 / 进行中摘要（截断 200 字符）
    last_tool_name: str | None = None     # task_progress.last_tool_name
    elapsed_ms: int | None = None         # 服务端权威时长（usage.duration_ms）
    total_tokens: int | None = None
    tool_uses: int | None = None
    async_: bool | None = Field(None, alias="async")  # 异步派发标记（回执兜底路径必发）
```

```ts
// daemon NotifyAgentTaskStatusBody 对齐扩展（snake_case）；前端 AgentTaskStatusEvent 同步
```

```
# [TASK_*] stdout 行（单行 JSON；前端按前缀识别，容忍未知字段）
[TASK_STARTED] {"task_id":"…","tool_use_id":"…","task_name":"…","subagent_type":"…","async":true}
[TASK_PROGRESS] {"task_id":"…","elapsed_ms":742000,"total_tokens":48200,"tool_uses":37,"last_tool_name":"Read","summary":"…"}
[TASK_NOTIFICATION] {"task_id":"…","status":"completed","elapsed_ms":3600000,"summary":"…"}
```

## 9. 风险登记

- **R-01（高）SDK 运行时发射未验证**：task_* 类型存在于 0.3.181 sdk.d.ts 但生产无迹可循（backend 丢弃 system 消息导致无法证伪）。缓解：P4.1 spike 先行；回执兜底保证 running 状态正确；终态缺失时卡片在会话 end（既有清理）收敛，风险降级为"缺终态精度"而非"假状态"。
- **R-02（中）session-manager.ts god 文件**（known-issue 3897+ 行）：改动新增拦截分支需单测全覆盖，不动既有 partial/bash 分支结构。
- **R-03（中）[TASK_*] 行量**：task_progress 可能高频（CLI 每次工具调用后发？频率未知）。缓解：spike 实测频率，daemon 侧对 [TASK_PROGRESS] 行做 ≥2s 节流合并（SSE 同步节流），终态行不节流。
- **R-04（中）归位语义变化**：子代理日志不再出现在"最新轮"，前端会话视图/测试需回归（日志归派发轮后，跨轮查找靠目录跳转）。孤儿 stub 消失是预期收益。
- **R-05（低）空 prompt 422 文案**：需中文（l10n AST 守护测试自动把关）。
- **R-06（低）`async` 字段名**：Python 侧 `async_` + alias，OpenAPI/TS 侧 `async`，三端命名对齐由 gen:types 卡（CI gen:types:check）。
- **R-07（低）旧日志兼容**：无 [TASK_*] 前缀的历史行走原路径，assembler 解析为普通 stdout 文本，无回归。

## 10. 验证记录（spike 已回填，2026-08-27 task-01 实测）

- [x] CLI 0.3.181（npm）捆绑契约 + 本机 claude 2.1.216 运行时**确实发射** task_* 消息（直连 SDK 起后台 Task 会话实测）：
  - `task_started`：含 task_id + **tool_use_id**（关联键齐）+ description + subagent_type + task_type + prompt；
  - `task_updated`：patch{status:"completed", end_time}，与终态同时到达（轻量辅助信号，仅记不消费为主）；
  - `task_notification`：status:"completed" + task_id + tool_use_id + output_file（summary/usage.duration_ms 按类型契约），实测启动后 ~64s 到达；
  - 另发现 `system:background_tasks_changed`（×2，本期不消费，仅记录）。
  - **结论：事件消费为 primary（R-01 消解），回执解析兜底降级为防旧版 CLI 的 secondary。**
- [x] task_progress 实际频率：**短任务（~64s）全程零发射**。设计调整：前端"正在做什么"行数据源优先 task_progress、缺失时回退子代理 children 最新日志（latestActivity 既有机制，task-12 卡已按此落口径）；[TASK_PROGRESS] 节流保留默认 ≥2000ms（发射稀疏时节流自然无感，R-03 参数定案）。

## 11. 决策引用

本设计依据 decisions.md 当前版本：D-001@v1（方案 A 选型，否决 B/C 理由见该条）、D-002@v1（生命周期双写：SSE + [TASK_*] 持久行）、D-003@v1（跨轮归位在 backend 落库时做）、D-004@v1（空 prompt 后端 422 为主前端禁点为辅）、D-005@v1（原型三主题对齐 themes.ts，默认暗夜）。

## 12. 自审（Self-Review）

- ✅ 章节齐全：背景/目标/非目标/拆分判断/总体方案/生命周期契约表/文件清单/接口定义/风险/验证/决策/自审。
- ✅ 生命周期契约表已含（§6，命中 session/agent_run/daemon/lifecycle 关键词的硬要求）。
- ✅ 所有引用函数/符号已 grep 核实存在：`notifyAgentTaskStatus`（hub-client.ts:1018）、`NotifyAgentTaskStatusBody`（:141）、`notify_agent_task_status`（router.py:1555）、`inject_session`（session/service.py:2177）、`collectSubagents`（turn-status-bar.tsx:165）、`subagentDuration`（subagent-catalog.tsx:75）、SDK 三消息类型（sdk.d.ts:4012-4092，独立审查员逐一核实）。
- ✅ UI 原型已评审通过：`prototype-background-subagent-progress.html`（三主题 + 终态模拟交互，用户两轮确认）。
- ✅ 与 2026-06-28-daemon-subagent-transcript 无重叠（其管前台 transcript 可见性，本变更管异步生命周期；N1-N5 边界互斥）。
- ⚠️ 自审存疑 1：SDK 运行时是否真发 task_*（R-01）——已在 §10 留 spike 回填位，兜底路径独立成立。
- ⚠️ 自审存疑 2：task_progress 频率未知（R-03）——节流参数留 spike 实测后定，默认 ≥2s。
- ⚠️ 自审存疑 3：归位冷启动反查在长会话下的查询成本（P2.2）——LRU + tool_call 行索引存在（ix 已建），量大时再评估专用索引，本期不预优化。
