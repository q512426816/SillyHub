---
author: sillyspec-fr-index
created_at: 2026-10-11T15:26:46.892Z
---

# FR 索引 — auto-github

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-github-001 backend-ci.yml push 与 pull_request 两处 paths 各加 sillyhub-daemon/tests/fixtures/**，workflow 文件自身路径保留
变更：2026-10-11-backend-ci-golden-fixture-path
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-backend-ci-golden-fixture-path/requirements.md#FR-01
最近确认：4892540870bff8d45997995ad89d60eb9ed323ed

## FR-auto-github-002 YAML 语法可解析（python yaml.safe_load 过）
变更：2026-10-11-backend-ci-golden-fixture-path
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-backend-ci-golden-fixture-path/requirements.md#FR-02
最近确认：4892540870bff8d45997995ad89d60eb9ed323ed

## FR-auto-github-003 不跑全量测试（规则 0），workflow 生效由推送后 backend-ci 实跑验证
变更：2026-10-11-backend-ci-golden-fixture-path
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-backend-ci-golden-fixture-path/requirements.md#FR-03
最近确认：4892540870bff8d45997995ad89d60eb9ed323ed
