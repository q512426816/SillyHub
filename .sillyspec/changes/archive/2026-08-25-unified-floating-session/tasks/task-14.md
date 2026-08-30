---
id: task-14
title: 'full page manual coverage with platform map'
title_zh: '全页面说明书覆盖与平台全局地图'
author: 'qinyi'
created_at: 2026-08-25 23:10:00
priority: P0
depends_on: [task-13]
blocks: []
requirement_ids: [FR-5]
decision_ids: [D-005]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/context.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/session/page_docs/
  - backend/app/modules/daemon/tests/test_page_context_preamble.py
  - frontend/src/hooks/use-page-session-context.ts
  - frontend/src/hooks/use-page-session-context.test.ts
  - frontend/src/stores/floating-session.ts
  - frontend/src/components/daemon/session-panel.tsx
goal: >
  用户反馈⑧/⑨：说明书铺满每个页面与子菜单（独立文档）+ 页面间逻辑关系
  （全局意识），AI 可跨页指导用户。
implementation:
  - 44 份新文档（平台设置/管理 7 + PPM 子菜单 14 + 工作区 23 tab）+ _platform_map.md 全局地图
  - workspace 块 += tab_key（子页面说明书优先，回落总览；service create/inject 双侧透传）
  - 全局地图随三分支前导附注（主使用动线/会话体系/配置三层/PPM 业务链/横切能力/导航建议）
  - 前端 hook 全路由派生（30+ 通用键 + 工作区 tab 映射含 changes 深层细分）
acceptance:
  - 工作区 tab 会话注入对应子页说明书 + 全局地图（23/23 后端测试含 tab 选择/回落/地图断言）
  - PPM/设置/管理任意子页注入对应说明书；前端 29 hook 测试 + 714 回归绿
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/daemon/tests/test_page_context_preamble.py -q
constraints:
  - 零自由文本不变；说明书为服务端静态知识
---
# task-14 全页面说明书 + 全局地图（用户反馈⑧⑨）
