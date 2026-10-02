---
author: qinyi
created_at: 2026-09-20 11:49:14
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
sillyspec 工具侧已把 `scope-audit --json` 升级为契约 v2（跨仓行按仓真实对账 + `repos[]` 信封，变更 2026-09-20-scope-audit-cross-repo 已归档），但平台链路（daemon 投影 → backend schema → 前端对账卡）仍按 v1 消费：行级 `crossRepo` 标注与信封 `repos[]` 在 daemon 投影层被丢弃、前端只按三态聚合且 note 不渲染。多仓变更（实证 workspace f85a6650：主仓 20 / sub-grid-security 13 / spdemo 9）在平台对账卡上跨仓段全部失真显示为「⚠️ 计划未动 22」，用户无法判断跨仓文件到底做没做——平台「全局视图」的价值在跨仓场景缺位。

## 关键问题
1. **跨仓真实状态不可见**：scope-audit 实际侧只采主仓 git，跨仓条目恒 untouched；工具侧 v2 已解决采集，平台不消费等于白修。
2. **对账卡误导性红牌**：「计划未动 22」看着像门禁失败，实为跨仓盲区（docs/sillyspec/finished/scope-audit-cross-repo-blindness.md 改进点 5 早已指出摘要层不可见问题）。
3. **note 全链不渲染**：CLI 产出的解释文案（分仓对账说明/降级原因/退栈提示）在前端任何位置都看不到。

## 变更范围
- daemon `auditTable` 投影增量：行级 `cross_repo` + 信封 `repos[]`（key/anchor{source,base,head,label}/anchor_label 短化/totals 含三态/degraded/degraded_reason；repoPath 不出 daemon）。
- backend `change` 模块：`ScopeAuditRow.cross_repo` + `ScopeAuditRepoAnchor/Totals/Repo` schema + `ScopeAuditResponse.repos` + service 透传 + OpenAPI 生成物（`backend/openapi.json`、`frontend/src/lib/api-types.ts` 经 gen:types）。
- 前端对账卡：按仓分段（全表合计行 + 每仓一段，主仓首位，chips 计数取 `repos[].totals`；degraded 仓降级文案）、明细弹窗按仓分节 + 跨仓行仓标徽章、note 顶到摘要层；无 `repos` 回退现状单段渲染。
- 三层测试：daemon 投影/回退/截断、backend 透传/回退、frontend 分组渲染/回退/分桶。

## 不在范围内（显式清单）
- 不改 sillyspec CLI（工具侧独立变更已交付）
- 不改 RPC method 名/端点路径/权限模型/错误映射族
- 不做平台侧 git 逻辑（锚点/git 单一源在工具）
- 不改 quick 模式链路（quick 无跨仓概念）
- 不做移动端专属布局（import 复用自动继承，仅回归）
- 存量旧快照不做平台侧回算

## 成功标准（可验证）
- workspace f85a6650 类多仓变更对账卡显示：主仓段（20/2 + 主仓锚点）+ sub-grid-security 段与 spdemo 段各带真实三态与锚点档（任务书验收原文）。
- 单仓变更 / 旧 CLI 机器：端到端渲染与现状逐字节等价（回归测试钉住）。
- degraded 仓（未注册/不可达）在卡面显示降级原因文案，不出现伪三态。
- `pnpm gen:types` 后 `api-types.ts` 含 `cross_repo`/`repos` 字段且零漂移提交。
