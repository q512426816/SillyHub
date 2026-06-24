---
author: qinyi
created_at: 2026-06-24 10:35:00
change: 2026-06-24-runtime-usage-stats
---

# Requirements

## 角色

| 角色 | 说明 |
|---|---|
| 观察者(用户) | 在运行时列表页查看各 runtime 的 token / 缓存 / 费用用量与趋势 |
| daemon | 采集各 runtime 的 cache 词元并上报后端 |
| backend | 提供 runtime 用量聚合查询接口 |

## 功能需求

### FR-01: 卡片展示 token / 缓存 / 费用数字
覆盖决策:D-001@v1, D-004@v1
Given 某 runtime 在选定时间窗内有用量数据
When 用户打开运行时列表页
Then 该 runtime 卡片显示「输入 / 输出 / 缓存 / 费用」4 个数字(token 用 k/M 格式化,费用 $USD)
Given 该 runtime 无 cache 数据(如 codex)
When 渲染缓存数字
Then 显示「—」;无费用数据显示 $0.00

### FR-02: cache 采集(daemon)
覆盖决策:D-001@v1
Given Claude runtime 运行一个 turn
When stream-json 的 message_delta 携带 `event.usage.cache_creation_input_tokens` / `cache_read_input_tokens`
Then daemon 累加并经 `usage_update` 透传到后端,写入 `AgentRun.cache_read_tokens` / `cache_creation_tokens`(取 max)
Given codex runtime(codex driver)
When usage 无 cache 字段
Then 不写 cache 列(尽力而为,见 D-001@v1)
Given opencode(ndjson adapter,已有 cache)
When TaskResult.usage 返回
Then 透传 `cache_read_tokens` / `cache_write_tokens` 到后端

### FR-03: 批量聚合接口
覆盖决策:D-002@v1, D-003@v2, D-004@v1
Given 多个 runtime 存在归属它们的 agent_runs
When `GET /api/daemon/runtimes/usage?window=7d`
Then 返回每个 runtime 的 `{summary: input/output/cache_read/cache_creation/cost, daily: [...]}`,一次请求覆盖全部 runtime
Given interactive run 同时挂 agent_session_id + lease_id
When 聚合
Then 该 run 只被算一次(`LEFT JOIN` + `COALESCE`,见 D-003@v2)
Given window=1d
When 返回 daily
Then 按小时分 24 个点(date_trunc('hour'));`since` = 本地自然日 today 00:00(D-004@v1)
Given window=7d 或 30d
When 返回 daily
Then 按日分组(date_trunc('day'))
Given 某 run 既无 session 也无 lease 归属
When 聚合
Then `COALESCE(s.runtime_id, l.runtime_id) IS NULL`,不计入任何 runtime

### FR-04: 时间窗折线图(sparkline)
覆盖决策:D-002@v1
Given 卡片拿到某 runtime 的 daily 序列
When 渲染 sparkline
Then 画输入(蓝)/ 输出(绿)双线;切换时间窗时折线随之更新
Given 某时间窗该 runtime 无数据
When 渲染
Then 折线为空占位,数字显示「—」/0

### FR-05: 兼容与回退
Given 老 daemon 不上报 cache / 历史数据 cache 列为 NULL
When 聚合查询
Then `SUM(COALESCE(...,0))` 忽略 NULL 不报错;现有 `/runtimes`、`/sessions` 端点行为不变

## 非功能需求

- **兼容性**:新列 nullable,老 daemon / 老数据不报错;新接口独立,不影响现有端点。
- **可回退**:不传 cache 时回退为 NULL,聚合自动忽略;前端 fallback「—」。
- **可测试**:daemon / backend / frontend 三子项目各有单测,backend coverage≥60%(local.yaml)。
- **跨平台**:Node / Next / PostgreSQL 均跨平台,无 windows/macos 特殊处理(CLAUDE.md 规则 12)。
- **性能**:30 天聚合用 `created_at` 时间过滤收窄(R-04)。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-05 | cache 尽力而为(codex 无则 NULL,前端显示「—」) |
| D-002@v1 | FR-03, FR-04 | 时间窗分组粒度(当日 hour / 7d·30d day) |
| D-003@v2 | FR-03 | 聚合 LEFT JOIN + COALESCE 去重(替代 v1 UNION) |
| D-004@v1 | FR-01, FR-03 | 当日本地自然日 + 非实时刷新 |

剩余风险:R-01(Claude CLI cache 字段透传未实测)、R-02(batch cost 填充率)——见 design.md §10。
