---
author: flow-machine-draft
created_at: 2026-10-23T06:18:54.173Z
---
# 任务注册表（Tasks）— 2026-10-23-marquee-blank-track-fix

- [x] task-01: 新增 `resolveMarqueeTarget`；滑动时目标回到 base，offset 补偿后平滑前进一条（FR-01）
- [x] task-02: 长会话不再空白；原型页加「长会话（210 条）」入口（FR-02）
- [x] task-03: 新增滑动目标回归测试；现有 24 用例通过（FR-03）
- [x] task-04: lint / typecheck 通过（FR-03）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx |
| 修改 | frontend/src/app/proto/session-live-marquee/page.tsx |
| 新增 | .sillyspec/changes/2026-10-23-marquee-blank-track-fix/visual-evidence.md |
