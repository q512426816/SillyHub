---
author: flow-machine-draft
created_at: 2026-10-23T03:30:49.001Z
---
# 设计记录（Design Record）— 2026-10-23-marquee-motion-polish

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

只动跑马灯的动效参数与局部样式，不动信息结构：

1. **轨道缓出**：`turn-live-marquee.tsx` 的 rAF 速度由 `180 + distance*1.2`（恒定基础速度→急停）改为纯函数
   `marqueeSpeedForDistance(distance) = clamp(40, 1600, distance * 0.9)`：距离大时快速追赶，接近目标时逐渐减速，
   最后 0.5px 内吸附。单条约 228px 时速度约 205px/s，约 1.1s 平滑到位，与常见 1.3s 事件间隔自然衔接。
2. **内部滚动边缘渐隐**：`globals.css` 新增 `.sh-live-marquee-window`（左右各 10px mask 渐变），
   仅运行中的文本窗口挂载；完成态截断文本不挂，保持清晰。滚动时长维持 3s。
3. **流光柔化**：`.sh-live-marquee::after` 宽度 38%→22%、`filter: blur(6px)`、颜色降到 brand-300 低比例、
   周期 3.6s→6.5s，动画大部分时间隐藏，扫过时缓慢淡入淡出，避免明显色块。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增导出：`export function marqueeSpeedForDistance(distance: number): number`（纯函数，便于单测）。
- 新增 CSS 类 `.sh-live-marquee-window`（`mask-image` 左右渐隐；含 `-webkit-mask-image` 兜底）。
- `.sh-live-marquee::after` / `@keyframes sh-live-marquee-sheen` 仅参数调整，类名/keyframes 名不变。
- 组件 props、其余导出函数、后端 API / daemon 协议：**无变化**。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   - 成立。速度只依赖当前 offset 与 target 的差值，与事件顺序无关；target 仍由 entries 重算。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   - 无写面；纯展示与 CSS。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   - 安全。rAF 停排逻辑不变；reduced-motion 覆盖规则继续关闭流光与内部滚动；新增 mask 不影响静态可读性。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   - 不涉及数据；CSS 类全局但仅本组件使用。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：流光调得过淡会“看不见”，过亮又会干扰；本版取 22% 宽 + blur + 6.5s 周期为柔和档，可在原型上继续微调。
- 速度曲线：最小速度 40px/s 保证不会出现长时间拖尾；上限 1600px/s 保证事件爆发仍能追平。
- 遮罩兼容性：同时写 `mask-image` 与 `-webkit-mask-image`；不支持时退化为无渐隐（不影响功能）。
- 放弃方案：① 纯指数缓动（尾巴过长、停止时间不可预期）；② 动态测量每条文本宽度调整滚动时长（收益有限、增加大量 observer）；③ 完全去掉流光（用户要“优化”而非“删除”）。
