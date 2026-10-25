---
author: flow-machine-draft
created_at: 2026-10-25T06:05:53.766Z
---
# 设计记录（Design Record）— 2026-10-25-askuser-keyword-overkill-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

会话 96b55567 排查实证：`classifySessionLog` 首道丢弃规则 `trimmed.includes("AskUserQuestion")`（session-log-assembler.ts:318）是全子串匹配——daemon 落库的 `[ASSISTANT]` 回复正文只要*提到*该词（本次事故：会话恰好在做 AskUser 组件统一，收尾汇报含「AskUserQuestion 工具卡片」字样），整条回复即被静默丢弃，前端对话视图丢内容且无任何失败卡兜底。生产库形态分布实证：含该词的行里真正需要丢弃的只有 AskUser 工具调用行（tool_call JSON 权威行、stdout `[TOOL_USE] AskUserQuestion:` 双发文本行、无 channel 裸 JSON），其中 `[TOOL_USE]` 文本行已被下方既有 `[TOOL_USE]` 通用丢弃规则（347 行）兜底。

方案：把 318 行收紧为「正文前缀行豁免」——`if (!/^\[(ASSISTANT|THINKING)\]\s?/.test(trimmed) && trimmed.includes("AskUserQuestion")) return null;`。即 `[ASSISTANT]`/`[THINKING]` 前缀行不再做该子串判定（落回各自正常分类分支：reply / thinking / API 错误行首锚定检查），其余行（tool_call JSON、裸 JSON、[TOOL_USE] 文本行等）维持原丢弃行为零变化。同款收紧同步到垫片 `sanitizeSessionLogContent`（session-log-sanitize.ts:44 同种子串规则，生产零消费方但文档声明与 classifySessionLog 同一套规则，防规则漂移——规则 18）。收紧思路对齐 ql-20260906-001 对 `isAssistantApiErrorText` 的行首锚定先例（该先例注释明确记录过「全文任意位置匹配会把正文提到这些词的合法回复整条吞掉」的同型事故）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `classifySessionLog(content, channel?, toolKind?)`（session-log-assembler.ts 导出）：签名不变；行为变化仅一处——`[ASSISTANT]`/`[THINKING]` 前缀行含「AskUserQuestion」时从「返回 null（丢弃）」变为「正常分类（reply/thinking）」。其余所有输入形态返回值不变。
- `sanitizeSessionLogContent(content, channel?)`（session-log-sanitize.ts 导出）：签名不变；同款行为变化（该函数现无生产消费方，仅测试引用，变化无线上影响）。
- 无端点/存储/协议变化；daemon 落库格式不动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。本变更只改「分类是否丢弃」的纯函数判定，不触碰装配时序（override 撤回/流式合并/去重全部不在改动路径）。96b55567 的丢失形态与流式乱序无关（逐条装配轨迹实证：该行在分类层 classifySessionLog 即返回 null），收紧后无论行序如何，reply/thinking 前缀行都进装配，行为单调改善。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用。纯函数无共享状态、无 IO。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。无状态迁移。历史已丢失消息不丢数据（平台库原文完整），收紧后用户重新打开会话/刷新即按新规则装配恢复显示，无需数据回填。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。单仓单模块（frontend 会话面板装配层），无跨工作区/跨仓数据流。tool_call AskUserQuestion 行维持丢弃，过程视图不会新增工具行，与 2026-10-25-session-tab-visual-unify 的 DialogQaBlock 单画约定无冲突。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：放开 `[ASSISTANT]` 正文后，若存在「正文含该词且确实该丢」的历史行形态被误放行。排查生产库全量形态分布后排除：含词行仅四类（user_input 提示词——不经 classifySessionLog；[TOOL_USE] 文本行/tool_call JSON——维持丢弃；[ASSISTANT] 正文——正是要恢复的；compaction 摘要行——其丢弃由 compact 前缀分支另行处理，且本就不进对话正文）。
- 试过但放弃的方案 ①：直接删除 318 行（丢 [TOOL_USE]/tool_call 的兜底全部交给既有规则）。放弃理由：tool_call AskUserQuestion JSON 行当前也被 318 行丢弃，删除会让它落到 tool_use 段映射，过程视图新增 AskUser 工具行——与 DialogQaBlock 提问卡双画（前一轮变更刚统一的单画形态回归），行为漂移面大。
- 试过但放弃的方案 ②：按 `"tool"\s*:\s*"AskUserQuestion"` 正则精确匹配 JSON 行。放弃理由：daemon JSON 序列化空格形态不稳定（生产库实测两种形态并存），匹配脆弱；「正文前缀行豁免」一刀切更简单且对未知形态保守（非前缀行维持旧行为）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | frontend/src/components/daemon/session-log-assembler.ts | 318 行子串丢弃规则收紧为正文前缀行豁免 + 注释同步（规则 18） |
| 改 | frontend/src/components/daemon/session-log-sanitize.ts | sanitizeSessionLogContent 第 44 行同款收紧 + 头注释过滤规则描述同步 |
| 改 | frontend/src/components/daemon/__tests__/session-log-sanitize.test.ts | 新增 FR-01/02/03 回归用例；既有「过滤 AskUserQuestion 原始 JSON」用例语义校对（裸 JSON 维持丢弃，预期不变） |
