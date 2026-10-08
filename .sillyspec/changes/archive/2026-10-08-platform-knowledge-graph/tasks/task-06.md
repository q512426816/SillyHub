---
id: task-06
title: 'graph-canvas 组件：力场直译/静态降级/lite 摆放纯函数/三主题 token'
title_zh: 'graph-canvas 组件：力场直译/静态降级/lite 摆放纯函数/三主题 token'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 17:50:00
priority: P0
depends_on: [task-05]
blocks: [task-07]
requirement_ids: [FR-06]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/knowledge/graph-canvas.tsx
target_files:
  - NEW:frontend/src/components/knowledge/graph-canvas.tsx
goal: >
  自绘 canvas 画布：velocity Verlet 力场直译归档原型（仅 ≤200 节点切片），>200 确定性静态降级；拾取/缩放/
  平移/hover/拖拽/fitView 全交互；节点 10 类型色三主题 token 化（lanePalette 模式）。
implementation:
  - 纯函数层（导出供单测）：stepForceLayout(nodes, edges, dt)（原型 step() 直译：斥力 dist<320 力夹 0.5、边弹簧自然长 110/150/170×半径和、向心 0.004、阻尼 0.85、速度夹 ±9、NaN 自愈圆环重置）；staticLayout(nodes)（类型分环同心圆等角分布）；liteClusterLayout(clusters)（簇按 count 环形摆、簇内代表等角）；pickNode(nodes, x, y, k)（半径+7/k 容差最近者胜）；fitView(bbox, w, h)（缩放夹 [0.08,2]）；edgeDash(strength)（strong 实线/medium 6,5/weak 2,4 + 粗细 1.6/1.1）
  - 组件层：<GraphCanvas nodes edges highlight warnIds selectedId onSelect …/>：useRef canvas + rAF 循环（≤200 跑力场、>200 staticLayout 一次 + mode 提示回调）；滚轮缩放 0.3-3 光标锚点、空白拖拽平移、节点拖动钉位、hover 环、选中环 r+5；标签分级（k 阈值/选中/hover/高亮内，>26 字符截断，字号 10/sqrt(k) 补偿）；dimOthers alpha 0.06-0.1
  - 主题：NODE_PALETTE 由 themes[theme].color 组合（brand 阶+semantic+slate 映射 10 类型），组件级 CSS 变量 --kg-node-0..9 注入 + useThemeStore 订阅换肤（frontend/src/components/git-log/commit-graph.tsx:52-66 先例）；禁硬编码 hex；高亮边用 --color-brand-500 等变量
  - props 含 mode:'slice'|'lite'（lite 用 liteClusterLayout 簇气泡+代表节点静态渲染，簇气泡=背景色块+计数徽标，点代表=onSelect 回调）
acceptance:
  - 力场参数与原型逐项一致；>200 降级不启 rAF 力场
  - 三主题（blue/ai-native/dark）切换即时换色，grep 零 hex 字面量
  - 纯函数全部具名导出（task-09 单测消费）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - grep -n "#[0-9a-fA-F]\{6\}" frontend/src/components/knowledge/graph-canvas.tsx || echo 无硬编码色
constraints: >
  三主题零硬编码 hex；力场参数与原型逐项一致；纯函数具名导出
---
# task-06
