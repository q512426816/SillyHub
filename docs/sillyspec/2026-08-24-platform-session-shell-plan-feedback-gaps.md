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
