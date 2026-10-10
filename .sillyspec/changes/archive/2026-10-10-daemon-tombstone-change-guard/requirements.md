---
author: flow-machine-draft
created_at: 2026-10-09T23:47:00.931Z
---
# 需求规格（Requirements）— 2026-10-10-daemon-tombstone-change-guard

## 功能需求

### FR-01: SILLYSPEC_TOMBSTONE_CLEANUP 入口对 change 白名单校验（首字符字母数字、其余 [A-Za-z0-9._-]、长度 1-128、拒 ..），非法值 warn 丢弃不路由执行器，正则与 backend machines.py 同款

- daemon 收到 SILLYSPEC_TOMBSTONE_CLEANUP 消息时，change 必须匹配白名单正则 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`（与 backend machines.py MachineSillySpecTombstoneCleanupRequest 同款）；不匹配的 change 禁止路由到执行器，必须 warn 记录 `sillyspec_tombstone_cleanup_invalid_change` 后丢弃（warn 截断至 160 字符）。

#### 场景：主路径

Given daemon 在线且收到合法 change（如 `2026-10-09-demo-change`）的墓碑清理消息 / When 消息分发 / When 执行器 `runTombstoneCleanup(change, workspaceId)` 原样透传（既有用例不动）。
Given change 为 `../evil`、`..\evil`、`a/b`、`.hidden`、`-lead`、`my change` 或 129 字符超长 / When 消息分发 / Then 执行器零调用、warn 丢弃不崩。

### FR-02: sillyspec-manager.ts _requireCommandPrecondition 注释与 machines.py 请求体注释改写为与实现一致（daemon 入口白名单真实存在后声明成立），不再引用不生效的 CLI assertSafeChangeName

- 两处注释必须如实描述守卫面分工：tombstone_cleanup 路径由 daemon.ts 入口 `SAFE_CHANGE_NAME_RE` 白名单拦截（目录拼接/renameSync 在 daemon 侧完成、不经 CLI）；resolve 等数组形参路径仍由 CLI assertSafeChangeName 拦截。禁止再声称「CLI assertSafeChangeName 双保险」覆盖墓碑路径。

#### 场景：主路径

Given 读者查阅 `_requireCommandPrecondition` docstring 与 `MachineSillySpecTombstoneCleanupRequest` docstring / When 对照 daemon.ts 入口实现 / Then 注释声明的每一道防线都能在代码中指认到落点（规则 18：注释与实现一致）。

### FR-03: 新增非法 change 形态用例先红后绿（路径穿越/分隔符/非法首字符/超长）

- 测试必须以 it.each 覆盖 7 种非法形态（`../evil` / `..\evil` / `a/b` / `.hidden` / `-lead` / `my change` / 129 字符），断言执行器零调用；实现前运行该组用例必须红（7 failed），实现后必须全绿（16/16）。

#### 场景：主路径

Given 未加白名单的旧实现 / When 跑新增用例 / Then 7 用例全红（执行器被透传调用）。
Given 加白名单后的新实现 / When 同组用例 / Then 全绿且旧 9 用例零回归。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts「%s → warn 丢弃不调用执行器（change 白名单）」（it.each 7 形态）
FR-02: 不适用：纯注释修正无行为面，一致性由人工对照 daemon.ts:SAFE_CHANGE_NAME_RE 落点核验
FR-03: sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts「%s → warn 丢弃不调用执行器（change 白名单）」（先红 7 failed 实证于 2026-10-10 07:47 运行，后绿 16/16 实证于 07:48 运行）
