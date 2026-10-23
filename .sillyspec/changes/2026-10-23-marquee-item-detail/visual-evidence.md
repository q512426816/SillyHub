# 视觉证据 — 2026-10-23-marquee-item-detail

> UI 契约：真码原型，直接引用实现组件 `TurnLiveMarquee`。

## 原型

- 路由：`frontend/src/app/proto/session-live-marquee/page.tsx`（沿用上一次变更的 dev-only 原型）
- 演示内容：最新一条保持 running（转圈 + 条目内部文本循环），历史条目已完成并显示耗时；
  工具段带真实 `startedAt/endedAt`（0.8s / 1.2s / 1.6s / 2.1s / 3.8s），thinking 由客户端计时。
- 主题：AI 紫 / 经典蓝 / 暗夜可切换。

## 用户裁决

- 2026-10-23：条目进行中显示转圈，内部信息持续横向滚动（如「思考：1 2 3 → 3 4 5 → 5 6 7」），
  完成后显示「Timer 图标 + 耗时」；图标必须用项目 UI（lucide），禁止 emoji 字符串；条目宽度适当加宽。

## 实现要点

- 图标：lucide 单色组件（Brain / Terminal / FileText / Search / Wrench / Bot / FileUp / AlertTriangle /
  Info / Minimize2 / MessageSquare / Bell），走 `currentColor` + 主题 token。
- 进行中：右侧 CSS 圆环转圈；文本区 `.sh-live-marquee-ticker` 双份内容 8s 循环；图标/耗时固定不滚动。
- 完成：停止滚动、单份截断、Timer 图标 + `formatMarqueeDuration`（820ms / 1.5s / 1m 05s）。
- 耗时：tool/subagent 用段真实 startedAt/endedAt；thinking 客户端从首次 running 计到完成；
  历史已完成无数据不显示（不伪造）。
- 宽度：13rem → 16rem。

## 核验

- 测试：`turn-live-marquee.test.tsx` 21 用例通过（含转圈/内部滚动/耗时/布局/降级）；
  turn-timeline 相关回归 32 用例通过。
- lint / typecheck 通过。
- 截图（Playwright Chromium 1440×1000 @2x/@4x）：
  - `.proto-staging/marquee-ai.png`：AI 紫整页（条目 lucide 图标、1.6s 耗时、末尾 running 转圈）；
  - `.proto-staging/marquee-blue.png` / `marquee-dark.png`：蓝 / 暗主题；
  - `.proto-staging/marquee-bar-zoom.png`：条目局部放大（可见滚动中的文本片段、Timer 耗时、转圈）。
- 原型地址：`http://localhost:3002/proto/session-live-marquee`（3000/3001 被并行会话占用时 Next 自动顺延端口）。
