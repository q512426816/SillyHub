---
id: task-14
title: local.yaml + .env.example + 模块文档
title_zh: local.yaml 加 llm_provider 子模块 + .env.example 补 SILLYSPEC_MASTER_KEY + backend 模块文档
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P1
depends_on: [task-13]
blocks: []
requirement_ids: []
decision_ids: [D-009@v1]
allowed_paths:
  - .sillyspec/local.yaml
  - deploy/.env.example
  - .sillyspec/docs/backend/modules/llm_provider.md
goal: >
  收尾文档债：local.yaml 加 llm_provider 子模块条目（verify 粒度，R-06）；.env.example 补
  SILLYSPEC_MASTER_KEY（R-03）；新增 backend/modules/llm_provider.md 模块卡（照 git_identity.md 范式）。
implementation:
  - local.yaml 的 modules 块新增 llm_provider 条目，path 指向 backend/app/modules/llm_provider/，test 为 cd backend && uv run pytest app/modules/llm_provider -q --no-cov（与 ppm/frontend/sillyhub-daemon 同缩进）
  - deploy/.env.example 补 SILLYSPEC_MASTER_KEY 文档段：xchacha20-poly1305 主密钥，未配则首次 crypto 操作 503（crypto.py:37-44 use-time，非 boot 校验），与 git_identity 共用
  - 新增 .sillyspec/docs/backend/modules/llm_provider.md：定位 / 契约摘要（5 端点 + LlmProviderService）/ 关键逻辑（encrypt→encrypted_api_key+key_id / set_default 互斥 / owner 过滤）/ 注意（密钥丢失不可解 / api_key 仅 masked / R-02 全链路脱敏），frontmatter schema_version=1 doc_type=module-card module_id=llm_provider
acceptance:
  - cat .sillyspec/local.yaml 含 llm_provider 条目（path + test）
  - grep SILLYSPEC_MASTER_KEY deploy/.env.example 命中并附说明
  - .sillyspec/docs/backend/modules/llm_provider.md 存在且四段齐全
verify:
  - cat .sillyspec/local.yaml
  - grep SILLYSPEC_MASTER_KEY deploy/.env.example
constraints:
  - local.yaml 用子模块粒度（非 backend 大模块全量），避免 main 分支预存 errors 阻塞 verify（R-06）
  - .env.example 不提交真实密钥值（占位 + 文档说明）
  - 模块卡照 git_identity.md 范式（定位/契约/关键逻辑/注意/人工备注）
  - 跨平台命令链（test 字段 cd && uv run，Win/Linux/macOS 通用）
---
