---
author: flow-machine-draft
created_at: 2026-10-10T00:27:58.726Z
---
# 设计记录（Design Record）— 2026-10-10-dump-gzip-thread-offload

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

24h 审查发现 `GET /knowledge/graph/dump` 在 async 端点内同步执行 `json.dumps` + `gzip.compress`（默认 level 9）——大图（2026-10-09-knowledge-graph-fullmap 真图实测 5855 节点/MB 级 payload）该 CPU 段达百 ms~秒级，期间事件循环上全部并发请求（含 SSE 心跳/日志流推送）被阻塞。方案：把序列化+压缩收进单个同步闭包 `_serialize_compress`，经 `asyncio.to_thread` 卸载到工作线程执行。选 to_thread 而非降 compresslevel：降档只缩短阻塞时长不消除阻塞，卸载根治且响应字节零变化（同函数同参数）；选单闭包而非两段分别卸载：json.dumps 的 str 中间产物（MB 级）不必跨线程往返，一次切换开销最小。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `backend/app/modules/knowledge/router.py`：`get_knowledge_graph_dump` 端点内部实现——新增局部闭包 `_serialize_compress` 与 `asyncio.to_thread` 调用；模块 import 增加 `asyncio`。对外路由/参数/鉴权/响应头/响应字节零变化（纯执行线程变化）；不新增生成物面（openapi 描述未动，无需 gen:types）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立：envelope 在卸载前已完整物化（await service.dump 先返回），闭包只读该快照，与后续请求的到达顺序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   无共享可变态：每次请求各自构造独立闭包与独立 envelope，gzip.compress 纯函数；多请求并发时各自在工作线程执行互不干扰（to_thread 线程池调度）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全：卸载段无 IO 无锁，客户端中途断开仅浪费一次压缩计算（与卸载前行为一致），无半态资源。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会：闭包捕获的是本请求 envelope，workspace 隔离在 service.dump 的鉴权与查询层（未动）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：to_thread 默认线程池在高并发 dump 风暴下排队——但 dump 为低频全图总览请求且单次百 ms 级，默认池容量充足；极端排队仅表现为该请求变慢，不阻塞事件循环（恰是本变更要保住的底线）。试过但放弃：①降 compresslevel 到 6（放弃理由：只缩短不消除阻塞，且改变输出字节引入对比噪声）；②ResponseStreaming 分块压缩（放弃理由：信封需整体 JSON 化后压缩才能保证 gzip 原子性与既有测试的字节级断言，流式改造收益不抵复杂度）。

## 文件变更清单（自声明）

交付文件（2 个）：

1. `backend/app/modules/knowledge/router.py`——dump 端点 to_thread 卸载（FR-01/FR-02）
2. `backend/app/modules/knowledge/tests/test_graph.py`——新增卸载钉用例（FR-03）
