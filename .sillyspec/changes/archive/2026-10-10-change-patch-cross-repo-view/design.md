---
author: flow-machine-draft
created_at: 2026-10-10T11:34:47.360Z
---
# 设计记录（Design Record）— 2026-10-10-change-patch-cross-repo-view

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

纯前端读侧适配，单文件改动：`frontend/src/components/files/structured-views.tsx` 的 `ScopeAuditView`（scope-audit.json 独立报告与 change-patch.json 的 scopeAudit 子对象共用同一渲染）增量渲染跨仓冻结面。数据链：sillyspec 仓变更 2026-10-10-cross-repo-patch-freeze（已归档，commit e7a50f35）已把 `scopeAudit.repos[]`（key/anchor/totals/degraded/degradedReason/patch/patchSha256）冻结进 change-patch.json；平台文件预览链（change-file-tree 内联预览 + json-previewer 全屏弹窗）把 JSON 全文交给 `knownJsonView` → `ChangePatchView` → `ScopeAuditView`——在这一个渲染函数补齐，两个入口同时生效，后端/daemon 零改动。

视觉形态对齐变更中心 scope-audit-command-card 的跨仓分组渲染（2026-09-20-scope-audit-cross-repo-platform 已上线范式）：主仓 brand 色标识、锚点 chip、三态 chips。一处差异：daemon 链的 `anchor_label` 短哈希是 daemon 投影产出，冻结件里没有——前端从 `anchor.base` 自行短化（`slice(0, 7)`）。patch 正文折叠块默认收起，展开后复用 `DiffView`（自带 2000 行增量渲染，大 diff 不铺满）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 修改 `frontend/src/components/files/structured-views.tsx`：`ScopeAuditView` 增三块渲染——① rows 表跨仓行仓标徽章；② `repos[]` 非空数组时表格下方按仓分段；③ 每仓段的 patch 折叠面。新增局部组件（`ScopeAuditRepoSeg` 仓段/锚点 chip/patch 折叠块），模块导出面不变（knownJsonView/JsonView/DiffView/JsonlView 等签名与行为不动）。
- 消费的数据契约（producer=sillyspec CLI，2026-10-10-cross-repo-patch-freeze 已定形）：`scopeAudit.repos[]` 条目 `{ key: string, repoPath?: string|null, anchor: {source, base, head, label}, totals: {files, additions, deletions, planned, unplanned, untouched}, degraded: boolean, degradedReason: string|null, patch?: string|null, patchSha256?: string|null }`；`rows[]` 条目可选 `crossRepo: string`。防御式解析：repos 非数组 → 不分段；条目非 record 或 key 非非空 string → 跳过；totals 字段非数值 → 计 0。
- 后端/daemon/OpenAPI 零改动——change-patch.json 走文件预览链（自由形态 JSON 文本），不经过接口 DTO，`api-types.ts` 无需 gen:types。
- testid 约定（与 command-card 同形，组件独立无冲突）：`scope-audit-repo-seg-<key>` / `scope-audit-repo-degraded-<key>` / `scope-audit-chip-<key>-<verdict>` / `scope-audit-repo-patch-<key>` / `scope-audit-repo-patch-missing-<key>`，行徽章 `data-repo-badge`。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——纯同步渲染组件，无事件流无异步输入；JSON 文本一次性 parse 后进入，不存在乱序面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用——组件零 mutation 零落盘；冻结件由 CLI 单套写纪律（writeCloseTraceArtifacts 单写点）保证无并发双版本，读侧只读快照。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全——折叠展开态为组件局部 state；预览切换文件/变更时组件重挂载，折叠态回默认收起，无状态残留风险。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会——每仓段只渲染本变更自己的 scopeAudit.repos[]，无跨工作区/跨变更串台面；主仓判定用 `key === 'main'`（CLI 既有约定，与 command-card 一致）；`repos[].repoPath` 可能含本机布局路径（CLI 侧 P2 已确认 patch 正文不含、但字段本身含），展示面不渲染该字段——本机布局不外泄。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：patch 正文内联使 change-patch.json 体积增大（跨仓多文件大 diff），预览链若对 JSON 全量 parse 可能耗内存——但 DiffView 已有 2000 行增量渲染兜底 DOM 面，且折叠默认收起，渲染成本可控；JSON.parse 本身是预览链既有成本，非本变更引入。

试过但放弃的方案：① 在变更中心 scope-audit 实时查询链（command-card）加 patch 面——该链是实时对账（快照说当下），无冻结正文书，且要动 daemon 投影白名单（repoPath 剥离逻辑），面大不做；冻结正文归属 change-patch.json 读侧。② patch 正文落独立文件族（change-patch-cross-repo/<key>.patch）——违背 2026-10-09-close-trace-single-set 单套两件纪律，producer 侧设计已显式否决（D-001@v1），平台侧不翻案。
