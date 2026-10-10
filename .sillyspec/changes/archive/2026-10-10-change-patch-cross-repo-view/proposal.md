---
author: flow-machine-draft
created_at: 2026-10-10T11:34:47.359Z
---
# 提案书（Proposal）— 2026-10-10-change-patch-cross-repo-view

## 动机

任务原话转写：变更详情的 change-patch.json 结构化视图（内联预览+全屏弹窗共用 ChangePatchView→ScopeAuditView）不渲染 scopeAudit.repos[]——sillyspec 2026-10-10-cross-repo-patch-freeze 已把每仓锚点档/三态计数/patch 正文+patchSha256 冻结进该子对象，平台展示侧不可见；rows 表跨仓行也无仓标，与主仓行混排无法区分。
成功标准：
- ScopeAuditView 渲染 repos[]（非空数组时）：每仓一段=仓标识（key==='main' 显示「主仓」brand 色）+锚点 chip（anchor.label 文案+base 前 7 位短哈希，degraded 显示降级锚）+三态 chips（计划内/计划外/计划未动计数取 repos[].totals 单一源）+该仓 files/+−；degraded 仓段不渲染 chips，整段 ⚠️ degradedReason
- rows 表 crossRepo 字段非空的行在路径后加仓标徽章（brand 色小标签，对齐 scope-audit-command-card 形态）
- repos[].patch 键在场（'patch' in 条目）时：非空 string 可折叠展开 DiffView 正文+patchSha256 短哈希（title 全量）；null 诚实显示「patch 未采集（采集失败或空窗）」；键缺省（旧形态/未开采集）零渲染——additive 契约旧读方零感知
- 旧形态（无 repos 键/无跨仓行）渲染与现状一致，既有测试零回归
- 测试覆盖：跨仓 repos 段渲染/降级段/patch 展开+sha/null 未采集/缺键不渲染/行仓标徽章

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. ScopeAuditView 渲染 repos[]（非空数组时）：每仓一段=仓标识（key==='main' 显示「主仓」brand 色）+锚点 chip（anchor.label 文案+base 前 7 位短哈希，degraded 显示降级锚）+三态 chips（计划内/计划外/计划未动计数取 repos[].totals 单一源）+该仓 files/+−；degraded 仓段不渲染 chips，整段 ⚠️ degradedReason
2. rows 表 crossRepo 字段非空的行在路径后加仓标徽章（brand 色小标签，对齐 scope-audit-command-card 形态）
3. repos[].patch 键在场（'patch' in 条目）时：非空 string 可折叠展开 DiffView 正文+patchSha256 短哈希（title 全量）；null 诚实显示「patch 未采集（采集失败或空窗）」；键缺省（旧形态/未开采集）零渲染——additive 契约旧读方零感知
4. 旧形态（无 repos 键/无跨仓行）渲染与现状一致，既有测试零回归
5. 测试覆盖：跨仓 repos 段渲染/降级段/patch 展开+sha/null 未采集/缺键不渲染/行仓标徽章

## 成功标准（可验证）

1. ScopeAuditView 渲染 repos[]（非空数组时）：每仓一段=仓标识（key==='main' 显示「主仓」brand 色）+锚点 chip（anchor.label 文案+base 前 7 位短哈希，degraded 显示降级锚）+三态 chips（计划内/计划外/计划未动计数取 repos[].totals 单一源）+该仓 files/+−；degraded 仓段不渲染 chips，整段 ⚠️ degradedReason
2. rows 表 crossRepo 字段非空的行在路径后加仓标徽章（brand 色小标签，对齐 scope-audit-command-card 形态）
3. repos[].patch 键在场（'patch' in 条目）时：非空 string 可折叠展开 DiffView 正文+patchSha256 短哈希（title 全量）；null 诚实显示「patch 未采集（采集失败或空窗）」；键缺省（旧形态/未开采集）零渲染——additive 契约旧读方零感知
4. 旧形态（无 repos 键/无跨仓行）渲染与现状一致，既有测试零回归
5. 测试覆盖：跨仓 repos 段渲染/降级段/patch 展开+sha/null 未采集/缺键不渲染/行仓标徽章
