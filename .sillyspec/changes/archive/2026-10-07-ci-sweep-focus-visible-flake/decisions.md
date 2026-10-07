---
author: flow-machine-draft
created_at: 2026-10-07T15:54:42.163Z
---
# 决策记录（Decisions）— 2026-10-07-ci-sweep-focus-visible-flake

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：文件内某用例未来若断言计算样式（如尺寸/颜色）会拿到空值——当前 19 用例均只断言行为与 DOM 结构，无此面；注释已声明约束。放弃方案：vitest 全局 retry 掩盖——放弃，会掩盖全仓真实回归；只 retry 本用例——放弃，治标不治本且每次重跑仍烧 CI 时间，stub 一次根治。
