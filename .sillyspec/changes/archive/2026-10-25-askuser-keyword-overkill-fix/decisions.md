---
author: flow-machine-draft
created_at: 2026-10-25T06:25:38.402Z
---
# 决策记录（Decisions）— 2026-10-25-askuser-keyword-overkill-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：放开 `[ASSISTANT]` 正文后，若存在「正文含该词且确实该丢」的历史行形态被误放行。排查生产库全量形态分布后排除：含词行仅四类（user_input 提示词——不经 classifySessionLog；[TOOL_USE] 文本行/tool_call JSON——维持丢弃；[ASSISTANT] 正文——正是要恢复的；compaction 摘要行——其丢弃由 compact 前缀分支另行处理，且本就不进对话正文）。 - 试过但放弃的方案 ①：直接删除 318 行（丢 [TOOL_USE]/tool_call 的兜底全部交给既有规则）。放弃理由：tool_call AskUserQuestion JSON 行当前也被 318 行丢弃，删除会让它落到 tool_use 段映射，过程视图新增 AskUser 工具行——与 DialogQaBlock 提问卡双画（前一轮变更刚统一的单画形态回归），行为漂移面大。 - 试过但放弃的方案 ②：按 `"tool"\s*:\s*"AskUserQuestion"` 正则精确匹配 JSON 行。放弃理由：daemon JSON 序列化空格形态不稳定（生产库实测两种形态并存），匹配脆弱；「正文前缀行豁免」一刀切更简单且对未知形态保守（非前缀行维持旧行为）。
