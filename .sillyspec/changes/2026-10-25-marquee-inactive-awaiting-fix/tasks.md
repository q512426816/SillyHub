---
author: flow-machine-draft
created_at: 2026-10-25T06:44:52.990Z
---
# 任务注册表（Tasks）— 2026-10-25-marquee-inactive-awaiting-fix

- [x] task-01: TurnLiveMarquee 新增 active（默认 true）；isAwaiting 与等待 interval 受其门控（FR-01）
- [x] task-02: SubagentBlockView 内嵌条传 active={running}（FR-02）
- [x] task-03: 外部消费点零改动（FR-03）
- [x] task-04: 新增 2 用例；两文件全部既有用例通过；lint/typecheck 通过（FR-04）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx |
| 修改 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx |
| 新增 | .sillyspec/changes/2026-10-25-marquee-inactive-awaiting-fix/visual-evidence.md |
