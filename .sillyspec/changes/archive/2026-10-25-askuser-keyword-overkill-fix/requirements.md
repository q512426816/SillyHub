---
author: flow-machine-draft
created_at: 2026-10-25T06:05:53.766Z
---
# 需求规格（Requirements）— 2026-10-25-askuser-keyword-overkill-fix

## 功能需求

### FR-01: [ASSISTANT] 回复正文含「AskUserQuestion」字样的消息不再被丢弃，全文按 reply 段装配渲染（以 96b55567 收尾汇报真实形态做回归测试）

- classifySessionLog 对以 `[ASSISTANT]` 前缀开头的行**必须**不做「含 AskUserQuestion 即丢弃」判定——正文任意位置出现该词的合法回复**必须**原样产出 kind=reply 段（text 为剥前缀全文），**禁止**静默返回 null。
- 场景回归基准：会话 96b55567 收尾汇报（1860 字，正文含「AskUserQuestion 工具卡片」字样）在收紧后**必须**被分类为 reply 且全文保留。

#### 场景：正文提及关键词的回复完整保留

- Given：daemon 落库的 `[ASSISTANT]` 前缀回复行，正文第 N 个字符处含「AskUserQuestion」（如「从『AskUserQuestion 工具卡片』换成问答块」）。
- When：classifySessionLog(content, "stdout")。
- Then：返回 `{ kind: "reply", text: <剥前缀全文> }`，text 长度与原文一致（含该词），不得为 null。

#### 场景：96b55567 真实形态回归

- Given：模拟 96b55567 收尾汇报形态的 `[ASSISTANT]` 行（千字级正文、中段含「AskUserQuestion」、以「爸爸~爸爸~[时间]：」开头）。
- When：classifySessionLog 后接 segmentsToLegacy 投影。
- Then：output 含该汇报的首尾特征文本（非仅前缀片段），整条进入轮次 output。

### FR-02: [THINKING] 正文含该词的思考行不再被误杀，正常产出 thinking 段

- classifySessionLog 对以 `[THINKING]` 前缀开头的行**必须**不做「含 AskUserQuestion 即丢弃」判定，正文提及该词时**必须**产出 kind=thinking 段。

#### 场景：思考行正文提及关键词

- Given：`[THINKING] 用户问的 AskUserQuestion 已回答，继续收口`。
- When：classifySessionLog(content, "stdout")。
- Then：返回 `{ kind: "thinking", text: "用户问的 AskUserQuestion 已回答，继续收口" }`，不得为 null。

### FR-03: AskUserQuestion 工具调用行维持现状：tool_call JSON 行仍被丢弃（提问卡由 dialog 通道 DialogQaBlock 渲染，防双画），stdout 的 [TOOL_USE] AskUserQuestion 文本行仍被丢弃

- 非正文前缀行（tool_call 通道 JSON、无 channel 裸 JSON、`[TOOL_USE] AskUserQuestion:` 文本行）含该词时**必须**维持丢弃现状，**禁止**因收紧而在过程视图新增 AskUser 工具行（提问卡权威源是 dialog 通道，双画回归禁止）。
- 垫片 sanitizeSessionLogContent 与 classifySessionLog 声明为同一套丢弃规则（session-log-sanitize.ts 头注释），其同款子串规则**必须**同步收紧，**禁止**两函数规则漂移。

#### 场景：tool_call JSON 行维持丢弃

- Given：`{"tool": "AskUserQuestion", "args": {...}}`（channel=tool_call）与同款无 channel 裸 JSON。
- When：classifySessionLog 分别调用。
- Then：均返回 null（行为与收紧前一致）。

#### 场景：[TOOL_USE] 文本行维持丢弃

- Given：`[TOOL_USE] AskUserQuestion: {"questions":[...]}`（channel=stdout）。
- When：classifySessionLog(content, "stdout")。
- Then：返回 null（由既有 [TOOL_USE] 通用丢弃规则兜底，行为不变）。

### FR-04: 触及测试全绿 + 触及文件 lint 0 errors + typecheck 通过

- 交付前触及测试文件**必须**全绿；触及文件 eslint **必须** 0 errors（存量 warning 不在承诺面）；frontend `tsc --noEmit` **必须**通过。

#### 场景：验证门

- When：vitest 跑触及测试文件 + eslint 触及文件 + tsc --noEmit。
- Then：三者全部通过（0 失败 / 0 errors / 无类型错误）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts「[ASSISTANT] 正文提及 AskUserQuestion → reply 全文保留（96b55567 形态回归）」
FR-02: frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts「[THINKING] 正文提及 AskUserQuestion → thinking 不误杀」
FR-03: frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts「AskUserQuestion 工具调用行维持丢弃（tool_call JSON / 裸 JSON / [TOOL_USE] 文本行）」
FR-04: frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts + session-log-assembler.test.ts 全量用例（npm test 触及面 + lint + typecheck 实测回执）
