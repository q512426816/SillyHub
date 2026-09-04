# pi-rpc-events fixture（PiEventNormalizer 用例输入）

变更：2026-09-04-provider-pi-onboarding task-01。
消费者：`tests/interactive/pi-events.test.ts`（`PiEventNormalizer.normalizeRpcLine` 逐行喂入）。

## 采样环境

- pi `0.81.1`（本机 `C:\nvm4w\nodejs\node_modules\@earendil-works\pi-coding-agent`）
- 采样命令：`pi --mode json -p "用 Bash 执行 echo pi-smoke 并汇报"`（独立 tmp 目录，2026-09-04）
- 词汇真源：
  - `docs/json.md`（事件类型联合 + 输出行示例）
  - `dist/core/agent-session.d.ts`（`AgentSessionEvent`，含 rpc 扩展的
    `agent_settled` / `queue_update` / `compaction_*` / `auto_retry_*` 等）
  - `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:368-406`（`AgentEvent`
    九型联合：agent_start/agent_end/turn_start/turn_end/message_start/
    message_update/message_end/tool_execution_start/update/end）
  - `node_modules/@earendil-works/pi-ai/dist/types.d.ts:347-389`
    （`AssistantMessageEvent`：text_start/delta/end、thinking_start/delta/end、
    toolcall_start/delta/end、start/done/error）
  - `dist/modes/rpc/rpc-mode.js:259`（`extension_error` 输出形状）

## 文件与来源

| 文件 | 来源 | 覆盖形状 |
|---|---|---|
| `real-error-turn.jsonl` | **本机实跑采样**（2026-09-04，429 限流错误路径真实输出，修剪至 1 个重试循环 + 终态两行后脱敏） | `session` 首帧、`agent_start`/`turn_start`、user/assistant 的 `message_start`/`message_end`、`turn_end`（stopReason=error + errorMessage + 全零 usage 含 cost 结构）、`agent_end`（messages+willRetry）、`auto_retry_end`、`agent_settled` |
| `manual-success-turn.jsonl` | **手工构造**（按上表 .d.ts 类型逐字段对齐；词汇与字段名以批量适配器 `src/adapters/pi-json.ts` 实测口径 + pi 文档为准） | thinking part（thinking_start/delta/end + message_end content 内 thinking）、toolCall part、`tool_execution_start`/`tool_execution_update`/`tool_execution_end`（result.content[].text）、`text_delta` 两条（逐条直通验证）、`turn_end` 四维 usage + cacheRead/cacheWrite 非零值、`agent_settled` |
| `manual-rpc-extras.jsonl` | **手工构造**（`extension_error` 按 rpc-mode.js:259 输出形状 + ExtensionError 接口 extensions/types.d.ts:1253-1258；未知事件为假设的未来新增类型） | `extension_error`（extensionPath/event/error）、未知事件降级（`some_future_event`） |

## 实跑采样受限说明

采样当日（2026-09-04）本机唯一配置的 LLM provider（智谱 GLM）触发 5 小时用量上限
（429，13:00 重置），成功路径（text_delta 流 / tool_execution / thinking part / 非零
usage）无法实跑采样。因此：

1. `real-error-turn.jsonl` 为真实错误路径采样（pi 在流层无独立 error 事件时，失败仅经
   `turn_end.message.stopReason='error' + errorMessage` 浮出——该事实本身即来自本次实跑）；
2. 成功路径形状按 pi 包 `.d.ts` 类型定义 + `docs/json.md` 示例构造，字段名与嵌套结构与
   批量适配器 `pi-json.ts`（先前变更实跑验证）一致；
3. 待 provider 配额恢复后可重跑采样替换 `manual-success-turn.jsonl`（词汇漂移风险
   R-03/R-04 由未知事件降级 + golden 用例兜底）。

## 脱敏项（real-error-turn.jsonl）

- 工作目录绝对路径（含用户名）→ `<redacted-tmp-cwd>`
- session UUID → `<redacted-session-id>`
- provider 配置名（本机个人配置）→ `redacted-provider`

错误消息文本（429 限额提示）与时间戳保留原样——无凭证，且是错误路径断言的输入。
