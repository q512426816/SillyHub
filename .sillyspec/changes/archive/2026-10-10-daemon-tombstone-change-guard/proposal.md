---
author: flow-machine-draft
created_at: 2026-10-09T23:47:00.931Z
---
# 提案书（Proposal）— 2026-10-10-daemon-tombstone-change-guard

## 动机

任务原话转写：24h 审查发现墓碑隔离执行器在 daemon 侧对 change 名零格式校验直接拼路径 renameSync，两端注释互相声称对方/CLI 有校验实际不存在，补白名单正则收口纵深缺口。
成功标准：
- SILLYSPEC_TOMBSTONE_CLEANUP 入口对 change 白名单校验（首字符字母数字、其余 [A-Za-z0-9._-]、长度 1-128、拒 ..），非法值 warn 丢弃不路由执行器，正则与 backend machines.py 同款
- sillyspec-manager.ts _requireCommandPrecondition 注释与 machines.py 请求体注释改写为与实现一致（daemon 入口白名单真实存在后声明成立），不再引用不生效的 CLI assertSafeChangeName
- 新增非法 change 形态用例先红后绿（路径穿越/分隔符/非法首字符/超长）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. SILLYSPEC_TOMBSTONE_CLEANUP 入口对 change 白名单校验（首字符字母数字、其余 [A-Za-z0-9._-]、长度 1-128、拒 ..），非法值 warn 丢弃不路由执行器，正则与 backend machines.py 同款
2. sillyspec-manager.ts _requireCommandPrecondition 注释与 machines.py 请求体注释改写为与实现一致（daemon 入口白名单真实存在后声明成立），不再引用不生效的 CLI assertSafeChangeName
3. 新增非法 change 形态用例先红后绿（路径穿越/分隔符/非法首字符/超长）

## 成功标准（可验证）

1. SILLYSPEC_TOMBSTONE_CLEANUP 入口对 change 白名单校验（首字符字母数字、其余 [A-Za-z0-9._-]、长度 1-128、拒 ..），非法值 warn 丢弃不路由执行器，正则与 backend machines.py 同款
2. sillyspec-manager.ts _requireCommandPrecondition 注释与 machines.py 请求体注释改写为与实现一致（daemon 入口白名单真实存在后声明成立），不再引用不生效的 CLI assertSafeChangeName
3. 新增非法 change 形态用例先红后绿（路径穿越/分隔符/非法首字符/超长）
