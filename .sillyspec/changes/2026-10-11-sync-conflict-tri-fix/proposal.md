---
author: flow-machine-draft
created_at: 2026-10-11T09:38:34.760Z
---
# 提案书（Proposal）— 2026-10-11-sync-conflict-tri-fix

## 动机

任务原话转写：动机：spec 同步乐观锁冲突闭环断裂——横幅报 1 条而平台同步区块渲染 0 且无裁决入口；daemon 撞冲突只 warn 不 re-base 致冲突行永久滞留；CLI 缺全树同步且变更名守卫拒绝磁盘已存在的中文名变更（实测 2026-10-10-取消LTC宽表校验规则 被 assertSafeChangeName 拒）。

成功标准：
- platform-sync-section 渲染注册表「版本冲突」型开放行（非纯墓碑）并给对比/裁决入口，未决冲突计数与横幅口径一致
- daemon 增量推送撞乐观锁冲突后自动重拉 manifest re-base 一次并重试，re-base 后仍冲突才落注册表
- sillyspec CLI platform sync 支持不带 --change 的全树同步；assertSafeChangeName 放行磁盘已存在的变更名
- 三处修复各有单测覆盖且相关测试全绿

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. platform-sync-section 渲染注册表「版本冲突」型开放行（非纯墓碑）并给对比/裁决入口，未决冲突计数与横幅口径一致
2. daemon 增量推送撞乐观锁冲突后自动重拉 manifest re-base 一次并重试，re-base 后仍冲突才落注册表
3. sillyspec CLI platform sync 支持不带 --change 的全树同步；assertSafeChangeName 放行磁盘已存在的变更名
4. 三处修复各有单测覆盖且相关测试全绿

## 成功标准（可验证）

1. platform-sync-section 渲染注册表「版本冲突」型开放行（非纯墓碑）并给对比/裁决入口，未决冲突计数与横幅口径一致
2. daemon 增量推送撞乐观锁冲突后自动重拉 manifest re-base 一次并重试，re-base 后仍冲突才落注册表
3. sillyspec CLI platform sync 支持不带 --change 的全树同步；assertSafeChangeName 放行磁盘已存在的变更名
4. 三处修复各有单测覆盖且相关测试全绿
