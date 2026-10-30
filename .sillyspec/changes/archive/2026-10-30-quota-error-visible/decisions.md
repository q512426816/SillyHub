---
author: flow-machine-draft
created_at: 2026-10-30T08:30:31.453Z
---
# 决策记录（Decisions）— 2026-10-30-quota-error-visible

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险是误判「重试后成功但无最终文本」的轮次。已用两道门收窄：① 只看最后一条 `[ASSISTANT]` 行（`[MODEL_RETRY]` 协议行不匹配错误特征词，直接放行）；② 必须同时命中 429 与额度关键词（复用既有双锚定 `_infer_quota_error`）。放弃的方案：改 daemon 侧识别 `isApiErrorMessage/apiErrorStatus` 字段——需要重建并重启共享守护进程，影响所有在线用户，且平台侧对旧 daemon 版本仍需兜底；放到后续 daemon 变更单独处理。第二个放弃方案：前端装配器不再丢弃 API Error 行——会在已失败轮上产生「原文气泡 + 错误卡」双显，改为按末条错误回填结构化卡。
