---
id: task-01
title: 刷新 scan 文档（重跑 sillyspec scan，source_commit 推到执行时当前 HEAD，顺带修失效文件路径引用）
title_zh: 刷新 scan 文档（重跑 scan + 修失效路径）
author: qinyi
created_at: 2026-08-06 14:04:48
priority: P0
depends_on: []
blocks: [task-02, task-03, task-04]
requirement_ids: [FR-05]
decision_ids: [D-003@v1]
allowed_paths:
  - .sillyspec/docs/SillyHub/scan/ARCHITECTURE.md
  - .sillyspec/docs/SillyHub/scan/CONCERNS.md
  - .sillyspec/docs/SillyHub/scan/CONVENTIONS.md
  - .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md
  - .sillyspec/docs/SillyHub/scan/INTEGRATIONS.md
  - .sillyspec/docs/SillyHub/scan/PROJECT.md
  - .sillyspec/docs/SillyHub/scan/STRUCTURE.md
  - .sillyspec/docs/SillyHub/scan/TESTING.md
goal: >
  把 8 篇 scan 文档 source_commit 推到执行时当前 HEAD 并顺带修失效文件路径引用，作为 drift 检测门（task-02~04）前置，避免门首日全红（D-003@v1）。
implementation:
  - 用 sillyspec-scan skill（.claude/skills/sillyspec-scan）标准 flow 重跑 scan，刷新 8 篇 scan 文档
  - 确认每篇 frontmatter source_commit 字段等于执行时 git rev-parse --short HEAD 输出，非 brainstorm 旧值 a76f2a75
  - 顺带修文档 body 失效文件路径引用（已删/改名 backend/frontend/sillyhub-daemon/deploy 路径）
  - 刷新后人工抽检 ARCHITECTURE 与 CONCERNS 两篇与代码现状一致（R-06）
acceptance:
  - 8 篇 scan 文档 frontmatter source_commit 均等于执行时 git rev-parse --short HEAD 输出
  - 文档 body 引用的 backend/frontend/sillyhub-daemon/deploy 路径在仓库存在（抽检）
  - 刷新未改 scan 文档语义结构，仅刷 source_commit 与修失效路径
verify:
  - 执行 git rev-parse --short HEAD 比对 8 篇 frontmatter source_commit 一致
  - grep 抽检 scan 文档关键路径，确认在仓库存在
constraints:
  - 用 sillyspec-scan skill 标准 flow（LLM 非确定性，主代理亲跑或子代理调 skill）
  - source_commit 取执行时当前 HEAD，禁止沿用 brainstorm 旧值 a76f2a75
  - 不改 scan 文档语义结构，只刷 source_commit + 修失效路径
  - 刷新后人工抽检 ARCHITECTURE/CONCERNS 与代码一致（R-06）
---
