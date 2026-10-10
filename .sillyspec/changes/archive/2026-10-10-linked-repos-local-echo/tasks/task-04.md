---
id: task-04
title: '前端本机现状区——三态徽标/刷新/勾选导入/降级占位 + gen:types（FR-04）'
title_zh: '前端本机现状区——三态徽标/刷新/勾选导入/降级占位 + gen:types（FR-04）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 23:16:34
priority: P0
depends_on: [task-02, task-03]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/workspace/linked-repos-card.tsx
  - frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  - frontend/src/lib/linked-repos.ts
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/provider-caps.ts
  - backend/openapi.json
target_files:
  []
expects_from:
  task-02:
    snapshot-api: "见 task-02 provides.snapshot-api"
  task-03:
    import-api: "见 task-03 provides.import-api"
goal: >
  前端本机已有配置区——三态徽标展示+手动刷新+勾选导入+四态降级占位（D-002/D-003）
implementation:
  - lib/linked-repos.ts——fetchLocalSnapshot/importSelected 封装（生成类型引用，规则 21）
  - linked-repos-card.tsx 卡片底部新区——初始引导文案（零请求）；刷新本机现状按钮→快照展示（fetched_at+三态徽标：both 对勾/local_only 可勾选/platform_only 提示）；导入所选按钮（仅 owner/admin）→逐条结果 message（成功提示含「已登记，可点立即同步落盘」教育性文案，R-04）→刷新列表+快照；四态降级占位（offline/unsupported/binding_missing 各引导文案）；路径未知条目（rel_path 与 abs_path 均 null）勾选禁用
  - pnpm gen:types（api-types/openapi/provider-caps 同源提交）
  - 测试——区块初始态/刷新渲染三态/勾选导入交互/降级占位/成员按钮禁用
acceptance:
  - FR-04 GWT 过；对照上一变更原型设计语言；typecheck/lint 过
verify:
  - cd frontend && pnpm vitest run src/components/workspace/__tests__/linked-repos-card.test.tsx && pnpm typecheck && pnpm lint
constraints:
  - api-types 禁手写（gen:types）；零硬编码 hex；不自动拉快照（D-003）
  - 禁跑全量测试
---
