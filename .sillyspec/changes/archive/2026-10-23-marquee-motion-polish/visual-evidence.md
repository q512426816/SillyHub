# 视觉证据 — 2026-10-23-marquee-motion-polish

## 用户反馈

2026-10-23：跑马灯「流动的特效不够舒服」「流光效果也不够好」，要求优化质感。

## 改动

1. **轨道缓出**：速度公式改 `marqueeSpeedForDistance(distance) = clamp(40, 1600, distance*0.9)`；
   单条约 228px 时约 205px/s、约 1.1s 平滑到位，接近目标逐渐减速，不再恒定速度急停。
2. **边缘渐隐**：
   - 轨道视口 `.sh-live-marquee-vp` 左右各 14px 渐隐——条目进出容器不再硬切；
   - 运行中条目文本窗口 `.sh-live-marquee-window` 左右各 10px 渐隐；完成态截断文本不加，保持清晰。
3. **流光柔化**：宽度 38%→22%、`filter: blur(6px)`、brand-300 低比例、周期 3.6s→6.5s，
   大部分周期隐藏，扫过时缓慢淡入淡出（峰值 opacity 0.5），消除色块感。

## 核验

- 测试：`turn-live-marquee.test.tsx` 23 用例通过（新增速度缓出用例 + 窗口遮罩结构断言）。
- lint / typecheck 通过。
- 截图：`.proto-staging/marquee-bar-zoom.png`（可见条目左右渐隐、条目进出容器边缘柔化）；
  `.proto-staging/marquee-ai.png` / `marquee-blue.png` / `marquee-dark.png`。
- 动态效果：`http://localhost:3002/proto/session-live-marquee`（刷新查看轨道缓出、内部滚动与流光）。
- reduced-motion：流光与内部滚动仍关闭，静态可读。
