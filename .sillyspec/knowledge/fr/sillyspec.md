---
author: sillyspec-fr-index
created_at: 2026-09-28T13:29:24.005Z
---

# FR 索引 — sillyspec

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/sillyspec.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auto-sillyspec-001 known-issues 观察项登记
变更：2026-09-16-background-task-grace-timeout
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given hasBackgroundTaskGrace 无界宽限风险已被 R-01 接受但暴露差未文档化；When 本变更收尾（quick --linked-changes 落盘）；Then .sillyspec/knowledge/known-issues.md 新增观察项，含四要素：暴露差（stale-flip 60min 有界 vs bg-ta
全文：.sillyspec/changes/archive/2026-09-16-background-task-grace-timeout/requirements.md#FR-01
最近确认：83b402f6b

## FR-auto-sillyspec-002 archived 载荷复活 deleted 冤案行
变更：2026-09-25-tombstone-heal-archive
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台 Change 行 location='deleted'（旧 CLI 墓碑 bug 误标）且 upsert_progress 收到新 CLI 重推的 'ar；When 已删探测命中走拒收分支；Then 行翻回 location='archive' 并走正常接受分支（面板「已归档」tab 恢复可见）；行缺失/仅 manifest 兜底判据命中/真删除链（本地 s
全文：.sillyspec/changes/archive/2026-09-25-tombstone-heal-archive/requirements.md#FR-01
最近确认：fed6e9e9a27b6363273addd25ac98f316e90db36

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-tombstone-heal-archive:flow:FR-01
  tests: backend/app/modules/platform_sync/tests/test_change_deleted_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-tombstone-heal-archive
  status: active

## FR-auto-sillyspec-003 archived 墓碑不触发镜像软删
变更：2026-09-25-tombstone-heal-archive
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given _apply_cli_tombstone 收到 status=='archived' 的墓碑载荷；When 处理 tombstone；Then no-op 早退：不动 location（P1 ingest 不变量，收敛归文件移动 + reparse）、不软删 spec 镜像（归档可回溯，区别于 dele
全文：.sillyspec/changes/archive/2026-09-25-tombstone-heal-archive/requirements.md#FR-02
最近确认：fed6e9e9a27b6363273addd25ac98f316e90db36

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-tombstone-heal-archive:flow:FR-02
  tests: backend/app/modules/platform_sync/tests/test_change_deleted_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-tombstone-heal-archive
  status: active

## FR-auto-sillyspec-004 聚焦测试全绿
变更：2026-09-25-tombstone-heal-archive
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本变更交付；When 跑 test_change_deleted_guard.py；Then 三新用例（恢复/不软删/幂等）+ 既有 13 用例全绿（16 passed 实测）
全文：.sillyspec/changes/archive/2026-09-25-tombstone-heal-archive/requirements.md#FR-03
最近确认：fed6e9e9a27b6363273addd25ac98f316e90db36

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-tombstone-heal-archive:flow:FR-03
  tests: backend/app/modules/platform_sync/tests/test_change_deleted_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-tombstone-heal-archive
  status: active

## FR-auto-sillyspec-005 不变量守恒
变更：2026-09-25-tombstone-heal-archive
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given D-002@v1（reparse 是 location owner）与 P1 ingest 不变量；When 本变更落库；Then 复活通道是唯一新增 location 写点且仅 deleted→archive 单向；镜像不软删不恢复
全文：.sillyspec/changes/archive/2026-09-25-tombstone-heal-archive/requirements.md#FR-04
最近确认：fed6e9e9a27b6363273addd25ac98f316e90db36

## FR-auto-sillyspec-006 .sillyspec/ROADMAP.md 自平台仓删除并显式 pathspec 提交
变更：roadmap-retire
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When .sillyspec/ROADMAP.md 自平台仓删除并显式 pathspec 提交；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/roadmap-retire/requirements.md#FR-01
最近确认：34fc294d4fdbac3dc4a088097220cf748f47744f

## FR-auto-sillyspec-007 读侧零改动：sillyspec CLI next.js 绿地探测/status cat/lite 豁
变更：roadmap-retire
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 读侧零改动：sillyspec CLI next.js 绿地探测/status cat/lite 豁免措辞均不动（条件化自失活）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/roadmap-retire/requirements.md#FR-02
最近确认：34fc294d4fdbac3dc4a088097220cf748f47744f

## FR-auto-sillyspec-008 daemon sillyspec-manager.ts:2184 仅为注释示例非消费点
变更：roadmap-retire
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When daemon sillyspec-manager.ts:2184 仅为注释示例非消费点；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/roadmap-retire/requirements.md#FR-03
最近确认：34fc294d4fdbac3dc4a088097220cf748f47744f

## FR-auto-sillyspec-009 纯 doc 删除，收口实测自动跳过代码面
变更：roadmap-retire
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 纯 doc 删除，收口实测自动跳过代码面；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/roadmap-retire/requirements.md#FR-04
最近确认：34fc294d4fdbac3dc4a088097220cf748f47744f

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
