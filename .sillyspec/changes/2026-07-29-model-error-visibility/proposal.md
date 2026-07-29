---
author: qinyi
created_at: 2026-07-29T10:19:10
---
# 提案书（Proposal）— 模型调用失败可见性完整修复

## 动机
平台 claude code 交互会话页面，模型调用失败（GLM 429 额度耗尽 / 凭证失效 / 超时等）时，用户只看到「会话没反应」，完全看不到真实原因。实测：错误其实被 daemon 捕获并以 stdout 文本记录，但前端把 `[ASSISTANT] API Error` 误判为助手回复，且全前端零「API Error」识别逻辑，run failed 也不透传成可见提示。这是错误可见性产品缺陷——恰恰是用户最需要的信息被埋没，只能查后端日志才知道是额度耗尽。

## 关键问题（现有方案为何不够）
1. **错误被误判**：`normalize.ts:352` 把所有 `[ASSISTANT]` 开头归为 assistant 类，只有 `channel=stderr` 才算 error；前端 grep「API Error」零命中。
2. **run failed 无展示**：后端 run 标 `failed/is_error=true`，但错误详情只是 stdout 文本，无结构化类型/原因；session 仍显示 active；前端无「运行失败 → 显示原因」渲染。
3. **链路断裂**：模型层失败从「被记录」到「用户可见」链路断了；用户体感是「没反应」，实际 run 早已 failed。

## 变更范围
- **daemon**：新增 model-error classifier，把 claude 调用失败（is_error / resultText / api_retry）归类为结构化 ModelError，随 run result 回传后端。
- **backend**：AgentRun 加 `error_detail`（JSON 列）；`close_interactive_run` 接收存储；新增 `GET /sessions/{id}/runs` 返回 error_detail；SSE 推 error 事件。
- **frontend**：新增 `RunErrorItem` 组件（消息流错误项）；normalize 识别 error；错误类型 → UI 映射；actions（重发 / 切换供应商 / 查看详情）；run failed 标红。
- **协议**：三端同构 `ModelError`（type 枚举 + code + message + retryable + hint + raw）。
- **范围**：仅 claude（架构预留多 agent adapter 扩展点）。

## 非目标（Non-Goals）
- 不实现 codex/opencode/kimi 等其他 agent 归类（预留 adapter 扩展点，本次仅 claude）。
- 不做后台批量任务（task-runner）失败可见性。
- 不自动恢复 / 不自动切换供应商（仅展示 + 手动 action）。
- 不改 `daemon-start.bat` 的 GLM token（独立运维问题，本次只做「失败可见」）。
- 不回填历史 failed run（仅新 run 生效；历史兜底「运行失败（无详情）」）。

## 成功标准（可验证）
- 模型调用失败（429 / 401 / 超时 / 网络 等）时，会话页面显示醒目错误项 + 可读原因 + 针对性 hint。
- run/session 状态标 failed。
- 错误项带重发 / 切换供应商 / 查看详情 action，可用。
- 成功路径不受影响（`is_error=false` 无 ModelError，`error_detail=None`）。
- agent-log-display-fix 的 NOISE 折叠 / 去重不误吞错误项。
- 三端 ModelError 契约一致（`pnpm gen:types` 同步）。
