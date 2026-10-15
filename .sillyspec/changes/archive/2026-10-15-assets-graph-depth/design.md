---
author: flow-machine-draft
created_at: 2026-10-15T09:22:53.271Z
---
# 设计记录（Design Record）— 2026-10-15-assets-graph-depth

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

只改 ChangeAssetsGraph 一个组件：新增 depth state（1|2|3，默认 1），卡头右侧渲染三档 chips（aria-pressed 激活态，样式沿用图例胶囊/预置胶囊的既有 chip 范式），query key 与查询参数都带 depth——getKnowledgeGraphQuery 的 depth 参数是既有直通面（lib/knowledge.ts KnowledgeGraphQueryParams.depth），零后端改动。placeholderData: keepPreviousData（@tanstack/react-query v5.51，仓内 changes 列表页 page.tsx:340 同款先例）让深度切换期间保持上一份切片渲染，不闪加载占位。标题「本变更一跳邻域」改「本变更邻域」——深度可变后「一跳」失真。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- ChangeAssetsGraph：无 props 变化；新增内部 depth state 与卡头层级 chips（data-testid="assets-graph-depth-{1|2|3}"）；useQuery queryKey 追加 depth 维度（缓存按深度隔离，回切不重查）。组件对外（资产卡挂载点）契约不变。
- 后端端点/DTO 零改动（depth 为既有查询参数）。
- 测试面：change-assets-graph.test.tsx 既有调用断言随 depth: 1 同步改写，新增层级切换两用例。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

react-query 按 query key 天然处理乱序：不同 depth 是不同缓存槽，慢的旧深度响应不会覆盖新深度数据（key 隔离）；keepPreviousData 只展示「上一份成功数据」，请求竞态由库内 key 匹配兜住。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

纯展示无写路径；depth state 单组件内 setState，无并发面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

深度切换失败（isError）→ 整区隐藏（fail-open 与首载同口径）；selectedId 在新切片查不到时既有兜底链（selectedId→锚点→首节点）自然回退，无悬空引用；组件卸载（切走变更）随 react-query 生命周期自清理。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

query key 含 workspaceId+changeKey+depth 三键隔离，无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险一：深度 2-3 切片节点数可能超 FORCE_NODE_LIMIT=200——GraphCanvas 既有 >200 静态分环降级自动兜住（2026-10-15-graph-type-cluster 语义），组件无需新增护栏；可达性上 depth 3 大仓可能秒级耗时，keepPreviousData 已保证切换期间有内容可看。
- 风险二：keepPreviousData 期间 counts 文案显示旧切片计数——数据到达即原位刷新，短暂陈旧可接受（与 changes 列表页同语义）。
- 试过放弃：①Select 下拉选深度——卡头横向空间紧张，三档 chips 一眼可达（图谱页用 Select 是因为表单还有 sub/edges 多控件，此处只有 depth 一维）；②把 depth 做成资产卡 props 传下来——深度是图谱分区内部交互态，与资产卡取数无关，上提徒增传参链。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/changes/detail/change-assets-graph.tsx | depth state + 卡头层级 chips + queryKey/参数带 depth + keepPreviousData + 标题文案 |
| 修改 | frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx | 既有调用断言补 depth:1 + 新增层级切换/不闪空两用例 |
