# 视觉证据 — 2026-10-29-edit-diff-stat-badge

## 变更性质

组件级增量徽标（Edit/Write 完成态行尾追加 `+N`/`-M` 统计），非页面级重做：
不改任何布局结构、不动既有元素位置——徽标插入跑马灯完成态条目「耗时区之前」
与进度视图工具行「状态徽标之后、时长之前」两个既有行尾流式区域，纯追加式。

## 验证方式（组件级断言，未做整页渲染捕获）

本变更无对比稿/原型稿需求（增量徽标，无「现状基线」对比面），验证以组件测试
断言承载：

- 渲染位置与内容：`turn-live-marquee.test.tsx`「渲染：完成态 Edit 条目显示
  +N -M」——断言徽标 `diff-stat-badge` 挂载于 `marquee-item` 内、textContent
  含 `+11`/`-7`；
- 语义色 class：同用例断言 `+N` 挂 `.text-emerald-600`（绿）、`-M` 挂
  `.text-destructive`（红）——与跑马灯状态点 dotClass（emerald/destructive）
  同族，双主题（blue/ai-native）语义 token 安全；
- `-0` 不出现：Write 全增用例断言 `textContent` 不含 `-0` 且红色节点为 null；
- 进度视图同款：`turn-segment-views.test.tsx` 4 用例（显示/门控），组件与
  解析器与跑马灯同源（DiffStatBadge + diffStatFromPatch），两处渲染形态由
  共享组件结构性保证一致。

## 用户裁决记录

无降级项——方案即用户原话（「+15 -8 新增绿色 删除红色」），批准留痕见
flow approve（2026-10-29T02:18:10，user-confirmed 通道）。
