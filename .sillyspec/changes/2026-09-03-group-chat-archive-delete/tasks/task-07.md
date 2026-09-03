---
id: task-07
title: '前端测试——群行 hover 按钮渲染/aria、已归档徽标与按钮二选一、归档视图拉取 archived=true 与「＋」隐藏、删除确认 Modal、回调 invalidate 与清选中态'
title_zh: '前端测试——群行操作/归档视图/确认流用例'
author: 'qinyi'
created_at: '2026-09-03 16:55:15'
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: ['D-01@v1']
allowed_paths:
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
goal: >
  在既有列表面板测试文件增补群聊收纳操作用例（照文件内既有群分区/会话操作
  测试的 render/mock 模式），覆盖 design §9 前端清单。
implementation:
  - 群行 hover 按钮渲染：默认视图群行有 aria-label「归档群聊 …」与「删除群聊
    …」、无取消归档；archived_at 非空群行有「取消归档群聊 …」+「已归档」徽标
    + 行降调类名
  - 归档视图：isArchivedView（status=已归档会话哨兵）下 listGroupChats 以
    archived=true 调用（fetch mock 断言 query 参数）；分区头无「新建群聊」按钮
  - 确认流：点删除 → Modal 文案含群名与「所有成员」语义 → 确认后
    onDeleteGroup 回调触发（portal 层 invalidate 由回调实现方负责，面板测试
    断言回调调用）；取消不触发
  - 回调接线（如文件内已有 portal 级用例模式则补 portal 用例，否则面板级断言
    回调参数正确）：被操作群 id 正确透传
  - 既有用例零回归：群分区既有渲染用例在 props 扩展后不破（可选 props 缺省
    时行为不变锚点）
  - 跑法：cd frontend && pnpm vitest run
    src/components/sessions/__tests__/session-list-panel.test.tsx
acceptance:
  - 本文件全绿（含既有用例零回归）
  - 用例覆盖上述四组场景，断言到 aria-label/文案/mock 调用参数而非内部实现
verify:
  - cd frontend && pnpm vitest run src/components/sessions/__tests__/session-list-panel.test.tsx（含新增用例全绿）
constraints:
  - 纯测试卡——不改组件源码（缺陷回 task-05/06 修复后复跑），禁止弱化既有断言
  - 断言 aria-label/文案/mock 调用参数，不断言内部实现细节
---
