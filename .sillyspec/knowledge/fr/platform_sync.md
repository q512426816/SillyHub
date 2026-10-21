---
author: sillyspec-fr-index
created_at: 2026-10-21T14:08:47.884Z
---

# FR 索引 — platform_sync

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/platform_sync.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-platform_sync-001 GET /api/changes/-/spec-manifest?since=<spec_version> 只返回该版本之后变化的清单行，响应含当前 spec_version
变更：2026-10-21-spec-manifest-incremental
状态：active
摘要：增量主路径；无变化重复拉取；存量 NULL 行不进增量流
全文：.sillyspec/changes/archive/2026-10-21-spec-manifest-incremental/requirements.md#FR-01
最近确认：5115487c570daf7efdcedd873932b50372333d36

## FR-platform_sync-002 无 since 参数时行为与现状一致（响应仅新增 spec_version 字段，向后兼容）
变更：2026-10-21-spec-manifest-incremental
状态：active
摘要：旧客户端全量拉取回归
全文：.sillyspec/changes/archive/2026-10-21-spec-manifest-incremental/requirements.md#FR-02
最近确认：5115487c570daf7efdcedd873932b50372333d36

## FR-platform_sync-003 apply_ops 落地/软删的清单行携带可游标过滤的版本印记
变更：2026-10-21-spec-manifest-incremental
状态：active
摘要：apply_ops 三类 op 后增量恰含变化行；rename 后增量取到双侧行；change_dir 平台软删后行可见
全文：.sillyspec/changes/archive/2026-10-21-spec-manifest-incremental/requirements.md#FR-03
最近确认：5115487c570daf7efdcedd873932b50372333d36

## FR-platform_sync-004 既有相关测试全绿，新增用例覆盖增量/全量/软删/边界
变更：2026-10-21-spec-manifest-incremental
状态：active
摘要：回归与新增并存
全文：.sillyspec/changes/archive/2026-10-21-spec-manifest-incremental/requirements.md#FR-04
最近确认：5115487c570daf7efdcedd873932b50372333d36

## FR-platform_sync-005 稳态清单请求 <1s（配 CLI 侧缓存后达成，本变更提供服务端能力）
变更：2026-10-21-spec-manifest-incremental
状态：active
摘要：响应体积与历史解耦
全文：.sillyspec/changes/archive/2026-10-21-spec-manifest-incremental/requirements.md#FR-05
最近确认：5115487c570daf7efdcedd873932b50372333d36
