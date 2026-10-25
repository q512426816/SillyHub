---
author: flow-machine-draft
created_at: 2026-10-25T11:51:27.294Z
---
# 任务注册表（Tasks）— 2026-10-25-marquee-awaiting-real-data

- [x] task-01: TurnLiveMarquee 新增 lastEventAt：服务端起点优先、刷新不重置、缺省回退客户端（FR-01）
- [x] task-02: TurnLiveMarquee 新增 turnTokens：等待条目回显 ↑↓，无数据不显示（FR-02）
- [x] task-03: SegmentedTurnBody 派生 lastEventAt 并传 token（双模式共用）；卡片内嵌条不传（FR-03）
- [x] task-04: 新增 2 用例 + 既有全绿；lint/typecheck 通过（FR-04）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx |
| 新增 | .sillyspec/changes/2026-10-25-marquee-awaiting-real-data/visual-evidence.md |
