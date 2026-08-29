# 平台会话侧对长时间 shell 命令与 plan 确认反馈缺失

- 日期：2026-08-24
- 状态：**活跃坑**（待工具/平台修复）
- 发现来源：用户实测平台会话反馈

## 现象

1. **长时间 shell 命令看不到进程/输出**
   - 在平台会话中执行 Bash 工具（如 `npm test`、构建、迁移生成等耗时命令）时，
     会话侧没有实时进度反馈，用户无法判断命令是「正在跑」「已挂起」还是「已结束」；
   - 若命令使用 `run_in_background`，平台侧缺少显式的后台任务卡片或状态同步入口。

2. **plan 模式缺少平台会话侧确认反馈**
   - 进入 plan 模式（`sillyspec run plan` 或 Agent `EnterPlanMode`）后，
     平台会话侧没有弹出确认/审批入口，或者用户确认后没有明显反馈回到主流程；
   - 结果看起来像是「plan 阶段发起后没有响应」，agent 与用户都不知道下一步该由谁推进。

## 影响

- 操作信心低：用户不敢确定耗时命令是否真的在跑，容易重复发起或误中断；
- plan 阶段阻塞：缺少确认反馈会导致阶段状态推进不畅，agent 可能重复生成计划或等待超时；
- 多 agent 并发场景下，信息不同步会放大误判风险。

## 推测根因（待进一步定位）

可能涉及两个层面：

- **Bash 工具输出到平台会话的桥接**：当前 Bash 命令的标准输出/错误流可能只回写到 agent 上下文，
  没有以结构化事件（stdout chunk / stderr chunk / exit code）推送到平台会话 UI；
  `run_in_background` 任务的状态机也没有在平台侧渲染。
- **Plan 模式的确认契约**：`EnterPlanMode` / `ExitPlanMode` 可能只完成了「agent 进入等待」这一侧，
  平台会话侧缺少对应的「用户确认 → 恢复执行」事件通道，或者事件通道存在但 UI 没有订阅。

## 建议改进（工具/平台侧）

1. **Bash 实时输出推送**
   - 将 Bash 命令的 stdout/stderr 按 chunk 推送到平台会话，作为可折叠的「终端」面板；
   - `run_in_background` 任务在平台侧生成任务卡片，显示状态（running / completed / failed）、
     退出码、最后输出片段，并提供「查看完整日志」「停止任务」入口。

2. **Plan 模式双向确认**
   - `EnterPlanMode` 触发平台会话显示计划审批卡片，展示计划摘要 + 「确认 / 需要修改 / 取消」选项；
   - 用户选择后，平台通过明确事件通知 agent 恢复或修订；
   - 若平台侧暂不支持交互，至少给出清晰文案：「plan 已提交，请在本消息下方回复确认或修改意见」。

3. **通用反馈兜底**
   - 任何需要用户介入的暂停点（plan、wait、approval），平台会话必须产出一条可见消息，
     说明「当前状态 + 需要用户做什么 + 如果不处理会怎样」，避免静默等待。

## 绕过方式（当前）

- 对于长命令，agent 在发起前主动告知「此命令预计耗时 X，开始执行」，
  执行后给出结论；必要时手动 split 为多个短命令并逐条汇报。
- 对于 plan 模式，若平台侧没有确认 UI，用户可直接在会话中回复「确认 / 需要修改：...」，
  agent 收到后调用 `ExitPlanMode` 或重新修订计划，避免死等。

## 本地日志排查结果

运行 `sillyspec agent-log --json` 检测到以下本地 harness 会话，
**未发现用户提供的两个平台会话 ID**（`239c7817-...` / `f39e443d-...`），
说明这两个 ID 是 **SillyHub 平台侧会话 ID**，与本地 Claude Code / zcode harness 会话 ID 不同：

| harness | 本地会话 ID | change_key | last_command |
|---|---|---|---|
| claude-code | `3d4b19ee-...` | — | `doctor` |
| claude-code | `1550e2bd-...` | `2026-08-24-sessions-live-updates` | `execute --change` |
| zcode | `39c929b2-...` | `2026-08-24-sessions-live-updates` | `quick --done ...` |

另外，`agent-log` 输出 `platform_restored: false`，且本地日志文件虽然能被 `ls`/`Get-ChildItem` 枚举，
却无法被常规读取工具（Bash `head`、PowerShell `Get-Content`、Claude `Read`）打开，
疑似被 SillyHub daemon 以过滤器/虚拟化方式持有，需要进一步确认是否为预期行为。

## 根因分层（待确认）

| 层级 | 怀疑点 | 验证方式 |
|---|---|---|
| 平台 UI | Web 端没有订阅 Bash stdout / plan approval 事件 | 导出浏览器控制台日志和 network trace |
| Agent → 平台事件 | `EnterPlanMode` / Bash chunk 事件没有正确序列化到平台会话 | 查看平台侧 `platform_agent_logs` / `agent_sessions` 中对应 `hub_session_id` 的事件 |
| 本地日志 | daemon 持有文件导致 agent 侧无法取证 | 确认是否设计如此，或提供只读导出 API |

## 建议改进（工具/平台侧）

1. **Bash 实时输出推送**
   - 将 Bash 命令的 stdout/stderr 按 chunk 推送到平台会话，作为可折叠的「终端」面板；
   - `run_in_background` 任务在平台侧生成任务卡片，显示状态（running / completed / failed）、
     退出码、最后输出片段，并提供「查看完整日志」「停止任务」入口。

2. **Plan 模式双向确认**
   - `EnterPlanMode` 触发平台会话显示计划审批卡片，展示计划摘要 + 「确认 / 需要修改 / 取消」选项；
   - 用户选择后，平台通过明确事件通知 agent 恢复或修订；
   - 若平台侧暂不支持交互，至少给出清晰文案：「plan 已提交，请在本消息下方回复确认或修改意见」。

3. **会话可观测性**
   - 平台会话 UI 显示当前关联的 `hub_session_id` 和本地 harness `session_id`，方便对账；
   - 提供一键导出当前会话事件流（tool_use / text / approval / bash_chunk）功能，便于报 bug。

## 绕过方式（当前）

- 对于长命令，agent 在发起前主动告知「此命令预计耗时 X，开始执行」，
  执行后给出结论；必要时手动 split 为多个短命令并逐条汇报。
- 对于 plan 模式，若平台侧没有确认 UI，用户可直接在会话中回复「确认 / 需要修改：...」，
  agent 收到后调用 `ExitPlanMode` 或重新修订计划，避免死等。

## 待补充信息

- [ ] 平台侧是否能导出这两个会话的浏览器控制台日志或 network trace？
- [ ] 平台数据库里 `agent_sessions.id = 239c7817-...` / `f39e443d-...` 的事件流是否有 `EnterPlanMode`、`Bash` 相关记录？
- [ ] 这两个会话对应的是哪个 harness（claude-code / zcode / 其他）？
- [ ] 平台版本号 / 部署时间？

## 调查进展（2026-08-27 平台本地库只读取证）

平台后端 127.0.0.1:8001 可达（本地 Postgres 库直查，只读 SELECT）：

- 两会话均在库：`239c7817`（turn_count=7，2026-08-24 01:29 建，last_active 08:04）与
  `f39e443d`（turn_count=4，01:21 建，last_active 02:11）——**不是空会话，活动真实发生过**；
- 两会话 `status=failed` 且 `ended_at` 完全相同（2026-08-25 03:03:20.563462）——
  是同一时刻被批量清扫置 failed，非运行中自然失败；
- harness 均为 claude-code（provider=claude，origin=chat，cwd=multi-agent-platform 仓，
  config `manual_approval: true`）；`agent_session_id` 分别为 `1550e2bd-...`（与本地
  agent-log 表一致）与 `cc83bb56-...`（后者不在当初本地枚举里，为新增对账信息）；
- `session_dialog_requests`：两会话仅 1 条 AskUserQuestion 对话（f39e443d，30 秒内被
  用户回答，status=answered）——**没有任何 plan 审批类 dialog 记录**；
- 后端代码全仓 grep 无 `EnterPlanMode`/`ExitPlanMode` 映射：daemon 的 dialog 扩展
  （`dialog_kind` 判别，长驻可答）只覆盖 AskUserQuestion 类；plan 审批（ExitPlanMode
  的 canUseTool）走「普通审批」路径——**内存态 ephemeral + 5 分钟自动 deny**
  （`daemon/protocol.py` 注释明示），平台 UI 不弹卡即静默超时。

### 初步定性（待平台侧立项）

1. **plan 确认缺失的机制性根因**：plan 审批没有接入 dialog 通道（无 dialog_kind），
   普通审批 5min 自动 deny + 无会话内可见消息 → 用户侧表现正是「发起后没响应」。
   修复方向：把 ExitPlanMode 审批升级为 dialog 类（复用 AskUserQuestion 基建），
   或至少在自动 deny 前向会话推一条可见消息（通用反馈兜底）。
2. **Bash 长命令输出桥接**：仍需前端 network trace 确认 ws_rpc 内容端点是否已推送
   stdout chunk（后端已有 agent log 会话内容端点，未确认 Bash 事件是否入流）。
3. **会话被清扫置 failed 无用户通知**：ended_at 批量同时刻，会话列表侧应有通知/标注。

### 待补充信息更新（2026-08-27）

- [x] 平台数据库里两会话的事件流是否有 `EnterPlanMode`、`Bash` 相关记录 → 无 plan 审批
  dialog（仅 1 条 AskUserQuestion 已答）；Bash 事件是否入流待前端 trace 确认；
- [x] 两会话 harness → claude-code（第二个本地会话 ID 补齐：cc83bb56-...）；
- [ ] 浏览器控制台日志 / network trace（仍需用户导出）；
- [ ] 平台版本号 / 部署时间。

## 处置记录（2026-08-29 收口，机制修复落地）

**症状 2「plan 确认缺失」——已修复（主坑解除）**：

- 修复：daemon `sillyhub-daemon/src/interactive/session-manager.ts` `_buildCanUseToolCallback` 新增 `ExitPlanMode` 分支——canUseTool 审批升级为 dialog（`dialog_kind='plan_approval'`），复用 AskUserQuestion 基建：
  - backend `handle_permission_request` dialog 路径（已通用）：持久化 `session_dialog_requests`（前端刷新存活）+ **不 arm 5min 自动 deny**（长驻可答）；
  - 前端按 `dialog_kind` 存在性分流渲染会话页问答卡（session-panel 已注释「天然兼容后续新增 kind」，零前端改动）——不再被分流到无人盯的 `/runtimes` 审批面板；
  - 答案映射：选「批准计划」→ allow（SDK 退出计划模式开始执行）；其他答案/自定义文本 → deny.message 回喂用户反馈（Claude 据此修订计划后重新提交）；卡片含计划前 1500 字预览；
  - scan（askUserOnly）不受影响（该分支在 allow-through 之后才生效）。
- 测试：`tests/interactive/claude-sdk-driver-permission.test.ts` 新增 3 条（载荷含 dialog_kind/双选项、批准→allow 透传、反馈→deny 回喂）；daemon 全量 vitest 180 文件 / 3103 测试 0 失败；`tsc --noEmit` 0 错；dist 已重建（下次 daemon 重启生效）。

**症状 1「长命令无进度」——已由既有工作覆盖**：daemon 已上报 `bash_status`（running / completed / failed + exit_code + elapsed_ms）与 `bash_chunk`（stdout/stderr 输出，tool_result 终点携带）事件（2026-08-27-background-subagent-progress task-04，FR-01/02）——「正在跑 / 已结束 / 退出码」可见性已解决；执行中逐 chunk 增量流式推送仍是后续增强项（非本坑阻塞）。

**「清扫置 failed 无通知」——已由既有工作覆盖**：sweep 已按终态分流广播 `_publish_session_ended`（suspended/failed 语义拆分后）。

**待补充信息失效说明**：机制修复后浏览器 trace / 平台版本两项取证不再必要（根因已在库内 + 代码定位并修复）。

**状态更新：活跃坑 → 已解决，归档至 finished/。**
