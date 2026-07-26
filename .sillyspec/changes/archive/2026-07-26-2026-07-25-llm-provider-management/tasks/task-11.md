---
id: task-11
title: 前端供应商管理页
title_zh: 设置页「我的供应商」区块（列表 + 新建/编辑表单 + 设默认 + 删除）
author: qinyi
created_at: 2026-07-25 17:06:11
priority: P0
depends_on: [task-04]
blocks: [task-12, task-13]
requirement_ids: [FR-06]
decision_ids: [D-002@v1, D-003@v1, D-010@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/settings/page.tsx
  - frontend/src/components/llm-providers/
provides:
  - contract: LlmProviderFormValues
    fields: [name, agent_kind, base_url, api_key, auth_field, model_role_mappings, default_fallback_model, extra_env, is_default]
goal: >
  在设置页加「我的供应商」区块（列表 + 新建/编辑表单 + 设默认 + 删除），按前端设计系统实现；
  配置跟随账号、所有工作空间通用（D-002），第一版纯自定义无预设（D-003），字段集对齐 cc-switch 核心（D-010）。
expects_from:
  task-04:
    - contract: LlmProviderAPI
      needs:
        - GET /api/llm-providers
        - POST /api/llm-providers
        - PATCH /api/llm-providers/{id}
        - DELETE /api/llm-providers/{id}
        - POST /api/llm-providers/{id}/set-default
  task-02:
    - contract: LlmProviderRead
      needs: [name, agent_kind, base_url, auth_field, model_role_mappings, default_fallback_model, extra_env, is_default, api_key_masked]
implementation:
  - settings/page.tsx：仿既有 EntryCard（技能管理 / MCP / API 密钥 / Git 身份）加「我的供应商」入口/区块
  - components/llm-providers/：列表组件（名称 + agent 种类徽标 + base_url + 模型摘要 + 默认 Badge + 编辑/设默认/删除操作）
  - 新建/编辑表单：名称 / agent 种类下拉（固定 Claude Code，codex/gemini disabled 占位）/ 备注 / 官网链接 / base_url / api_key 密码框（编辑时不填=保持原密钥不变）
  - 高级项默认折叠：认证字段下拉（ANTHROPIC_AUTH_TOKEN | ANTHROPIC_API_KEY）+ 模型角色映射表格（Sonnet/Opus/Fable/Haiku × 显示名/实际模型/1M 勾选）+ 默认兜底模型 + 自定义 env 键值编辑器（增删行）
  - 无预设选择器（D-003）；api_key 全程不明文回显，仅展示 api_key_masked
acceptance:
  - 列表正确展示当前用户供应商，默认项高亮（Badge），操作后即时刷新
  - 新建/编辑提交落库；编辑留空 api_key 不覆盖原密钥
  - 设默认 / 删除即时反映到列表
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - agent 种类下拉第一版固定 Claude Code，codex/gemini/pi disabled 占位（D-006 预留，不阻塞表单）
  - 模型角色映射固定 4 行（sonnet/opus/fable/haiku），字段 display/model/one_m；model 留空=该角色不注入（走默认兜底）
  - 自定义 env 编辑器键值对落 extra_env（{KEY:VALUE}），键重复后者覆盖
  - 按前端设计系统实现（CLAUDE.md 规则19：PageContainer/SectionCard + shadcn 视觉组件 + antd 业务组件 + StatusBadge 语义）
  - 仅消费 task-04 API 契约，不写后端逻辑
---
