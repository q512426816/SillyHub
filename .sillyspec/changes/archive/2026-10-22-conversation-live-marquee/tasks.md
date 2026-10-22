---
author: flow-machine-draft
created_at: 2026-10-22T15:18:57.705Z
---
# 任务注册表（Tasks）— 2026-10-22-conversation-live-marquee

- [x] task-01: 新增 `deriveLiveMarqueeEntries` 纯函数，覆盖全部过程类段（思考/工具/子代理/文件/stderr/系统/压缩/轮内用户/唤醒），跳过 text 段，上限 200 条（FR-01）
- [x] task-02: 新增 `TurnLiveMarquee` 组件：单行连续滚动轨道，事件到达即入轨、只向最新推进、不循环不回跳、追平即停（速度按追赶距离自适应）（FR-02）
- [x] task-03: 段 id 去重——流式思考/工具状态就地更新，不重复入队（FR-03）
- [x] task-04: `SegmentedTurnBody` 对话视图运行中轮尾接入；进度/轨迹/终态/旧回退路径不渲染（FR-04）
- [x] task-05: globals.css 动画 utility + 语义 token 样式 + 窄屏截断 + `prefers-reduced-motion` 静态降级（FR-05）
- [x] task-06: IntersectionObserver 可见性暂停/恢复，observer 不可用时不报错（FR-06）
- [x] task-07: 新增纯函数与组件测试（顺序/去重/上限/连续轨道/不循环/降级/暂停），更新接入断言；跑相关测试 + lint + typecheck（FR-07）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 新增 | frontend/src/components/daemon/turn-live-marquee.tsx |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx |
| 修改 | frontend/src/app/globals.css |
| 新增 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-*.test.tsx |
| 新增 | .sillyspec/changes/2026-10-22-conversation-live-marquee/visual-evidence.md |
