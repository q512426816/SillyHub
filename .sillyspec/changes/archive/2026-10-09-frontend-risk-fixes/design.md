---
author: flow-machine-draft
created_at: 2026-10-08T17:38:11.159Z
---
# 设计记录（Design Record）— 2026-10-09-frontend-risk-fixes

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

四处独立小修，全部来自 2026-10-09 风险审查的高置信发现：(1) `knowledge/page.tsx` 新增 `entryError` 内容区错误态——selectEntry 失败分支就近渲染错误文案 + 重试按钮（重试=对当前文件重发 selectEntry，seq 守卫天然覆盖），修复 323faef56「中间态切断」引入的永久加载占位回归；(2) `entry-card-list.tsx` 的 `copyText` 改返回 boolean（去掉可选链，clipboard undefined 时 writeText 访问抛错进 catch 返回 false），AnchorCopyButton 按真实结果 success/error 提示，对齐 governance-cards copyPrompt 范式；(3) `knowledge.ts` 的 overview/query 两个请求显式传 `timeoutMs`（200s/90s）对齐服务端 GRAPH_RPC_TIMEOUT=60s×1 或 ×3 的最坏预算，不再吃 apiFetch GET 缺省 30s；(4) `graph-canvas.tsx` 的 `onPointerDown` 置位 `userTouchedRef`（与 onWheel 双源），并把 re-fit 判定提取为导出纯函数 `shouldAutoRefit(tick, userTouched)` 供测试钉住语义。选择就地最小修复而非重构：四处均为一两处点的行为缺陷，无接口面变化。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `frontend/src/components/knowledge/entry-card-list.tsx`：模块内私有 `copyText(text): Promise<boolean>`（原 void）；AnchorCopyButton 点击反馈从无条件成功改为按结果 success/error。无对外导出变化。
- `frontend/src/components/knowledge/graph-canvas.tsx`：新导出纯函数 `shouldAutoRefit(tick, userTouched)`（effect 内原内联判定改调它）；`onPointerDown` 新增置位行为。既有导出零变化。
- `frontend/src/lib/knowledge.ts`：`getKnowledgeGraphOverview`/`getKnowledgeGraphQuery` 内部 apiFetch options 增加 `timeoutMs`（200_000/90_000）；签名零变化。
- `frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx`：新增组件内 state `entryError` 与内容区 `entry-error` 分支（data-testid 契约新增）；props 零变化。
- HTTP 端点 / 后端 / api-types：零变化（纯前端行为修复，无 schema 触达，不需 gen:types）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。entryError 与既有 seq 守卫正交：过期响应（含其错误）仍被丢弃，entryError 只由最新 seq 的失败置位，新一次选择即清；图谱超时只改 abort 时点不改响应处理序。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不涉及并发写面——四处均为纯前端单会话交互态/UI 反馈/请求配置；copyText 无共享态，shouldAutoRefit 为纯函数。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全。entryError 随组件卸载销毁；重试走同一 selectEntry 通道不产生叠加请求外的新生命周期；timeoutMs 只延长等待，页面卸载时 query 取消语义（AbortController 外部 signal 合并）不变；userTouchedRef 是画布实例内 ref，数据重建 effect 复位行为保持原样（fitSignal 语义未动）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会。四处均无跨工作区共享态；entryError/timeoutMs/shouldAutoRefit 作用域都在单组件或单请求工厂内。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：overview 等待最长 200s——期间 UI 无中间反馈（react-query isLoading 态），用户可能重复刷新；属既有 UX 债非本变更引入，后续可加进度提示。次风险：copyText 去掉可选链后，jsdom/旧浏览器上 clipboard 缺失路径从「静默 no-op」变为「失败提示」——全文路径复制（fulltext-link）调用方仍忽略返回值静默降级（本体是可见文本），锚点复制从假成功变真失败提示，方向正确。试过放弃：(a) 渲染级测试钉 onPointerDown 置位——放弃，jsdom 无 canvas 2D 上下文，rAF 循环 effect 早退不可观测，改为提取 shouldAutoRefit 纯函数 + 双源置位一行接线（仓库 graph-canvas.test 纯函数惯例）；(b) 后端并发化 overview 三 RPC 缩短总预算——放弃，RPC 客户端并发安全性未证且超出本变更（前端风险收口）范围。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | entryError 状态 + 内容区错误分支 + 重试 |
| 修改 | frontend/src/components/knowledge/entry-card-list.tsx | copyText 返回 boolean + 锚点复制按结果反馈 |
| 修改 | frontend/src/components/knowledge/graph-canvas.tsx | onPointerDown 置位 userTouched + shouldAutoRefit 提取 |
| 修改 | frontend/src/lib/knowledge.ts | overview/query 显式 timeoutMs 200s/90s |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | 失败态 + 重试用例 |
| 修改 | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx | 剪贴板失败/成功反馈用例 ×2 |
| 修改 | frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | shouldAutoRefit 用例 ×2 |
| 新增 | frontend/src/lib/__tests__/knowledge-graph-timeout.test.ts | 超时对齐用例 ×2 |
