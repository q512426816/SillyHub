---
author: qinyi
created_at: 2026-08-26 19:45:00
id: task-01
title: "Backend skills write-path service"
title_zh: "后端skills写路径service"
priority: P0
depends_on: []
allowed_paths:
  - backend/app/modules/workspace/skills_view_service.py
goal: SkillsViewService 扩展写路径——5 方法 + 路径安全 helper + pydantic 模型 + AppError 族 + 审计
acceptance: |
  1. create_skill(workspace_id, name, description, actor)：白名单 ^[A-Za-z0-9._-]+$ 且拒 ..；已存在 409 HTTP_409_SKILL_ALREADY_EXISTS（中文）；生成 skills/<name>/SKILL.md（frontmatter name/description）
  2. delete_skill：rmtree 经 to_thread；删除前逐条 lstat 拒绝符号链接（symlink 防护）；审计行
  3. read/write/delete_file：路径安全 helper（resolve 后 commonpath 前缀校验 + 段白名单 + 限两层）；读 UTF-8 失败 415 / >512KB 413；写原子（tmp+replace）含新建与父目录创建；SKILL.md 删除 409 HTTP_409_SKILL_ENTRY_PROTECTED；越界 422 HTTP_422_SKILL_PATH_INVALID
  4. 每个写方法手工 AuditLog + commit（action=workspace_skill.create/delete/update_file/delete_file，details 只含 skill 名/路径不含内容）
  5. 错误族 AppError 子类就近本文件（中文 message + UPPER_SNAKE code）；list_skills 读路径零改动
implementation: skills_view_service.py 新增写方法段 + 安全 helper + pydantic 模型（SkillCreateRequest/SkillFileWriteRequest）+ AppError 子类
constraints: ["路径穿越 fail-closed（D-003@v1）", "specDir 直读直写（D-004@v1）", "手工审计（D-006@v1）", "读路径 list_skills 零改动"]
verify: cd backend && uv run pytest app/modules/workspace -q --no-cov -n auto（task-03 用例落地前既有测试全绿 + 导入检查）
provides:
  - contract: "SkillsViewService 写方法"
    fields: [create_skill, delete_skill, read_file, write_file, delete_file, 路径安全 helper, AppError 族]
---

# task-01: 后端 skills 写路径 service

按 frontmatter acceptance 实现；实现要点参照 design.md §5 Wave1。
