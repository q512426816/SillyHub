---
schema_version: 1
doc_type: task
id: task-05
title: Add runtime module mapping to local.yaml
title_zh: local.yaml modules 块补 runtime 子模块条目
author: qinyi
created_at: 2026-08-20T11:05:00+08:00
change_name: 2026-08-20-runtime-readpoint-repo-first
wave: 2
allowed_paths:
  - .sillyspec/local.yaml
depends_on: [task-02]
provides: []
expects_from: []
goal: verify 按 module 对账时 git diff 命中 backend/app/modules/runtime/ 能映射到子模块测试命令，不 fallback backend 全量
implementation: modules 块加一行 runtime: { path: "backend/app/modules/runtime/", test: "cd backend && uv run pytest app/modules/runtime -q --no-cov" }（与 ppm/llm_provider 等既有条目同构，先例 2026-08-01/08-08/08-10）
acceptance: 条目存在且 YAML 语法有效（python -c "import yaml,sys; yaml.safe_load(open('.sillyspec/local.yaml'))" 或等效校验通过）
verify: 手工核对条目 + yaml 解析通过
constraints: 只加一行条目，不动文件内任何注释（local.yaml 注释是踩坑记录，CLAUDE.md/local.yaml 头部警告禁止重写）
---

# task-05：local.yaml 补 runtime 模块映射

依据：plan.md task-05；local.yaml modules 块三次同型补全先例。
