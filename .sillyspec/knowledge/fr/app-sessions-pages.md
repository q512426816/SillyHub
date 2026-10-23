---
author: sillyspec-fr-index
created_at: 2026-10-23T03:46:28.233Z
---

# FR 索引 — app-sessions-pages

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/app-sessions-pages.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-app-sessions-pages-001 弹窗每段补丁标题行有常显复制按钮（非 hover 才可见），点击复制该段完整 diff 文本
变更：2026-10-23-diff-dialog-copy-fallback
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-diff-dialog-copy-fallback/requirements.md#FR-01
最近确认：f6b0aa43c19e5ea9fc198380a8a79e78ba0b8f47

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-diff-dialog-copy-fallback:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「每段补丁有常显复制按钮，点击写入完整 diff 文本」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-diff-dialog-copy-fallback
  status: active

## FR-app-sessions-pages-002 复制文本含全部 diff 行（含超过 2000 行渲染上限的部分），hunk 分隔伪行不进入文本
变更：2026-10-23-diff-dialog-copy-fallback
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-diff-dialog-copy-fallback/requirements.md#FR-02
最近确认：f6b0aa43c19e5ea9fc198380a8a79e78ba0b8f47

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-diff-dialog-copy-fallback:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「超 2000 行复制仍完整」 | frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts「diffRowsToText：前缀重建、分隔伪行剔除、不截断」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-diff-dialog-copy-fallback
  status: active

## FR-app-sessions-pages-003 无补丁说明态/删除说明态不出现复制按钮
变更：2026-10-23-diff-dialog-copy-fallback
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-diff-dialog-copy-fallback/requirements.md#FR-03
最近确认：f6b0aa43c19e5ea9fc198380a8a79e78ba0b8f47

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-diff-dialog-copy-fallback:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「无补丁/删除说明态无复制按钮」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-diff-dialog-copy-fallback
  status: active

## FR-app-sessions-pages-004 相关测试绿（diffRowsToText 纯映射 + 弹窗按钮与复制内容）+ tsc 零错
变更：2026-10-23-diff-dialog-copy-fallback
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-diff-dialog-copy-fallback/requirements.md#FR-04
最近确认：f6b0aa43c19e5ea9fc198380a8a79e78ba0b8f47

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-23-diff-dialog-copy-fallback:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-23-diff-dialog-copy-fallback
  status: active
