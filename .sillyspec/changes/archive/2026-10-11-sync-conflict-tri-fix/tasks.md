---
author: flow-machine-draft
created_at: 2026-10-11T09:38:34.760Z
---
# 任务注册表（Tasks）— 2026-10-11-sync-conflict-tri-fix

- [x] task-01: platform-sync-section 渲染注册表「版本冲突」型开放行（非纯墓碑）并给对比/裁决入口，未决冲突计数与横幅口径一致
- [x] task-02: daemon 增量推送撞乐观锁冲突后自动重拉 manifest re-base 一次并重试，re-base 后仍冲突才落注册表
- [x] task-03: sillyspec CLI platform sync 支持不带 --change 的全树同步；assertSafeChangeName 放行磁盘已存在的变更名
- [x] task-04: 三处修复各有单测覆盖且相关测试全绿
