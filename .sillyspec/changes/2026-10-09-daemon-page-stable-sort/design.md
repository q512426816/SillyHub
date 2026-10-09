---
author: flow-machine-draft
created_at: 2026-10-09T15:01:05.476Z
---
# 设计记录（Design Record）— 2026-10-09-daemon-page-stable-sort

## 做法概述

问题根因在后端排序键选择：`/api/daemon/machines`（守护进程页面唯一数据源，前端 15s 轮询）主查询 `ORDER BY case(online→0) , last_heartbeat_at DESC`——`last_heartbeat_at` 每次心跳（约 15s 一跳）都被 UPDATE，机器间相对先后随时翻转，页面刷新即乱序；嵌套 runtimes 二次查询仅 `ORDER BY provider`，同 provider 多 agent 并列时 DB 返回顺序不定，agent 卡随之乱跳。

修法：把机器列表排序键换成不变的稳定键——保留 design §5.1 的 online 优先分组，组内改按展示名 `coalesce(display_alias, hostname)` 升序（与机器卡头展示名同口径，用户可预期），`id` 升序兜底保证全序确定；嵌套 runtimes 与「共享给我的」明细查询在 provider 之后追加 `created_at, id` tiebreaker。前端零改动（顺序随响应走），无 API 形状变化。

## 接口契约

- `backend/app/modules/daemon/runtime/service.py::RuntimeService.list_machines`：内部行为变化——主查询 ORDER BY 由 `online 优先, last_heartbeat_at DESC` 改为 `online 优先, coalesce(display_alias, hostname) ASC, id ASC`；嵌套 runtimes 查询 ORDER BY 由 `provider` 改为 `provider ASC NULLS LAST, created_at ASC, id ASC`。返回结构（rows/runtimes_by_instance/total/shared）与函数签名零变化。
- `backend/app/modules/daemon/grants/queries.py::list_machines_shared_to_me`：内部行为变化——runtimes 明细二次查询在 `daemon_instance_id, provider` 后追加 `created_at, id`。返回类型零变化。
- 对外 HTTP 契约：GET /api/daemon/machines 响应字段、状态码、分页语义零变化，仅 items/runtimes 的行序稳定化（排序本就是实现细节，OpenAPI 不含排序承诺，`api-types.ts` 无需再生成）。
- 借用派发链路（`resolve_granted_daemon_for_borrow` 的 `last_heartbeat_at DESC LIMIT 1`、session 侧 `_query_online`）是功能性选优不是展示排序，本变更不动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：排序键改为 coalesce(别名/主机名)+id、created_at+id 后均为不可变或单调字段，心跳乱序/迟到到达不再影响行序；别名被用户修改（PATCH /machines/{id}）会改变该机器的排序位置，属用户可见的合理语义变化。
2. 并发写：纯读路径排序调整，无新写入；心跳 UPDATE 与列表 SELECT 并发时行为同旧（读到提交后的快照），不再出现因心跳更新导致的行序抖动。
3. 切换/生命周期：无状态引入（无缓存/内存序），请求中途中断无残留；前端 react-query 缓存仍按响应整体替换，无增量合并问题。
4. 作用域：排序作用于单次查询结果集，受既有人员/工作区过滤约束，不跨用户/跨工作区串台；「共享给我的」块行序仍由 grants 查询独立决定，与 items 块互不影响。

## 风险与死路

最大风险是排序语义变化对依赖旧行为的调用方的破坏——已排查：前端 runtimes 页及各消费方（工作区概览/悬浮抽屉/移动端）均不依赖机器行序（渲染直接 map），仅 `test_machines_sort_online_first_then_heartbeat_desc` 断言旧序，随本变更同步改写。SQLite（测试）与 PostgreSQL（生产）对 `coalesce` 与多列 ORDER BY 语义一致；provider NULL 的 ASC 排序两方言默认相反（SQLite NULL 在前、PG 在后），故显式 `nulls_last()` 对齐（先例 grants/queries.py:414）。试过放弃的方案：继续按 last_heartbeat_at 排序但前端做二次稳定排序——放弃，双端各排一半、缓存替换时仍会闪跳，且「最近心跳优先」对单用户多机场景无信息量；改按 created_at 排机器——放弃，老机器永远沉底，用户新装机排最前反而难找，展示名升序是唯一可预期口径。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/daemon/runtime/service.py | list_machines 主查询排序键换展示名+id；嵌套 runtimes 加 created_at/id tiebreaker；docstring 同步 |
| 修改 | backend/app/modules/daemon/grants/queries.py | list_machines_shared_to_me 的 runtimes 明细查询加 created_at/id tiebreaker |
| 修改 | backend/app/modules/daemon/tests/test_machines_router.py | 旧排序用例改写为展示名升序语义；新增机器内/共享区块同 provider 稳定序两个用例；_create_runtime 加 created_at 参数；文件头注释同步 |
