---
id: task-09
title: 'generic page context for all dashboard routes'
title_zh: '通用页面上下文（任意 dashboard 路由自动感知）'
author: 'qinyi'
created_at: 2026-08-25 08:35:00
priority: P0
depends_on: [task-06, task-07]
blocks: []
requirement_ids: [FR-5]
decision_ids: [D-005]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/context.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_page_context_preamble.py
  - frontend/src/hooks/use-page-session-context.ts
  - frontend/src/hooks/use-page-session-context.test.ts
  - frontend/src/components/floating/floating-session-host.tsx
  - frontend/src/stores/floating-session.ts
  - frontend/src/components/daemon/session-panel.tsx
goal: >
  用户实测反馈（/settings/mcp 建会话无上下文）：任意注册路由自动携带
  generic_page 上下文；服务端注册表 Lookup 中文标签，枚举键零自由文本。
implementation:
  - PageContextCreateBlock 扩为判别联合（ppm_project 需 project_id / generic_page 需 route_key，格式校验）
  - context.py PAGE_ROUTE_LABELS 注册表 Lookup（未注册键 None）+ service 透传 route_key
  - 前端 hook 路由注册表派生 route_key；宿主新建会话用 显式上下文 ?? 派生上下文
acceptance:
  - 注册路由（如 settings_mcp）建会话注入 页面：设置 · MCP 前导
  - 未注册 route_key 422/静默不注入；后端 15 测试 + 前端 21 测试全绿
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/daemon/tests/test_page_context_preamble.py -q
constraints:
  - 零自由文本（枚举键 + 服务端标签注册表，防伪造注入模型不变）
  - 两侧注册表键一致（前端 ROUTE_LABELS ↔ 后端 PAGE_ROUTE_LABELS）
---
# task-09 通用页面上下文（用户实测反馈迭代）
