---
author: flow-machine-draft
created_at: 2026-10-22T03:20:59.271Z
---
# 决策记录（Decisions）— 2026-10-22-agent-profile-edit-refresh

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：风险极低（追加一次幂等失效调用）。已放弃方案：①在全局页给表单传 onSuccess 回调手动失效（页面层补丁，只修全局页一个消费面，工作区内页若他日复用同形态还会漏，且表单 props 要加口子；放弃）；②把四个 CRUD hook 全部补 mineList（delete/copy 的消费页列表桶本就正确，全局页复制/删除已有页面层手动失效覆盖，扩大面无实证收益；本变更不动）。
