# claude-sdk-messages

Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`，stream-json 消息形态）的
fixture 消息序列，供 `tests/interactive/claude-events.test.ts`
（ClaudeEventNormalizer golden 用例）与 `tests/interactive/golden/
claude-events-golden.test.ts`（task-12 三源对照）驱动；后两者的
golden 派生文件同时被 backend `app/modules/daemon/tests/
test_run_sync_golden_parity.py` 跨端消费（monorepo 相对路径）。

## 来源（2026-09-03 task-03 采样）

混合来源：**内容采样自本机真实会话日志，信封形状按 SDK 类型契约构造**。

- 内容采样：`~/.claude/projects/`（Claude Code CLI 本地 jsonl transcript）——
  thinking 文本、Task 工具入参（description/prompt/subagent_type）、Bash 命令行、
  assistant usage 数值（input/output/cache_* 数量级）、Edit 工具的
  `toolUseResult.structuredPatch` hunk（oldStart/oldLines/newStart/newLines/lines
  真实形状与行内容）均取自真实会话帧。
- 信封形状：CLI transcript 是磁盘格式（`toolUseResult` camelCase、`call_*` 工具
  id、无 SDK 包装字段），与 SDK stream-json 消息（daemon 实际消费的形状）不同。
  本目录 fixture 按 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` 的
  SDKAssistantMessage / SDKUserMessage / SDKPartialAssistantMessage /
  SDKSystemMessage / SDKTask*Message 类型契约重打包：
  `tool_use_result`（snake_case 顶层）、`toolu_*` 工具 id、`parent_tool_use_id`/
  `subagent_type`/`uuid`/`session_id` 包装字段、stream_event 的 `event` 内嵌
  Anthropic Messages API 流式事件。
- 字段访问路径以移植来源实现为准复核：backend
  `app/modules/daemon/run_sync/service.py` `_extract_sdk_messages`（3446-3716）
  与 daemon `src/interactive/session-manager.ts` partial 缓冲链（5629-5988）。

## 脱敏

- 绝对路径中的用户名/盘符 → `<REDACTED>`（cwd/file_path/output_file 等）。
- session_id/uuid 换成 `sess-sample-*` / `u-*` 固定假值。
- 无真实凭证/token（transcript 本身不含，init 帧的 apiKeySource 仅枚举值）。

## 文件

- `full-message-mixed.json` — text/thinking/tool_use 交错的完整帧序列：Edit 带
  structuredPatch 的 tool_result、Task 子代理帧（parent_tool_use_id/subagent_type）、
  list 形 tool_result content、usage 盖章序列。
- `partial-stream-override.json` — stream_event partial 序列（message_start →
  content_block_delta(thinking/text) → message_delta(usage) → message_stop）+
  完整 assistant 消息（触发 override 撤回）。
- `session-init-status.json` — system/init（主 agent + 子代理守卫）、EnterPlanMode、
  task_started/progress/notification、静默丢弃帧（thinking_tokens/local_command/
  skip_transcript/result）。

## golden 三件套（2026-09-03 task-12 采样）

- `golden-session.json` — 完整双 turn 会话序列（38 帧）：turn 1（partial thinking/
  text 流 + Bash/Task 工具 + 子代理 depth 1）与 turn 2（Edit structuredPatch +
  Task 嵌套子代理 depth 1→2 + 终态 usage）；system/init 起手、result 终态收尾、
  用户串内容多轮边界。内容复用上方三组 fixture 的帧拼接，脱敏口径同上。
- `golden-session.events.json` — ClaudeEventNormalizer 对 golden-session.json 的
  完整事件流快照（含 partial flush；驱动协议见文件头注：假时钟每帧 +100ms、
  帧 4/26 后推进 500ms 触发节流中途 flush、帧 22/37 后 onTurnEnd）。锚定：
  daemon `tests/interactive/golden/claude-events-golden.test.ts` §1/§2。
- `golden-session.legacy-extract.json` — backend `_extract_sdk_messages` 对同
  fixture 完整帧（+旧 daemon 顶层 depth）的展开行快照（旧链路语义锚；tool_call
  行剥 timestamp 存 `tc_payload` 对象；usage stamp 为 SDK 原生全名）。锚定：
  backend `test_run_sync_golden_parity.py` §1（live 实现反向对照）+ daemon
  golden 测试 §3（normalizer 事件经 task-03 对齐规则映射后对照）。
