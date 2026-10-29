# Spike 记录 — task-01 zcode 遥测覆盖面核实（2026-10-29）

## 结论

zcode 心跳源由原案「stream.chunk chunkLength 折算 + 不覆盖则降级脉冲」**升级为直接消费专用 kind**——静态证据已足以钉板，无需真机预实测：

1. **通道可达**：信封层（zcode-envelope.ts 通知分发 → normalizeZcodeNotification）对 `v4/telemetry/event` 通知返回 []（当前忽略）——通知到达归一化层，消费路径存在。
2. **工具参数生成期有专用信号**：2026-10-15-zcode-engine-appserver 四轮协议实测钉板的 `v4/telemetry/event` kind 枚举（archive/…/design.md:89）含 **`tool_input_delta`**（工具参数流式增量，语义对齐 Claude input_json_delta）与 **`usage.delta`**（用量增量）。工具参数期覆盖性由 kind 枚举存在性直接证明——无需 chunkLength 猜测。
3. **心跳源修正**：zcode 心跳 = tool_input_delta（参数期字符计数，estimated）+ usage.delta（用量信号，载荷带 token 数则准权威）；「降级脉冲」分支删除——任一信号不涨/不到即无心跳，前端自然回落 awaiting 态（运行时自适应消灭预知需求）。

## 证据锚点

- `.sillyspec/changes/archive/2026-10-15-zcode-engine-appserver/decisions.md` D-003（kind 枚举实测：stream.chunk/tool_call/tool.lifecycle/**tool_input_delta**/usage.delta/turn.started/terminal；「四轮协议探测 session/send 全链路含 token 流式」）
- `.sillyspec/changes/archive/2026-10-15-zcode-engine-appserver/design.md:89`（通知面 kind 枚举全表）、:47 Phase 3（usage.delta → ctx_tokens 映射原设计）
- `sillyhub-daemon/src/interactive/zcode-events.ts:84-86`（v4/telemetry 当前被忽略——消费点）

## 遗留（task-03 实现时处理）

- tool_input_delta / usage.delta 的**载荷字段形态**（字符数/token 数字段名）2026-10-15 归档未见逐字段样本——task-03 以「实测样本单测钉映射」先例（D-003 故障面对策）落地：先按宽松解析（fail-soft 缺字段不产心跳），真机会话补样本后钉死单测。
- stream.chunk（text/thought token 级遥测）不用于心跳——文本/思考期已有 session/event model.streaming 内容流（前端可见），心跳价值为零（design 非目标已记）。
