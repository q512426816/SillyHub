# db.sqlite token 可得性实证（task-04 前置，2026-09-20 只读探测）

对象：`~/.zcode/cli/db/db.sqlite`（mode=ro 连接，未写库）。**结论：可得（多源）**。

## 证据

1. **`model_usage` 表（per-API-call，最全）**：列含 `session_id, turn_id, assistant_message_id, parent_user_message_id, query_source, provider_id, model_id, input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens, duration_ms, raw_usage_json`。
   样例：input_tokens=278787、cache_read_input_tokens=278016、output_tokens=500、computed_total=279287（=input+output）→ **input_tokens 已含缓存命中，与 rollout 文件 inputTokens 口径一致，透传不重算**。
2. **`turn_usage` 表（per-turn 聚合）**：`session_id, turn_id, user_message_id, status, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens, model_request_count, duration_ms`——user_message_id 可反查用户消息所属轮。
3. **`part` 表 step-finish**：`data.tokens = {total, input, output, reasoning, cache:{read, write}}`（4614/万行样本）；part 列 `id, message_id, session_id, sequence` 可归属消息。
4. **`message.data`**：user 行带 `model:{providerID, modelID}`；assistant 行带 `modelID/providerId` 与 `tokens`。
5. part type 分布（实证）：text/step-start/tool/reasoning/step-finish/timeline/file。

## 透传设计落点（task-04 实现口径）

- 消息级 usage：assistant 消息 → `model_usage` 按 `assistant_message_id = message.id` 查行，取 input/output/cache_read/cache_write（snake_case 直通，不重算）；user 消息 usage=null。
- turn_id：`model_usage.turn_id`（assistant）+ `turn_usage.user_message_id → turn_id`（user 消息）。
- model：`message.data.model.modelID`（user）/ `message.data.modelId`（assistant）。
- totalUsage：`SELECT SUM(input_tokens), SUM(output_tokens), SUM(cache_read_input_tokens), SUM(cache_creation_input_tokens) FROM model_usage WHERE session_id=?`。
- 注意 zcode sqlite 会话 id 形态：`sess_<uuid>` / `sess_subagent_agent_<uuid>`（与 rollout 提取规则一致，read-zcode-sqlite.ts extractZcodeSessId 已处理）。
