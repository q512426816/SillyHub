---
author: qinyi
created_at: 2026-08-30 16:52:20
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员 | 查看变更中心列表/详情的用户（权限 CHANGE_READ），关注每个变更/快速修复的实际耗时与 token 消耗 |

## 功能需求

### FR-01: 变更/快速修复的时间三元组展示
覆盖决策：D-001@v1
Given 一个变更（或快速修复）存在关联执行记录（执行集合非空）
When 用户查看其列表「执行」列或详情用量卡
Then 开始时间 = 集合 `MIN(started_at)`、结束时间 = 集合 `MAX(finished_at)`、耗时 = 集合 `SUM(duration_ms)`（纯执行时长累加，不含等待）

Given 变更/快速修复无任何关联执行记录
When 用户查看列表或详情
Then 时间三元组均为 None/「—」，不回退 created_at（否决生命周期口径）

Given 集合中存在已开始未结束的执行（started_at 有值、finished_at 为 NULL）
When 用户查看列表「执行」列
Then 耗时行显示已有累计值并带「进行中」标记（started 有值且 finished 缺）

### FR-02: 变更/快速修复的 token 用量聚合
覆盖决策：D-002@v1, D-006@v1
Given 变更侧存在两类执行：挂 `change_id` 的派发执行、关联会话（`change_session_links`）内的执行
When 聚合该变更用量
Then 两类执行按 run id 去重合并（并集），token 四维（输入/输出/缓存读/缓存写）+ 调用次数 + 轮次（`SUM(num_turns)`）在去重集合上求和

Given 一个会话同时绑定两个变更
When 分别查看两个变更的用量
Then 该会话的消耗在两个变更各完整显示一次（口径特性非 bug，详情卡注脚声明）

Given 快速修复条目有绑定会话（`quicklog_session_links`）
When 聚合该快速修复用量
Then 统计其关联会话内全部执行（无派发锚点，恒走会话链路；`DISTINCT` 防御重复 link 行）

Given 关联会话中含软删会话（`deleted_at` 非空）
When 聚合用量
Then 其执行仍计入（消耗真实发生；注脚声明）

Given 执行集合中存在无 `agent_run_model_usage` 明细行的老 run
When 聚合用量
Then 其 `agent_runs` 四维 token 列并入「未记录」兜底桶（逐列 `SUM(COALESCE(col,0))`，`ctx_tokens` 快照列排除），该桶 api_requests 按 0 诚实值

Given 执行集合为空
When 聚合用量
Then totals 全 0、by_model 为空列表、时间三元组 None（usage 摘要字段为 None）

### FR-03: 独立用量端点
覆盖决策：D-005@v1
Given 用户有 CHANGE_READ 权限
When `GET /api/workspaces/{wid}/changes/{cid}/usage` 或 `GET /api/workspaces/{wid}/quicklog-entries/{ql_id}/usage`
Then 返回 `ChangeUsageRead`（时间三元组 + totals 六指标 + by_model 分模型明细，input+output 降序、「未记录」恒末位）

Given 变更/快速修复不存在、不属于该工作区、或变更 location=deleted
When 请求上述端点
Then 404（resource-hiding，对齐既有详情端点；quicklog usage 端点同样严格 404）

### FR-04: 列表内嵌用量摘要（零 N+1）
覆盖决策：D-003@v1, D-004@v1, D-005@v1
Given 用户请求变更列表（或快速修复列表）
When 响应组装
Then 每项内嵌 `usage: UsageSummaryRead | None`（时间三元组 + totals），由批量聚合单查询填充（变更侧 `(change_id, run_id)` UNION 去重后 GROUP BY；快速修复侧 DISTINCT 后 GROUP BY）；不产生逐行查询

Given 变更行 location=deleted
When 列表组装
Then 其 usage 恒 None（对齐既有 deleted 防复活口径）

### FR-05: 前端展示
覆盖决策：D-004@v1, D-007@v1
Given 变更中心「进行中/已归档」tab 列表
When 每行渲染
Then 「执行」列紧凑两行：耗时（+进行中标记）+ `N tok · N 次`，悬浮提示显示起止时间；usage None 显示「—」

Given 快速修复 tab 列表
When 每行渲染
Then 同款「执行」列（含轮次摘要 `N 轮`）

Given 变更详情页（ChangeStageHeader 下方）或快速修复抽屉（sessions 卡旁）
When 页面渲染
Then 用量卡展示：开始/结束/耗时/轮次/输入/输出/缓存读/缓存写/请求次数/缓存命中率（`cache_read/(cache_read+input)`，分母 0 显示「—」）+ 分模型折叠明细 + 口径注脚（并集去重、共享会话重复计数、软删会话计入）

Given 用量端点取数失败或 404（含抽屉开着条目被删竞态）
When 用量卡渲染
Then 显示边界态文案，不弹错误

## 非功能需求

- 兼容性：新字段全部 optional default None，旧客户端不读不受影响；零迁移、无回填、不改既有 API 既有字段。
- 可回退：纯只读聚合 + 展示，回退 = 移除新增组件/列/端点，无数据回滚需求。
- 可测试：聚合语义全部可由 DB 造数验证（tests/test_usage_stats.py 覆盖 FR-01/02/03/04 的 GWT 分支）；前端组件测试覆盖数字渲染/边界态/折叠/双 kind。
- 性能：列表批量聚合 SQL 侧完成（既有 `agent_runs.change_id`/`agent_session_id` 索引），列表不算 by_model。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 时间口径 = 执行时间口径 |
| D-002@v1 | FR-02 | 统计范围 = 派发 ∪ 会话并集去重；quicklog 恒走会话链路 |
| D-003@v1 | FR-04 | 实时聚合计算字段零迁移 |
| D-004@v1 | FR-04, FR-05 | 列表 + 详情都要 |
| D-005@v1 | FR-03, FR-04 | API 形态 = 独立端点 + 列表内嵌摘要 |
| D-006@v1 | FR-02 | 软删会话执行计入统计 |
| D-007@v1 | FR-05 | 用量卡取数用 react-query useQuery |
