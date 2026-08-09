---
id: task-08
title: 文档收尾（CONCERNS.md incident+SSRF 三连条目标 ✅ + backend.md 变更索引）
title_zh: 文档收尾
author: qinyi
created_at: 2026-08-09 21:54:41
priority: P1
depends_on: [task-02, task-03, task-04, task-05, task-06, task-07]
blocks: []
requirement_ids: [NFR-01]
decision_ids: []
allowed_paths:
  - .sillyspec/docs/SillyHub/scan/CONCERNS.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
goal: >
  CONCERNS.md 标 incident+SSRF 三连已修复，backend.md 变更索引追加本 change 条目。
implementation:
  - CONCERNS.md incident 状态机条目(:81)行首加 ✅ 已修复(change 2026-08-09-security-backend-guardrails)+手段摘要
  - SSRF 三连条目(:65/66/67)各标 ✅+摘要
  - backend.md 变更索引(MANUAL_NOTES_END 前)追加 change 2026-08-09-security-backend-guardrails 条目(incident FSM+core/ssrf+三出站点)
acceptance:
  - 只动本变更相关条目（PPM 冒名属 change 3 不碰）
  - 引用样式对齐既有 change 前缀
verify:
  - grep "2026-08-09-security-backend-guardrails" .sillyspec/docs/SillyHub/scan/CONCERNS.md .sillyspec/docs/multi-agent-platform/modules/backend.md
constraints:
  - 不动 PPM 条目（change 3）
  - 不改 design.md/plan.md（保 review docHash）
---
纯文档卡，verify 仅 grep 关键词。PPM 冒名条目属 change 3 不得误改。
