---
id: task-07
title: agent profile form two-layer select
title_zh: 表单第一层改名与第二层供应商下拉
author: WhaleFall
created_at: 2026-08-11T10:35:00
priority: P0
depends_on: [task-06]
blocks: [task-10]
allowed_paths:
  - frontend/src/components/agent-profile-form.tsx
  - frontend/src/lib/agent-profiles.ts
goal: >
  表单大脑区第一层 label 改名智能体引擎，新增第二层供应商配置联动下拉，编辑态回显，提交带 llm_provider_id。
implementation:
  - 第一层 Form.Item label 由供应商偏好改为智能体引擎，下拉取值不变
  - ProfileFormValues 加 llm_provider_id
  - 新增第二层 Select，数据源 listLlmProviders，按第一层引擎归一化值过滤 agent_kind
  - Codex 引擎下第二层禁用并提示 codex 类供应商暂未开放
  - 编辑态 llm_provider_id 不在当前用户 options 时显示占位文案且 form value 不转 null
  - toCreateBody 与 toUpdateBody 带 llm_provider_id，null 表示解绑
acceptance:
  - label 已改名，下拉取值不变
  - 第二层按引擎联动过滤
  - Codex 引擎第二层禁用加提示
  - 编辑态未知 id 占位且不误解绑
  - 提交 body 含 llm_provider_id
verify:
  - cd frontend && pnpm test agent-profile-form
  - cd frontend && pnpm lint
constraints:
  - 遵循 FRONTEND_PAGE_STYLE.md
  - null 表示解绑，依赖后端 exclude_unset
  - 覆盖 D-001 / D-002 / D-004 / FR-01 / FR-04 / FR-07 / FR-09
---
