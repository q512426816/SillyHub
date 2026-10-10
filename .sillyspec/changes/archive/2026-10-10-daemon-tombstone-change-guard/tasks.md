---
author: flow-machine-draft
created_at: 2026-10-09T23:47:00.931Z
---
# 任务注册表（Tasks）— 2026-10-10-daemon-tombstone-change-guard

- [x] task-01: SILLYSPEC_TOMBSTONE_CLEANUP 入口对 change 白名单校验（首字符字母数字、其余 [A-Za-z0-9._-]、长度 1-128、拒 ..），非法值 warn 丢弃不路由执行器，正则与 backend machines.py 同款
- [x] task-02: sillyspec-manager.ts _requireCommandPrecondition 注释与 machines.py 请求体注释改写为与实现一致（daemon 入口白名单真实存在后声明成立），不再引用不生效的 CLI assertSafeChangeName
- [x] task-03: 新增非法 change 形态用例先红后绿（路径穿越/分隔符/非法首字符/超长）
