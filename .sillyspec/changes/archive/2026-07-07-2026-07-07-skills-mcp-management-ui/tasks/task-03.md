---
author: qinyi
created_at: 2026-07-07 23:22:00
goal: skills_bundle_service 合并 DB CustomSkill 进 manifest/bundle
implementation: 改 backend/app/modules/agent/skills_bundle_service.py 的 _collect_skill_files/build_skills_manifest/build_skills_bundle：扫描代码库 sillyspec-* 后，从 DB 查全部 CustomSkill，每个 → `<name>/SKILL.md`（content 写入）追加进 files 列表 + bundle；version hash 含 DB 内容
acceptance: manifest/bundle 含代码库 sillyspec-* + DB 自定义 skills；编辑/新增/删除 CustomSkill 后 version 变化；daemon 拉取解压后 .claude/skills/<自定义 name>/SKILL.md 存在
verify: cd backend && uv run pytest tests/modules/agent/test_skills_bundle.py + 新测 test_bundle_includes_custom_skills
constraints: 不破坏现有 sillyspec-* glob 扫描；version 算法含 DB content hash；显式包含不靠 glob（D-001）
depends_on: [task-01]
covers: [FR-02, D-001]
---

# task-03: backend bundle 合并 DB 自定义 skills

## 验收标准
A. `build_skills_manifest`/`build_skills_bundle` 输出含代码库 sillyspec-* + DB CustomSkill（`<name>/SKILL.md`）。
B. DB CustomSkill 内容变化（增/删/改 content）→ version hash 变化（daemon 可检测重拉）。
C. 既有 sillyspec-* 扫描零回归；空 DB CustomSkill 时输出 = 纯代码库（兼容）。
