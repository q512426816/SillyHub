---
id: task-08
title: show bound provider in cards
title_zh: 卡片与预览展示绑定供应商
author: WhaleFall
created_at: 2026-08-11T10:35:00
priority: P1
depends_on: [task-06]
blocks: []
allowed_paths:
  - frontend/src/components/agent-profile/agent-profile-card.tsx
  - frontend/src/components/agent-profile/agent-profile-preview.tsx
  - frontend/src/components/agent-profile/agent-profile-card-grid.tsx
goal: >
  卡片与预览用 /llm-providers 列表做 id 到 name 映射，展示绑定供应商名。
implementation:
  - 复用 listLlmProviders 的 react-query 缓存做 id 到 name 映射
  - 卡片与预览在已绑定且命中时显示供应商名
  - 非本人供应商（未命中）显示 非本人供应商将回退默认
  - 未绑不显示
acceptance:
  - 绑定且本人可见时显示名
  - 非本人供应商显示回退提示
  - 未绑不渲染该信息
verify:
  - cd frontend && pnpm test agent-profile-card
constraints:
  - 不做后端 join，避免 N+1
  - 非本人不显示名（方案A 归属语义）
  - 覆盖 FR-05 / FR-08
---
