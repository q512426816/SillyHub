---
id: task-10
title: 'workspace entity context and fullscreen deep link'
title_zh: '工作区实体上下文与全屏会话深链'
author: 'qinyi'
created_at: 2026-08-25 09:05:00
priority: P0
depends_on: [task-09]
blocks: []
requirement_ids: [FR-5, FR-2]
decision_ids: [D-005, D-001]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/context.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_page_context_preamble.py
  - frontend/src/hooks/use-page-session-context.ts
  - frontend/src/hooks/use-page-session-context.test.ts
  - frontend/src/components/floating/floating-session-host.tsx
  - frontend/src/components/floating/floating-session-host.test.tsx
  - frontend/src/stores/floating-session.ts
  - frontend/src/components/daemon/session-panel.tsx
goal: >
  用户实测两反馈：①工作区页只注入笼统标签"工作区"，AI 不知道用户问的是
  哪个工作区；②点全屏跳门户后当前会话不直接打开要重新找。
implementation:
  - page_key 枚举 += workspace（需 workspace_id，服务端回查 Workspace 注入名称/类型/路径）
  - 前端 hook 从 /workspaces/:id 提取 id 派生实体上下文
  - 全屏按钮改 router.push(/sessions?session=<id>) 复用门户深链契约
acceptance:
  - 工作区详情页建会话注入 工作区：{名称}/类型/路径
  - 选中会话时全屏按钮跳 /sessions?session=<id>（测试断言）
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/daemon/tests/test_page_context_preamble.py -q
constraints:
  - 零自由文本不变；service/session-panel 仍 blob 级暂存
---
# task-10 工作区实体上下文 + 全屏深链（用户实测反馈迭代 2）
