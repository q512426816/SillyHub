---
author: sillyspec-fr-index
created_at: 2026-10-02T00:58:23.758Z
---

# FR 索引 — sillyspec-manager

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/sillyspec-manager.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-sillyspec-manager-001 daemon 投影契约 v2 行级字段
变更：2026-09-20-scope-audit-cross-repo-platform
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 本机 sillyspec CLI ≥ v2 输出的 `scope-audit --json` rows 中跨仓行带 `crossRepo` 键；When daemon `auditTable()` 投影该信封；Then 每行投影出 `cross_repo`（string|null，无键/非字符串 → null），既有 8 字段形状不变；`repoPath` 不出现在投影结果
全文：.sillyspec/changes/archive/2026-09-20-scope-audit-cross-repo-platform/requirements.md#FR-01
最近确认：42c464536

## FR-sillyspec-manager-002 daemon 投影信封 repos[]
变更：2026-09-20-scope-audit-cross-repo-platform
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given CLI 信封含 `repos[]`（key/anchor{source,base,head,label}/totals{files,additions,dele；When daemon 投影；Then 逐条防御投影出 `SillySpecAuditRepo[]`（key 非空 string 否则整条跳过；anchor 四字段 asStr；`anchor_lab
全文：.sillyspec/changes/archive/2026-09-20-scope-audit-cross-repo-platform/requirements.md#FR-02
最近确认：42c464536

## FR-sillyspec-manager-003 backend schema 与透传
变更：2026-09-20-scope-audit-cross-repo-platform
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon RPC result 含 `cross_repo`/`repos`；When backend `get_scope_audit()` 构造响应；Then `ScopeAuditRow.cross_repo` 透传（isinstance str 守卫）；`repos` 为 list 时逐条防御构造 `ScopeAu
全文：.sillyspec/changes/archive/2026-09-20-scope-audit-cross-repo-platform/requirements.md#FR-03
最近确认：42c464536

## FR-sillyspec-manager-004 前端对账卡按仓分组
变更：2026-09-20-scope-audit-cross-repo-platform
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 响应 `repos` 为非空数组且 `mode === 'full-flow'`；When 渲染对账卡；Then 卡面显示全表合计行 + 每仓一段（段头=仓标识「主仓」/repo key + 锚点档 label 与短 hash；段身=三态 chips，计数取 `repos[
全文：.sillyspec/changes/archive/2026-09-20-scope-audit-cross-repo-platform/requirements.md#FR-04
最近确认：42c464536

## FR-sillyspec-manager-005 明细弹窗按仓分节
变更：2026-09-20-scope-audit-cross-repo-platform
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 分组激活（同 FR-04 条件）；When 打开「查看明细」；Then rows 按 `cross_repo` 分桶（无键归 main 桶），桶序 = `repos[]` 序（main 首位，孤儿桶尾随首现序），每桶粘性小节头（仓标
全文：.sillyspec/changes/archive/2026-09-20-scope-audit-cross-repo-platform/requirements.md#FR-05
最近确认：42c464536

## FR-sillyspec-manager-006 全链 additive 回退
变更：2026-09-20-scope-audit-cross-repo-platform
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 旧 CLI（无 repos 键）/ 旧 daemon（不投影）/ 旧 backend（无字段）/ 单仓变更（CLI 按 v2 契约不输出 repos）/ qui；When 前端渲染；Then 走现状单段渲染路径（counts-from-rows、明细平铺、既有 testid 不变），端到端与现状等价；不新增任何版本门禁错误
全文：.sillyspec/changes/archive/2026-09-20-scope-audit-cross-repo-platform/requirements.md#FR-06
最近确认：42c464536
