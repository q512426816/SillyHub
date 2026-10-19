---
author: flow-machine-draft
created_at: 2026-10-19T07:14:26.388Z
---
# 设计记录（Design Record）— 2026-10-19-change-assets-cross-repo-repos

## 做法概述

跨仓冻结成功时，真实代码 diff 与各仓计数在 `change-patch.json` 的 `scopeAudit.repos[]`，而平台 assets 聚合只读顶级 `files[]`——资产卡把「主仓面 0/模板文件」误显示成变更全貌。本次在 `ChangePatchMeta` 增 additive 的 `repos` 元数据投影（不搬运 patch 正文、不暴露 repoPath），DTO 字段保持 snake_case；前端资产卡在 repos 非空时复用既有 `ScopeAuditRepoSeg` 按仓渲染锚点/三态计数/降级说明，并把顶级统计标注为「主仓 patch」+ 指路 change-patch.json 全屏预览。`openapi.json` 与 `api-types.ts` 由既有生成器重生成，不手改。

## 接口契约

- `ChangePatchMeta` 增 `repos: list[ChangePatchRepo] = []`（additive，旧响应消费方零影响）。
- 新增 DTO：`ChangePatchRepo`（key/anchor/totals/degraded/degraded_reason/patch_sha256/has_patch）、`ChangePatchRepoAnchor`、`ChangePatchRepoTotals`。
- `_read_patch_meta` 增 `_read_patch_repos` 投影；`files/additions/deletions/file_list` 语义逐字节不变（仍只主仓面）。
- `GET /workspaces/{wid}/changes/{cid}/assets` 响应只增字段，不删不改；patch-file 切片端点零变化。
- 前端 `ScopeAuditRepoSeg` 导出（原文件内私有），资产卡传入 camelCase JSON 记录复用渲染。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   repos[] 是收口时点冻结件，读侧只投影不重算；锚点缺失/字段缺失按 None/空组 fail-open，不会因部分字段迟到而中断聚合（坏条目逐条跳过）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   本变更为纯读侧投影，无写路径；资产端点并发读同一 change-patch.json 无共享状态。生成物重生成有并行会话守卫（gen-api-types.mjs 已内建未提交改动中止）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   在途变更不读目录件（既有 is_archived 门），本投影只在归档态资产聚合内生效；请求失败/文件缺失仍走既有 None 容错。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   读取面限定当前工作区 spec_root 下的归档目录；repoPath 不投影（本机绝对路径不外泄）；多仓同名 path 只在各自 repos[].totals 计数，不与主仓 files 合并。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：读侧新增字段被误读成「主仓统计的一部分」——已在资产卡显式区分「主仓 patch / 跨仓各仓」并对 totals 不做相加。另一个风险是每次 assets 读取需解析可能数 MB 的 change-patch.json（repos 正文在场时），但既有实现本就整文件 JSON.parse 提取 files，增量可接受；如后续成为热点再做流式/缓存。放弃方案：①后端把 patch 正文一起回传给前端做切片——单仓正文 3.5MB 且会重复传输，违背「元数据进卡片、正文走全屏预览」的既有分工；②按仓切片端点（A2）——本次不需要，留待卡内直接看 diff 的需求出现再加。
