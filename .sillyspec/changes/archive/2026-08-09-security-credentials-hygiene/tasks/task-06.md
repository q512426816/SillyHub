---
id: task-06
title: 改真实 deploy/.env 弱口令与 .env.example 注释
title_zh: deploy 配置弱口令清理
author: qinyi
created_at: 2026-08-09 13:18:35
priority: P1
depends_on: []
blocks: [task-07]
requirement_ids: [FR-06, FR-07]
decision_ids: []
allowed_paths:
  - deploy/.env
  - deploy/.env.example
goal: >
  把真实部署 deploy/.env 的 admin123 改为强随机占位，.env.example 补部署前改强口令注释。
implementation:
  - deploy/.env:27 PLATFORM_BOOTSTRAP_ADMIN_PASSWORD=admin123 改为 16 位强随机占位串 加注释部署前务必改
  - deploy/.env.example 补注释 部署前务必改强口令（本身已是 Admin123!@# 仅加防呆提示）
  - 注意 deploy/.env 是 gitignored untracked 本地改动不进 commit diff（AC-04b）以本地文件实际内容验收
acceptance:
  - deploy/.env:27 不再是 admin123
  - .env.example 含部署前改强口令提示
verify:
  - grep -n admin123 deploy/.env 无命中
  - grep -n admin123 deploy/.env.example 无命中
constraints:
  - deploy/.env 改动是本地操作 不进 git diff（AC-04b 已标注）
  - 不改 deploy/.env 其它配置项
  - 占位串须为强口令（≥12 位 含大小写数字符号）且不在弱口令表内 否则 task-03 validator 会拒
related_tests: []
---

# task-06 deploy 弱口令

详见 frontmatter。对照 plan AC-04b（gitignored 本地操作）。⚠️ 占位串必须是强口令，否则被 task-03 validator 拒。
