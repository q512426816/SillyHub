---
author: flow-machine-draft
created_at: 2026-10-17T08:11:14.413Z
---
# 决策记录（Decisions）— 2026-10-17-dsh-rc2-protocol-fix

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：dsh 后续 rc.x 再改 schema（alpha 通道本质）——非致命降级兜底使其退化为「默认模型 + warn」而非会话死亡；overlay（llm-pi-ai 路由）对 rc.2 的适配是独立后续任务（与本修复解耦）。已放弃：版本回 pin（npm latest 即 rc.2，next 线 0.2.1-rc.1 同代 schema，无更稳旧版可退）。
