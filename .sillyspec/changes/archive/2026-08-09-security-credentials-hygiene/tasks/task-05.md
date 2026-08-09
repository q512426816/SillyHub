---
id: task-05
title: 清理文档与部署 skill 中的可复制弱口令 admin123
title_zh: 文档/skill admin123 占位化
author: qinyi
created_at: 2026-08-09 13:18:35
priority: P1
depends_on: []
blocks: [task-07]
requirement_ids: [FR-06]
decision_ids: []
allowed_paths:
  - README.md
  - docs/security-audit-2026-07-28.md
  - .claude/skills/deploy-to-server/SKILL.md
  - .claude/skills/sillyhub-docker-deploy/SKILL.md
goal: >
  把 README、安全审计报告、两个部署 skill 中可复制的 admin123 弱口令改为部署前替换占位或环境变量引用。
implementation:
  - README.md:87 admin123 改为部署前替换为强随机口令占位描述
  - docs/security-audit-2026-07-28.md 四处 admin123（:26 :89 :122 :131）改占位描述 保留审计结论措辞
  - .claude/skills/deploy-to-server/SKILL.md:164 admin123 改环境变量引用 PLATFORM_BOOTSTRAP_ADMIN_PASSWORD
  - .claude/skills/sillyhub-docker-deploy/SKILL.md:374 curl 示例 password 改环境变量引用
  - 不改 archive 历史变更文档（不运行）
acceptance:
  - 全仓 rg --no-ignore --hidden admin123 仅剩 archive 历史文档与占位说明
  - 审计报告结论语义不变 仅口令字面占位化
verify:
  - rg --no-ignore --hidden admin123 确认仅剩 archive 与占位
constraints:
  - 不动 archive 下的历史 e2e 脚本（属历史记录不运行）
  - 审计报告改字面不改结论
  - skill 示例改环境变量引用 保持可执行性
related_tests: []
---

# task-05 文档/skill 清理

详见 frontmatter。对照 plan AC-04（必须 rg --no-ignore --hidden）。
