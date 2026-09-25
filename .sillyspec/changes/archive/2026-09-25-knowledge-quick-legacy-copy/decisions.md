---
author: flow-machine-draft
created_at: 2026-09-25T03:53:41.409Z
---
# 决策记录（Decisions）— 2026-09-25-knowledge-quick-legacy-copy

## D-001@v1: 风险与死路（design 槽4 收割）
- 决策：最大风险：文案改动破坏依赖字面量的组件测试——已排查命中面（precipitate:509 为子串匹配兼容；task-bar:344/history:82 两处已跟新口径）并实测三组件 38 用例全绿。试过放弃的方案：直接隐藏/移除「快速修复」蒸馏分段——放弃，存量 QUICKLOG 条目仍需可蒸馏（thin-flow 设计钉死保留存量读通道），隐藏会切断存量收尾能力。
