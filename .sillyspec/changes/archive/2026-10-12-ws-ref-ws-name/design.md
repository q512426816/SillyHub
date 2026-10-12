---
author: flow-machine-draft
created_at: 2026-10-12T03:45:00.000Z
---
# 设计记录（Design Record）— 2026-10-12-ws-ref-ws-name

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户反馈悬停浮层显示「工作区 a8a0fde6-…」uuid 不可读。方案：portal 组装槽位时按 workspaceId 查工作区名称（display_alias 别名优先，与 SessionListPanel 分组同名口径）塞进 desc 新增的纯显示字段 workspaceName；两输入区 tooltip 六处拼接改为名称优先、缺省回退 id。名称查询与工作区列表同 queryKey 同 queryFn（react-query 缓存共享，零额外请求）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

WsRefDesc 加可选字段 workspaceName?: string（纯显示：置换/解析/标记协议零消费）；sessions-portal 增 wsNameQuery + handleAddWsRef 塞名；两输入区 overlayTokenMetas 拼接六处。后端 0 端点。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

名称查询异步，未就绪时 handleAddWsRef 拿不到名 → workspaceName=undefined → tooltip 回退 id（降级可读），不阻塞插入。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

react-query 缓存单源；desc 一次性快照，无并发写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

名称随 desc 落入 wsRefTokens 持有（快照语义）——工作区改名后旧标签 tooltip 仍显示插入时名称，可接受（与路径快照同语义）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

wsIdToName 按 id 精确映射，不串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险：无（纯显示增强，降级路径完备）。放弃的方案：两输入区各自拉工作区列表（重复请求+群聊面板无现成数据源）；历史标记协议加名称字段（协议污染，历史气泡本就显示路径不需要）。
