---
author: flow-machine-draft
created_at: 2026-10-26T07:52:13.073Z
---
# 决策记录（Decisions）— 2026-10-26-subagent-card-width-unify

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 风险：既有测试若有锁定 `w-full self-stretch` 全宽形态的断言会假红（预计无——宽度断言只锁 TextSegmentView 的 calc 限宽）；视觉上子代理卡右缘留白变化属统一预期。 - 放弃方案一：连 TurnLiveMarquee bar 变体（`w-[min(100%,52rem)]` 胶囊条）一并统一——它是独立胶囊形态非信息块，用户未点名，避免面扩大，弃（如需另行变更）。 - 放弃方案二：限宽类抽公共常量（如 SEG_MAX_W）——Tailwind JIT 扫描需要完整类名字面量，抽常量会丢样式，必须保持字面量类名，弃。
