---
author: flow-machine-draft
created_at: 2026-10-30T07:46:14.816Z
---
# 提案书（Proposal）— 2026-10-30-quota-error-visible

## 动机

任务原话转写：共享守护进程额度耗尽时页面不显示错误

动机与背景：2026-10-30 会话 b696aa0c-bb62-4b58-95bf-965c48ad7418 两轮（15:24 / 15:28）均收到 Claude API 429「已达到 5 小时的使用上限」，但 daemon 以 success 收口（run=completed、exit_code=0、error_detail=NULL），前端 session-log-assembler 按既有约定丢弃 [ASSISTANT] API Error 文本行（假定由 turn.errorDetail 失败卡承载），结果会话页整轮空白：用户看不到额度耗尽原因，也没有重试/切换供应商入口。共享守护进程只是让同一 Claude 账号额度被多用户共同消耗（放大器），并非不显示的原因；畸形点是「成功终态 + 错误正文」这一组合没人接管。

成功标准：
- 后端收口时若上报 success 且最后一条 [ASSISTANT] 输出命中模型错误文本（API Error / Request rejected 等）且同时含 429 与额度关键词，则将该 run 落为 failed、error_code=interactive_failed、error_detail.type=quota_exceeded（保留 code/raw/reset_at）。
- 错误行之后仍有正常 [ASSISTANT] 文本（CLI 自动重试成功）或最后一条是 [MODEL_RETRY] 协议行时不得误判，run 保持 completed 且 error_detail 为空。
- 前端会话页（历史回看与刷新恢复路径）对这类轮次渲染「额度耗尽」RunErrorItem 错误卡，含原始错误摘要与重发/切换供应商入口，不再整轮空白。
- daemon 已回传 is_error=true 的既有失败轮错误卡行为零变化；成功且无错误文本的轮次零变化。
- 新增 backend 收口兜底用例与 frontend logsToTurns 兜底用例，相关测试全绿。

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 后端收口时若上报 success 且最后一条 [ASSISTANT] 输出命中模型错误文本（API Error / Request rejected 等）且同时含 429 与额度关键词，则将该 run 落为 failed、error_code=interactive_failed、error_detail.type=quota_exceeded（保留 code/raw/reset_at）。
2. 错误行之后仍有正常 [ASSISTANT] 文本（CLI 自动重试成功）或最后一条是 [MODEL_RETRY] 协议行时不得误判，run 保持 completed 且 error_detail 为空。
3. 前端会话页（历史回看与刷新恢复路径）对这类轮次渲染「额度耗尽」RunErrorItem 错误卡，含原始错误摘要与重发/切换供应商入口，不再整轮空白。
4. daemon 已回传 is_error=true 的既有失败轮错误卡行为零变化；成功且无错误文本的轮次零变化。
5. 新增 backend 收口兜底用例与 frontend logsToTurns 兜底用例，相关测试全绿。

## 成功标准（可验证）

1. 后端收口时若上报 success 且最后一条 [ASSISTANT] 输出命中模型错误文本（API Error / Request rejected 等）且同时含 429 与额度关键词，则将该 run 落为 failed、error_code=interactive_failed、error_detail.type=quota_exceeded（保留 code/raw/reset_at）。
2. 错误行之后仍有正常 [ASSISTANT] 文本（CLI 自动重试成功）或最后一条是 [MODEL_RETRY] 协议行时不得误判，run 保持 completed 且 error_detail 为空。
3. 前端会话页（历史回看与刷新恢复路径）对这类轮次渲染「额度耗尽」RunErrorItem 错误卡，含原始错误摘要与重发/切换供应商入口，不再整轮空白。
4. daemon 已回传 is_error=true 的既有失败轮错误卡行为零变化；成功且无错误文本的轮次零变化。
5. 新增 backend 收口兜底用例与 frontend logsToTurns 兜底用例，相关测试全绿。
