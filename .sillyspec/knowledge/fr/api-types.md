---
author: sillyspec-fr-index
created_at: 2026-10-08T17:55:09.787Z
---

# FR 索引 — api-types

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/api-types.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-api-types-001 sillyhub-daemon/src/api-types.ts 从仓库 backend/openapi.json 重生成，被删的 16 个死权限字符串零残留
变更：2026-10-09-daemon-api-types-regen
状态：active
摘要：类型契约对齐后端单一真相
全文：.sillyspec/changes/archive/2026-10-09-daemon-api-types-regen/requirements.md#FR-01
最近确认：7bb24ca69504433c6dafc0230047ffaadefd903a

## FR-api-types-002 daemon tsc --noEmit 0 error（生成物为纯类型面，编译门即验证门）
变更：2026-10-09-daemon-api-types-regen
状态：active
摘要：编译门
全文：.sillyspec/changes/archive/2026-10-09-daemon-api-types-regen/requirements.md#FR-02
最近确认：7bb24ca69504433c6dafc0230047ffaadefd903a

## FR-api-types-003 除生成文件外零手写代码改动
变更：2026-10-09-daemon-api-types-regen
状态：active
摘要：最小面
全文：.sillyspec/changes/archive/2026-10-09-daemon-api-types-regen/requirements.md#FR-03
最近确认：7bb24ca69504433c6dafc0230047ffaadefd903a

## FR-api-types-004 daemon-ci 在 Install 后、Typecheck 前跑 pnpm gen:types:check 漂移守门
变更：2026-10-09-daemon-ci-types-gate
状态：active
摘要：后端改契约未重生成 daemon 类型
全文：.sillyspec/changes/archive/2026-10-09-daemon-ci-types-gate/requirements.md#FR-01
最近确认：58cf516f41f5a4a03bcdd85b8f52dca555bdbb4f

## FR-api-types-005 触发路径包含 backend/openapi.json（漂移源头）
变更：2026-10-09-daemon-ci-types-gate
状态：active
摘要：后端独改触发
全文：.sillyspec/changes/archive/2026-10-09-daemon-ci-types-gate/requirements.md#FR-02
最近确认：58cf516f41f5a4a03bcdd85b8f52dca555bdbb4f

## FR-api-types-006 当前仓库守门实测绿（生成物同步提交）
变更：2026-10-09-daemon-ci-types-gate
状态：active
摘要：绿态交付
全文：.sillyspec/changes/archive/2026-10-09-daemon-ci-types-gate/requirements.md#FR-03
最近确认：58cf516f41f5a4a03bcdd85b8f52dca555bdbb4f

## FR-api-types-007 SILLYSPEC_TOMBSTONE_CLEANUP 入口对 change 白名单校验（首字符字母数字、其余 [A-Za-z0-9._-]、长度 1-128、拒 ..），非法值 warn 丢弃不路由执行器，正则与 backend machines.py 同款
变更：2026-10-10-daemon-tombstone-change-guard
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — 
全文：.sillyspec/changes/archive/2026-10-10-daemon-tombstone-change-guard/requirements.md#FR-01
最近确认：c6a7c34f424a3f3f6cbccb25dafbc6c2cce00c85

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-daemon-tombstone-change-guard:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts「%s → warn 丢弃不调用执行器（change 白名单）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-daemon-tombstone-change-guard
  status: active

## FR-api-types-008 sillyspec-manager.ts _requireCommandPrecondition 注释与 machines.py 请求体注释改写为与实现一致（daemon 入口白名单真实存在后声明成立），不再引用不生效的 CLI assertSafeChangeName
变更：2026-10-10-daemon-tombstone-change-guard
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 读者查阅 `_requireCommandPrecondition` docstring 与 `MachineSillySpecTombstoneCleanup
全文：.sillyspec/changes/archive/2026-10-10-daemon-tombstone-change-guard/requirements.md#FR-02
最近确认：c6a7c34f424a3f3f6cbccb25dafbc6c2cce00c85

## FR-api-types-009 新增非法 change 形态用例先红后绿（路径穿越/分隔符/非法首字符/超长）
变更：2026-10-10-daemon-tombstone-change-guard
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 未加白名单的旧实现 / When 跑新增用例 / Then 7 用例全红（执行器被透传调用）。 加白名单后的新实现 / When 同组用例 / Then 全绿且
全文：.sillyspec/changes/archive/2026-10-10-daemon-tombstone-change-guard/requirements.md#FR-03
最近确认：c6a7c34f424a3f3f6cbccb25dafbc6c2cce00c85

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-daemon-tombstone-change-guard:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts「%s → warn 丢弃不调用执行器（change 白名单）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-daemon-tombstone-change-guard
  status: active
