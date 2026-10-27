---
author: flow-machine-draft
created_at: 2026-10-27T02:56:30.863Z
---
# 决策记录（Decisions）— 2026-10-27-mobile-chat-visual-round3

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：truncate 超长省略会把尾部信息（如 tok/s）截掉——已通过 mobile 不渲染 detail 优先省出宽度，极端长仍省略属可接受降级（完整信息在轮内详情可见）。放弃的方案：①轮次信息收进可点展开（交互重，分隔行本意是轻量锚点）；②返回钮用 router.back（深链进入会退出站点，显式路由恒可达）；③状态标 mobile 自建简化词表（与 PC 两套词表必漂移，直接消费单一源函数才是「同款」的正解）。
