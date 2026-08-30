---
author: qinyi
created_at: 2026-08-26 19:45:00
id: task-03
title: "Backend full-branch tests"
title_zh: "后端全分支测试"
priority: P0
depends_on: [task-02]
allowed_paths:
  - backend/app/modules/workspace/tests/test_skills_edit.py
goal: 全分支测试矩阵（CRUD/路径穿越变体/约束/审计/中文）
acceptance: |
  1. CRUD 全分支：新建 201+文件落盘 frontmatter 断言；重名 409；非法名 422（含 .. 与特殊字符矩阵）；删 skill 目录消失；文件读/写/删真实落盘断言
  2. 路径穿越变体矩阵：../、..\、绝对路径、盘符 C:\、URL 编码变体、两层以上深层路径 → 全部 422 且磁盘零接触
  3. 约束：二进制文件 415（预置非 UTF-8 字节）；>512KB 413（读+写两向）；SKILL.md 删除 409
  4. 审计：四类写操作各落行、details 无文件内容
  5. 权限：非成员/只读成员 403；错误 message 中文
implementation: 新建 test_skills_edit.py（fixture 参照 test_mcp_config_write.py 直插模式）
constraints: ["断言真实文件副作用", "穿越用例不触盘（断言 specDir 树不变）"]
verify: cd backend && uv run pytest app/modules/workspace/tests/test_skills_edit.py -q --no-cov -n auto
expects_from:
  task-02:
    - contract: "REST 端点"
      needs: [POST skills, DELETE skills, GET/PUT/DELETE files, 错误码]
---

# task-03: 后端全分支测试

按 frontmatter acceptance 矩阵写用例。
