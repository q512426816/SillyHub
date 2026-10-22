---
author: flow-machine-draft
created_at: 2026-10-22T02:35:37.287Z
---
# 设计记录（Design Record）— 2026-10-22-agent-profile-edit-refresh

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

在 `lib/agent-profiles.ts` 的 `useCreateAgentProfile` / `useUpdateAgentProfile` onSuccess 里**补一个** `agentProfileQueryKeys.mineList` 失效（保留既有 workspaceList(wid) 失效）。根因是桶错配：全局卡片墙页（/agent-profiles）数据在 mineList 桶，而这两个 mutation 只失效 workspaceList(wid) 桶；复制/删除当年已在页面层用裸 fetch+手动失效绕过（page.tsx 头注释明载），新建/编辑走表单内的这两个 hook 漏掉。修在 hook 层而非页面层：一处修复同时覆盖全局页与工作区内页两个消费面，且与「mutation 失效缓存复用同一 key 工厂」的仓约定一致。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `useCreateAgentProfile(workspaceId)` / `useUpdateAgentProfile(workspaceId)` 签名不变；行为变化：onSuccess 由失效 1 桶变 2 桶（+mineList）。useDelete/useCopy 不动。无端点/命令/文件格式变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。invalidate 是声明式失效（标记 stale + 活跃查询重拉），多次/乱序失效幂等，迟到到达最多多一次重拉。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   纯前端缓存层操作，单标签页内 react-query 串行处理；多标签页各自持缓存，各自 mutation 各自失效，最终一致（react-query 默认 refetchOnWindowFocus 兜底）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。onSuccess 只在 mutation 成功后执行；失败/中止不失效，缓存保持旧值不闪错数据。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不串。mineList 是「当前 actor 可见全集」单桶（key 不带 wid），失效它语义正确——任何 ws 的档案增改都影响该全集；workspaceList 仍按 wid 分桶精确失效。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险极低（追加一次幂等失效调用）。已放弃方案：①在全局页给表单传 onSuccess 回调手动失效（页面层补丁，只修全局页一个消费面，工作区内页若他日复用同形态还会漏，且表单 props 要加口子；放弃）；②把四个 CRUD hook 全部补 mineList（delete/copy 的消费页列表桶本就正确，全局页复制/删除已有页面层手动失效覆盖，扩大面无实证收益；本变更不动）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/lib/agent-profiles.ts | useCreate/useUpdate onSuccess 补 mineList 失效（保留 workspaceList(wid)） |
| 新增 | frontend/src/lib/__tests__/agent-profiles.test.tsx | hook 失效行为单测（成功两桶/失败零失效） |
