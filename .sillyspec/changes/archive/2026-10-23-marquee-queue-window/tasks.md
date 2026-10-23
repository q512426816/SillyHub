---
author: flow-machine-draft
created_at: 2026-10-23T06:34:13.008Z
---
# 任务注册表（Tasks）— 2026-10-23-marquee-queue-window

- [x] task-01: `LIVE_MARQUEE_MAX_ENTRIES` 200→12，derive 只保留最近 12 条（FR-01）
- [x] task-02: 轨道总宽收敛约 3.3k px；窗口滑动补偿平滑前进、不跳变不循环（FR-02）
- [x] task-03: 更新上限相关测试（200→12），24 用例通过（FR-03）
- [x] task-04: lint / typecheck 通过；原型长会话验证条目 ≤12 且不空白（FR-03）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx |
| 新增 | .sillyspec/changes/2026-10-23-marquee-queue-window/visual-evidence.md |
