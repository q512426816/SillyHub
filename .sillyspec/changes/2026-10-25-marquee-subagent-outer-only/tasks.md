---
author: flow-machine-draft
created_at: 2026-10-25T02:08:04.767Z
---
# 任务注册表（Tasks）— 2026-10-25-marquee-subagent-outer-only

- [x] task-01: derive 删除 children 递归（tool 带 children / subagent_stub），外部仅容器条目（FR-01）
- [x] task-02: 统一 1s tick + runningElapsedMs：运行中转圈旁显示走秒计时，完成后总耗时（FR-02）
- [x] task-03: 工具条目同款计时；无起点只转圈（FR-03）
- [x] task-04: 子代理卡片路径零改动（FR-01 验证面）
- [x] task-05: 更新递归用例 + 新增计时用例，31 用例通过；lint / typecheck 通过（FR-04）
- [x] task-06: 原型核验外部仅容器条目（FR-01）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 修改 | frontend/src/components/daemon/turn-live-marquee.tsx |
| 修改 | frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx |
| 新增 | .sillyspec/changes/2026-10-25-marquee-subagent-outer-only/visual-evidence.md |
