---
author: flow-machine-draft
created_at: 2026-10-27T04:54:27.044Z
---
# 设计记录（Design Record）— 2026-10-27-sessions-total-and-status-filter

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

三个问题同源：会话列表的「统计/筛选/默认展示」此前全部依赖客户端一次拉回的 ≤500 条样本（`AGENT_SESSIONS_TREE_FETCH_LIMIT=500`，后端 `limit le=500`），于是总数被封顶、筛选只有客户端视角、默认一屏铺满。本变更把**统计与状态过滤的权威口径下沉到服务端**，展示层瘦身：

1. **后端**：`GET /api/daemon/sessions` 响应新增 `status_counts`（五态分组计数，口径 = 除 status/status_group 外与其余过滤参相同的查询、忽略状态维度）；新增可选过滤参 `status_group=ongoing`（在线三态 `pending+active+reconnecting` 聚合，与 `status` 互斥，同传 422）。实现上把 `read_model.list_agent_sessions` 的 `base_filters` 组装提取为模块级 `_build_session_filters()`，列表查询与新增的分组计数查询共用同一过滤组装（单一源，杜绝两处口径漂移）；`list_agent_sessions` 自身签名与返回值**不变**（新增独立函数 `list_agent_session_status_counts()`，facade 增同名透传），既有调用方与测试零回归。
2. **手机端 MobileSessionList**：头部新增统计行「会话总数 N 条」（N=status_counts 五态之和）；状态 chips 改四档 全部/在线/已结束/失败（在线=ongoing 三态之和），计数全部消费 status_counts（切档不重拉计数、不漂移）；「进行中」客户端过滤档退役，改为服务端档（在线→status_group=ongoing、已结束→status=ended、失败→status=failed，queryKey 加档位槽）；「已归档」视图保留为第五入口（服务端 archived=true 切换，不带计数）。默认渲染 = 「最新 10 条 ∪ 全部在线」，尾部「显示全部 N 条」展开（对齐 PC 端组内截断+显示全部先例）。
3. **PC 端 SessionListPanel**：状态下拉「活跃」档更名「在线」、查询口径从单值 active 扩为 status_group=ongoing（其余档不动）；工作区组内默认展示收敛为「10 条 + 在线全显 + 显示全部」（沿用既有 50 截断+显示全部机制改参数）。PC 头部总数已消费服务端 total（现状正确），不在本变更动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `GET /api/daemon/sessions`：
  - 响应 `AgentSessionListResponse` 新增 `status_counts: dict[str, int]`（键为五态枚举 pending/active/reconnecting/ended/failed，值 ≥0；无命中态键缺省可不出——前端按 0 兜底）。既有字段 items/total/limit/offset 不变；`total` 语义不变（含状态过滤后的总数，供分页）。
  - 新增可选 Query 参 `status_group: Literal["ongoing"]`（默认 None=现状）；`status` 与 `status_group` 同传 → 422（中文文案，对齐 ppm_item 成对校验先例）。
- 前端 `AgentSessionListParams` 新增 `status_group?: "ongoing"`；`AGENT_SESSIONS_TREE_FETCH_LIMIT=500` 常量**不动**（列表拉取上限不在本变更放开——真实总数经 status_counts 传达，「在线全显」受 500 内在线数覆盖，极端 >500 全在线场景可接受）。
- `frontend/src/lib/api-types.ts` 与 `sillyhub-daemon/src/api-types.ts` 同变更内 `pnpm gen:types` 再生成并提交（CLAUDE.md 规则 21 / 断言面闸门⑨）。
- 组件内部导出面不变（MobileSessionList props / SessionListPanel props 均不动）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。列表 items 与 status_counts 在同一请求同一事务会话内先后两条查询产出，会话状态在两查询间迁移（如恰好 ended）时计数与列表可能有瞬时 1 条级偏差——与既有 total 同等粒度，前端不做强一致假设；SSE 变更信号驱动的 invalidate 前缀 ["agentSessions"] 重拉后自愈（沿用现有刷新通道）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   status_counts 为纯读 GROUP BY，无写面；与列表查询共用 base_filters 组装纯函数，无共享可变状态。多 agent 并行改代码场景下本变更只动列表读路径，与进行中的 bg-task/turn-phase 等写路径变更无文件重叠。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。chips 切档走 react-query key 切换自动重拉（对齐现有 archived 档切换模式），无手动 refetch 竞态；「显示全部」为纯客户端展开态，切档即随组件过滤重算（展开态 keyed by 档位，不留陈旧展开态跨档残留）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。status_counts 与列表同一 owner-scoped + workspace/change/ql/ppm 过滤口径（同一 `_build_session_filters` 产出），不跨工作区串台；PC 与手机端共用端点与类型，两端口径单一源。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：PC 端 SessionListPanel 体量大（~2500 行）且测试面广，「活跃→在线」改名与组内 10 条收敛可能波及既有断言文案——改动严格限定 STATUS_OPTIONS 命名 + 截断常量与在线豁免逻辑，跑该组件既有测试全量核对（该文件属本变更触及面，非全量测试）。
- 试过放弃的方案：① 后端 limit 放宽到 le=2000 让前端拉全量——放大量级敏感查询（q 搜索/links 子查询）且治标不治本（5000 条时再截），放弃；② 新增独立统计端点 GET /sessions/status-counts——多一次往返与一个 openapi 面，而 status_counts 与列表同过滤口径天然同源，并入列表响应更稳，放弃；③ 手机端 chips 计数用客户端样本估算——515>500 时计数错（正是本次要修的病根），放弃。
- 遗留已知边界：全工作区在线会话数 >500 时「在线全显」仍受单次拉取上限约束（status_group 过滤后的命中集本身 ≤limit）——不另做聚合翻页，计数仍真实（status_counts 不受 limit 影响）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/daemon/schema.py | AgentSessionListResponse 加 status_counts |
| 修改 | backend/app/modules/daemon/router/session_crud.py | status_group 参 + 互斥 422 + 装配 status_counts |
| 修改 | backend/app/modules/daemon/session/service/read_model.py | base_filters 提取 _build_session_filters + 新增 status_counts 分组计数函数 + status_group 过滤支持 |
| 修改 | backend/app/modules/daemon/session/service/__init__.py | facade 透传新函数与 status_group |
| 修改 | backend/app/modules/daemon/service.py | 同上（第二层 facade） |
| 修改 | backend/app/modules/daemon/tests/test_session_history.py | status_counts / status_group / 互斥 422 用例 |
| 修改 | backend/openapi.json | schema 变更再生成提交 |
| 生成 | frontend/src/lib/api-types.ts | pnpm gen:types |
| 修改 | frontend/src/lib/daemon/session-lists.ts | AgentSessionListParams 加 status_group + query 下发 |
| 修改 | frontend/src/components/mobile/mobile-session-list.tsx | 统计行 + 四 chips + 默认10+在线全显 + 显示全部 |
| 修改 | frontend/src/components/mobile/mobile-session-list.test.tsx | 上述行为用例 + 既有断言对齐 |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | 「活跃」→「在线」（ongoing 口径）+ 组内 10+在线全显 |
| 修改 | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | 受影响断言对齐 |
| 生成 | sillyhub-daemon/src/api-types.ts | pnpm -C sillyhub-daemon gen:types |
