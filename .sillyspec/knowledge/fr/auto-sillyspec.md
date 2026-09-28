---
author: sillyspec-fr-index
created_at: 2026-09-28T13:42:16.459Z
---

# FR 索引 — auto-sillyspec

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-sillyspec-010 方法：按条目自带「变更：<name>」分组 → 读归档 change.patch 的交付路径判定目标
变更：2026-09-28-unmapped-batch-redomain
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 方法：按条目自带「变更：<name>」分组；Then 读归档 change.patch 的交付路径判定目标域（backend/frontend/daemon/sillyspec 四粗域，与页面一键归位口径一致）
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-01
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-011 映射表先出后审：patch 缺失/多域混合的变更用条目文本关键词兜底判定，映射表人工复核后才落盘
变更：2026-09-28-unmapped-batch-redomain
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 映射表先出后审：patch 缺失/多域混合的变更用条目文本关键词兜底判定，映射表人工复核后才落盘；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-02
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-012 699 条全部迁入真域，计数守恒（迁移前后条目总数一致，无丢失无重复）
变更：2026-09-28-unmapped-batch-redomain
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 迁移 相关模块就绪；When 699 条全部迁入真域，计数守恒（迁移前后条目总数一致，无丢失无重复）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-03
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-013 fr/unmapped.md 清空删除，INDEX 路由行同步
变更：2026-09-28-unmapped-batch-redomain
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When fr/unmapped.md 清空删除，INDEX 路由行同步；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-04
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-014 sillyspec knowledge validate 通过
变更：2026-09-28-unmapped-batch-redomain
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When sillyspec knowledge validate 通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-05
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-015 digest 伪域归零（unmapped 池 0）
变更：2026-09-28-unmapped-batch-redomain
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When digest 伪域归零（unmapped 池 0）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-06
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-016 映射依据可追溯（每个变更→域的判定来源留档在变更目录）
变更：2026-09-28-unmapped-batch-redomain
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 映射依据可追溯（每个变更；Then 域的判定来源留档在变更目录）
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-07
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236
