---
id: task-05
title: '前端类型与 lib——pnpm gen:types（node_modules 预检）+ daemon.ts archiveGroupChat/unarchiveGroupChat/deleteGroupChat 三函数与 listGroupChats archived 参数 + group-chat-panel presence 显式 archived:null'
title_zh: '前端类型与 lib——gen:types + 三函数 + presence 消费点适配'
author: 'qinyi'
created_at: '2026-09-03 16:55:15'
priority: P0
depends_on: ['task-03']
blocks: ['task-06']
requirement_ids: [FR-04]
decision_ids: ['D-01@v1']
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/daemon.ts
  - frontend/src/components/group-chat/group-chat-panel.tsx
  # plan 审查修正（review-2026-09-03-165814 第 8 项）：daemon.test.ts 零群函数
  # 用例（41 例全会话函数），无参调用 apiFetch("/api/daemon/group-chats") 的
  # 真实回归锚点在 create-group-wizard.test.tsx:401-404——补入本卡范围。
  - frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx
goal: >
  打通前端消费链：后端 schema 变更再生成类型产物（CLAUDE.md 规则 21——
  openapi.json + api-types.ts 同 change 提交），lib 层补三个操作函数与列表
  archived 参数，群面板 presence 查询显式传 archived:null 防已归档群绿点回归。
implementation:
  - gen:types 前预检 node_modules 健康（pnpm exec tsc --version 可跑、
    .bin 有 openapi-typescript shim；半坏则 pnpm install --force——CLAUDE.md
    规则 20 假报错教训）
  - cd frontend && pnpm gen:types：确认产物含三端点 + GroupChatRead.archived_at；
    若暴露无关旧测试债（mock 缺字段类）按惯例顺手补齐不回避
  - daemon.ts：listGroupChats 改签名 (opts?: { archived?: boolean | null })
    → querystring 序列化（undefined=不传走 HTTP 默认；true/false/null 显式）；
    新增 archiveGroupChat/unarchiveGroupChat/deleteGroupChat（POST/POST/DELETE，
    204 空，照 endGroupChat 风格 + 注释引用变更名）
  - group-chat-panel.tsx presence 查询（765-771 邻域）queryFn 改
    listGroupChats({ archived: null })，注释锚定 design §6.2b（已归档群仍可
    打开聊天，presence 按 id 查找不能被默认过滤滤掉）；queryKey 保持
    ["groupChats","list",null]——portal invalidate 前缀仍命中
acceptance:
  - pnpm exec tsc --noEmit 零错误（frontend）
  - 既有 create-group-wizard.test.tsx 全绿（无参 listGroupChats 走 HTTP 默认，
    apiFetch 单参形态断言天然保绿）；新增 archived 参数序列化用例落本文件
    （true/false/null 三态 query 形态断言）
  - api-types.ts 为生成产物非手写（git diff 无手工痕迹）
verify:
  - cd frontend && pnpm gen:types（产物含三端点 + archived_at）
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run src/components/sessions/__tests__/create-group-wizard.test.tsx src/components/group-chat/__tests__/group-chat-panel.test.tsx
constraints:
  - gen:types 前必须 node_modules 健康预检（CLAUDE.md 规则 20 假报错教训）
  - listGroupChats 签名扩展必须向后兼容（undefined=不传参走 HTTP 默认，三处
    无参消费点零改动）
  - api-types.ts 禁止手写
---
