---
author: flow-machine-draft
created_at: 2026-10-21T01:42:53.297Z
---
# 决策记录（Decisions）— 2026-10-21-precommit-cleanup

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：风险①：knowledge search 的索引对新增条目可能非即时（懒建/同步节奏）——FR-03 以 search 实证命中为验收，未命中则重跑 search 触发同步，验收门兜底。风险②：INDEX 锚点 slug 与 GitHub 风格推导不一致导致点击 404——对照既有 🟡 条目锚点格式（emoji 剥除、空格转连字符）书写，search 路由不依赖锚点（按关键词行），影响仅限手工点击面。死路①：把沙箱限制写进 AGENTS.md 横幅——环境事实混入流程规则面，全局注入噪音大于收益，弃（知识库按需路由）。死路②：保留 `.tmp/hooks` 作双通道备份——非官方通道留存即诱导复用，与「统一官方链」目标相悖，弃。
