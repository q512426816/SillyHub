---
id: task-05
title: Turn Segment View Components
title_zh: 段渲染组件族（turn-segment-views）
author: WhaleFall
created_at: 2026-08-19T18:43:32
priority: P0
depends_on: [task-01]
blocks: [task-06, task-08]
requirement_ids: [FR-01, FR-03, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-segment-views.tsx
provides:
  - contract: SegmentViewProps
    fields: [segment]
expects_from:
  task-01:
    - contract: TurnSegment
      needs: [kind, id, children]
goal: 新建段渲染组件族消费 TurnSegment，按原型视觉基准渲染五类段，段级 memo 加稳定 id key 保证流式更新只重渲染当前段
implementation:
  - 定义导出 SegmentViewProps（segment 统一 props）与 SegmentRenderer 按 kind 分发 StderrRow 为琥珀色警告行对齐现有警示样式
  - TextSegment 卡片气泡 MarkdownText 正文 streaming 为真时尾部闪烁光标（blink 动画）
  - ThinkingRow 折叠行 头部摘要截断并流式跟随 streaming 显「思考中」脉冲 展开正文限高滚动
  - ToolRow 单行摘要 工具名+主参数+状态徽章+耗时 running 态渐变扫动动画（sweep）点击整行展开结果 pre 限高滚动 toolName 为空原样显示 raw
  - SubagentBlock 嵌套容器 头部状态点+名称+类型徽章+时长 内部递归渲染 children 复用段组件支持 depth 大于 1 运行中头部扫动且默认展开 完成态默认折叠
  - 全部段组件 React.memo 段列表以段 id 为稳定 key
acceptance:
  - 五类段按 kind 正确分发 视觉对齐 prototype-session-stream.html（D-003 基准）streaming 光标闪烁与 running 扫动动画类名到位
  - 思考行/工具行/子代理块点击折叠交互可用 默认折叠态不挂载重内容（R-03）
  - 相同段 props 引用下 memo 生效 其它段不重渲染（FR-06）
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 纯展示组件只消费 segment props 不读 SSE/store/上层状态 动画用 CSS 类实现颜色走 tailwind 项目 token 不硬编码 hex 不引动画库
related_tests:
  - path: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
    reason: task-12 将新建 覆盖各段类型/折叠交互/扫动动画类名
---
