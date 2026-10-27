---
author: flow-machine-draft
created_at: 2026-10-27T00:23:23.251Z
---
# 决策记录（Decisions）— 2026-10-27-mobile-chat-dense

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：13px 若仍偏大/偏小需再调——参数集中在该块一处，回调成本一行。放弃的方案：改组件内 Tailwind 类（需在各组件加 mobile 分支 prop，改动面 5+ 文件）——CSS 数值变更走既有元素级通道一处收口更稳；下调至 12px 紧凑档底线——用户仅说「小点」，13px 相对 14px 保守回调一档，避免一步到底过小再回调。
