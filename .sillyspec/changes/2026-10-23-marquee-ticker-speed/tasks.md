---
author: flow-machine-draft
created_at: 2026-10-23T02:13:53.695Z
---
# 任务注册表（Tasks）— 2026-10-23-marquee-ticker-speed

- [x] task-01: `.sh-live-marquee-ticker` 单圈时长 8s → 3s，内部文本滚动明显加快（FR-01）
- [x] task-02: 仅改内部滚动速度，轨道推进/追平即停/只流到最新行为不变（FR-01）
- [x] task-03: reduced-motion 覆盖规则保持静态（FR-01）
- [x] task-04: 跑马灯 22 用例回归通过；lint / typecheck 通过（FR-01）

## 文件清单

| 操作 | 路径 |
| --- | --- |
| 修改 | frontend/src/app/globals.css |
| 新增 | .sillyspec/changes/2026-10-23-marquee-ticker-speed/visual-evidence.md |
