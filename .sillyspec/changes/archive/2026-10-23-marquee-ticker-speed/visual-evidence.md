# 视觉证据 — 2026-10-23-marquee-ticker-speed

- 用户反馈：条目内部文本横向滚动太慢（2026-10-23）。
- 改动：`globals.css` `.sh-live-marquee-ticker` animation 8s → 3s（约 100px/s，原约 37px/s）。
- 未改：轨道推进、追平即停、只流到最新、图标/转圈/耗时、reduced-motion 静态降级。
- 原型：`http://localhost:3002/proto/session-live-marquee`（刷新即可看到提速）。
- 核验：`turn-live-marquee.test.tsx` 22 用例通过；CSS 仅时长变化，lint/typecheck 不受影响。
