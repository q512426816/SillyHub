---
id: task-09
title: Sessions page assembler integration
title_zh: /sessions 页接入装配器与子代理目录 + 文案改「进度」
author: WhaleFall
created_at: 2026-08-19T18:43:32
priority: P0
depends_on: [task-01, task-06, task-08]
blocks: [task-12]
requirement_ids: [FR-02, FR-04, FR-05]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/sessions/page.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
expects_from:
  task-01:
    - contract: applyLogToSegments
      needs: [AssembledTurn, AssemblerLogInput]
  task-06:
    - contract: SessionTurnView
      needs: [segments, turnStartedAt]
  task-08:
    - contract: SubagentCatalog
      needs: [turns, onJumpTo]
goal: >
  /sessions 页弃用 applyLogToTurn 副本改调装配器，接线计时锚点、挂子代理目录、文案改「进度」并适配测试
implementation:
  - 删除 page.tsx 内联 applyLogToTurn（约 1078-1192 行）与 partialSegmentsRef（约 229 行起及三处 clear），onLog 改为构造归一输入调 applyLogToSegments
  - upsertTurn 的 run 路由与终态幂等保留为页面胶水，新 turn 初始化装配化形状并透传计时锚点
  - 计时锚点接线——live 轮取 handleSend 占位（约 607 行）本地时钟，attach/刷新取 runsMeta 的 run.started_at，均缺由首条 log timestamp 兜底
  - SessionPanel 头部 actions 区（约 865 行）挂 SubagentCatalog，点击目录行切进度视图并滚动定位
  - viewMode 切换按钮文案「全部」改「进度」（约 885 行）
  - page.test.tsx 适配 SSE handler 注册与 attach 历史恢复相关断言（该文件实测无 viewMode 文案断言）
acceptance:
  - page.tsx 内 applyLogToTurn 与 partialSegmentsRef 清零，全仓 grep 无日志处理第二实现（FR-05）
  - live 与 attach 两路径状态条计时不归零不重计（FR-02）
  - 子代理目录仅本页头部出现，点击定位生效（FR-04）
  - viewMode 显示「对话/进度」两态，page.test.tsx 全绿
verify:
  - cd frontend && pnpm test -- --run sessions/__tests__/page.test
constraints:
  - 分类/撤回/配对逻辑一律依赖装配器导出，本文件不重写
  - 测试断言改动仅限段模型适配，不改 mock 策略与用例结构
related_tests:
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx（SSE handler 注册与 attach 恢复断言适配）
---
