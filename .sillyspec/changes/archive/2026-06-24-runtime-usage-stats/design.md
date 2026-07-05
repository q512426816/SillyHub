---
author: qinyi
created_at: 2026-06-24 10:05:00
change: 2026-06-24-runtime-usage-stats
---

# 运行时用量统计(design.md)

## 1. 背景

运行时列表(`frontend/src/app/(dashboard)/runtimes/page.tsx`)的 `RuntimeCard` 当前只显示会话数,看不到该 runtime 的实际 LLM 消耗。用户希望卡片上一眼看到 **输入/输出/缓存词元 + 总费用**,并按时间(当日/7天/30天)以折线图看趋势。

数据底子已具备:`agent_runs` 表已有 `input_tokens`(2026-06-25 加)、`output_tokens`、`total_cost_usd`(2026-06-24 加),interactive 与 batch 两条执行路径都写入。但存在三处缺口:

1. **cache 未采集**:`agent_runs` 无 cache 列;daemon 侧仅 `ndjson.ts`(opencode/openclaw/pi)采了 cache,Claude(`stream-json.ts`)与 codex(`codex-app-server-driver.ts`)都只取 input/output,DB 也无 cache 列。
2. **无按 runtime + 时间窗聚合的接口**:`RuntimeService` 无任何 stats 方法,前端 `RuntimeCard` 无 token/cost 字段。
3. **前端无折线图组件**:echarts 已引入,但现有只有 bar/pie。

## 2. 设计目标

- `RuntimeCard` 显示 **输入词元 / 输出词元 / 缓存词元 / 总费用** 四个数字。
- 卡片内嵌 sparkline 折线(输入/输出双线);页面顶部统一时间窗切换器(当日/7天/30天)驱动**所有卡片**的数字与折线同步变化。
- cache 连带做:补 daemon 采集层(Claude / codex)+ DB 列 + service 解析,打通 daemon→后端→前端全链路。

## 3. 非目标

- 不做全局实时刷新(SSE 推卡片聚合)——进页面 + 切窗拉取即可(YAGNI)。
- 不做费用币种换算(按数据原值 USD 显示)。
- 不做多 runtime 合并的全局总览图(用户已选「卡片内迷你图」方案)。
- 不改 lease / session / agent_run 的生命周期状态机(本次为只读统计)。

## 4. 拆分判断

单一功能数据流闭环(daemon 采集 → 后端聚合 → 前端展示),三层强耦合、不可独立交付,不拆分、不批量。详见 step 5 评估。

## 5. 总体方案(分 Wave)

**Wave 1 · daemon cache 采集层**
- `stream-json.ts`(Claude):`_accumulatedUsage`/`_currentTurnUsage` 加 `cache_read_tokens`/`cache_creation_tokens`;`parseStreamEvent` 的 `message_delta` 分支从 `event.usage` 提取 `cache_creation_input_tokens`/`cache_read_input_tokens`;`emit usage_update` + snapshot + `extractResultStats` 透传 cache。
- `codex-app-server-driver.ts`:`out.usage` 尽力而为加 cache 字段(codex/OpenAI 系多无,取不到则 `undefined`)。
- `ndjson.ts`:已有 `cache_read_tokens`/`cache_write_tokens`,确认透传到 `TaskResult.usage`。

**Wave 2 · 后端数据层**
- migration:`agent_runs` 加 `cache_read_tokens`/`cache_creation_tokens`(nullable int)。
- `agent/service.py`:`_METADATA_FIELDS` 加两字段。
- `daemon/run_sync/service.py`:`_eventToMessages`/`submit_messages`/`close_interactive_run` 解析 `usage.cache_*`(沿用 input/output 的 max 逻辑)。

**Wave 3 · 后端聚合接口(方案 A 批量)**
- `RuntimeService.get_runtimes_usage(window)`:**单条 SQL LEFT JOIN**(非 UNION 双路径)——`agent_runs r LEFT JOIN agent_sessions s ON r.agent_session_id=s.id LEFT JOIN daemon_task_leases l ON r.lease_id=l.id`,`GROUP BY COALESCE(s.runtime_id, l.runtime_id)` SUM,每 run 唯一一行天然去重(避免 interactive run 同时挂 session+lease 被算两次,见 D-003@v2 / R-03);`date_trunc` 分组(当日按 hour、7d/30d 按 day,见 D-002)。
- schema:`RuntimeUsageWindow` / `RuntimeUsageSummaryRead` / `RuntimeUsagePointRead` / `RuntimeUsageRead`。
- router:`GET /api/daemon/runtimes/usage?window=1d|7d|30d` 一次返回全部 runtime。

**Wave 4 · 前端展示**
- `lib/daemon.ts`:`getRuntimesUsage(window)` + 类型。
- `components/charts/RuntimeUsageLineChart.tsx`:echarts `type:'line'` sparkline;`index.tsx` 用 `next/dynamic(ssr:false)` 导出。
- `lib/ppm/aggregations.ts`:加 `toLineSeries`,复用 `CHART_COLORS`。
- `runtimes/page.tsx`:顶部时间窗切换器(3 tab);批量响应按 `runtime_id` 分发;`RuntimeCard` 加用量区(4 数字 + sparkline);token k/M 格式化、费用 `$USD`、缓存合并读/写(有数据时)。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/adapters/stream-json.ts` | `_accumulatedUsage`/`_currentTurnUsage` 加 cache 字段;`message_delta` 提取 cache;emit/snapshot/`extractResultStats` 透传 |
| 修改 | `sillyhub-daemon/src/interactive/codex-app-server-driver.ts` | `out.usage` 尽力而为加 `cache_read_tokens`/`cache_creation_tokens` |
| 修改 | `sillyhub-daemon/src/adapters/ndjson.ts` | 确认 cache 透传到 `TaskResult.usage`(可能无需改) |
| 修改 | `sillyhub-daemon/src/hub-client.ts` | submitMessages/completeLease payload 类型+构造 body 加 cache 透传(task-16) |
| 修改 | `sillyhub-daemon/src/daemon.ts` | usage 类型+SDK result 提取+实时回写加 cache(全名→短名映射)(task-16) |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | 实时回写加 cache(task-16) |
| 新增 | `backend/migrations/versions/<新>_add_agent_cache_token_fields.py` | 加 cache 两列(序号/down_revision execute 时取 alembic head) |
| 修改 | `backend/app/modules/agent/model.py` | `AgentRun` 加 `cache_read_tokens`/`cache_creation_tokens` |
| 修改 | `backend/app/modules/agent/service.py` | `_METADATA_FIELDS` 加 cache 两字段 |
| 修改 | `backend/app/modules/daemon/run_sync/service.py` | `_eventToMessages`/`submit_messages`/`close_interactive_run` 解析 cache |
| 修改 | `backend/app/modules/daemon/runtime/service.py` | `RuntimeService.get_runtimes_usage(window)` |
| 修改 | `backend/app/modules/daemon/router.py` | `GET /runtimes/usage` 端点 |
| 修改 | `backend/app/modules/daemon/schema.py` | `RuntimeUsage*` schema |
| 修改 | `frontend/src/lib/daemon.ts` | `getRuntimesUsage` + 类型 |
| 新增 | `frontend/src/components/charts/RuntimeUsageLineChart.tsx` | echarts line sparkline |
| 修改 | `frontend/src/components/charts/index.tsx` | `next/dynamic(ssr:false)` 导出 |
| 修改 | `frontend/src/lib/ppm/aggregations.ts` | `toLineSeries`(复用 `CHART_COLORS`) |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 顶部时间窗切换器 + `RuntimeCard` 用量区 |

## 7. 接口定义

```python
# REST
GET /api/daemon/runtimes/usage?window=1d|7d|30d
# 200 Response
{
  "window": "7d",
  "runtimes": [
    {
      "runtime_id": "rt_xxx",
      "summary": {
        "input_tokens": 7800000,
        "output_tokens": 1500000,
        "cache_read_tokens": 36000000,
        "cache_creation_tokens": 2100000,
        "total_cost_usd": 81.20
      },
      "daily": [
        { "ts": "2026-06-18T00:00:00", "input_tokens": 1200000, "output_tokens": 230000,
          "cache_read_tokens": 5400000, "cache_creation_tokens": 300000, "total_cost_usd": 12.34 }
      ]
    }
  ]
}

# Service
class RuntimeService:
    def get_runtimes_usage(self, window: Literal["1d","7d","30d"]) -> list[RuntimeUsageRead]: ...
# 聚合 SQL(summary;daily 同结构加 date_trunc('hour'/'day', created_at) 分组)
# SELECT COALESCE(s.runtime_id, l.runtime_id) AS rid,
#        SUM(COALESCE(r.input_tokens,0)), SUM(COALESCE(r.output_tokens,0)),
#        SUM(COALESCE(r.cache_read_tokens,0)), SUM(COALESCE(r.cache_creation_tokens,0)),
#        SUM(COALESCE(r.total_cost_usd,0))
# FROM agent_runs r
# LEFT JOIN agent_sessions s ON r.agent_session_id = s.id
# LEFT JOIN daemon_task_leases l ON r.lease_id = l.id
# WHERE COALESCE(s.runtime_id, l.runtime_id) IS NOT NULL AND r.created_at >= :since
# GROUP BY COALESCE(s.runtime_id, l.runtime_id)

# Pydantic
class RuntimeUsageSummaryRead(BaseModel):
    input_tokens: int; output_tokens: int
    cache_read_tokens: int; cache_creation_tokens: int
    total_cost_usd: float
class RuntimeUsagePointRead(BaseModel):  # ts=小时桶(1d)/日桶(7d,30d)
    ts: datetime
    input_tokens: int; output_tokens: int
    cache_read_tokens: int; cache_creation_tokens: int
    total_cost_usd: float
class RuntimeUsageRead(BaseModel):
    runtime_id: str
    summary: RuntimeUsageSummaryRead
    daily: list[RuntimeUsagePointRead]
```

```typescript
// frontend lib/daemon.ts
export async function getRuntimesUsage(window: '1d'|'7d'|'30d'): Promise<RuntimeUsageResponse>
// daemon message usage / batch meta 扩展:cache_read_tokens?, cache_creation_tokens?
```

## 7.5 生命周期契约表

本次涉及 `agent_run`/`daemon`/`lease`/`runtime` 关键词。**本次为只读统计,不改 lease/session/agent_run 生命周期状态机**,新增的仅是 cache 载荷字段流入既有 `agent_run` 行。usage 数据流契约:

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| Claude `stream_event` message_delta | Claude CLI | daemon `StreamJsonAdapter.parseStreamEvent` | `event.usage.cache_creation_input_tokens`, `cache_read_input_tokens` | 无(累积到 `_currentTurnUsage.cache_*`) |
| codex turn response | codex CLI | daemon `codex-app-server-driver` | `usage.cache_read_tokens?`, `cache_creation_tokens?`(尽力而为) | 无 |
| ndjson step_finish | opencode CLI | daemon `NdjsonAdapter` | `tokens.cache.read`, `tokens.cache.write` | 无(累积 cache_read/write_tokens) |
| usage_update emit | daemon adapter | backend `run_sync.submit_messages` | `usage.cache_read_tokens`, `cache_creation_tokens` | 无(写 `AgentRun.cache_*`,取 max) |
| interactive turn 终态 | daemon | backend `close_interactive_run` | `cache_read_tokens`, `cache_creation_tokens` | running→completed(状态已有,新增 cache 载荷) |
| batch result meta | daemon | backend `_apply_run_metadata` | `cache_read_tokens`, `cache_creation_tokens` | 无(meta 写 `AgentRun`) |
| 聚合查询 | frontend | backend `get_runtimes_usage` | `window` | 无(只读 SUM) |

## 8. 数据模型

```sql
-- agent_runs 新增列(migration;数据可清空,直接 add column,无 backfill)
ALTER TABLE agent_runs ADD COLUMN cache_read_tokens INTEGER NULL;
ALTER TABLE agent_runs ADD COLUMN cache_creation_tokens INTEGER NULL;
```

SQLModel `AgentRun` 加 `cache_read_tokens: int | None`、`cache_creation_tokens: int | None`。聚合依赖 PostgreSQL `date_trunc`(项目统一 PG)。

## 9. 兼容策略

- 新列 nullable;老数据为 NULL;老 daemon 不传 cache 则不写(保持 NULL),`SUM` 自动忽略。
- 无 cache 数据的 runtime(codex 等)缓存项前端显示「—」;无 cost 数据显示 `$0.00`。
- 新接口 `GET /runtimes/usage` 独立,不影响现有 `/runtimes`、`/sessions` 端点。
- 数据可清空(CLAUDE.md 规则 7),migration 直接 add column。
- 跨平台:daemon(Node)/frontend(Next)/DB(PG)均跨平台,无 windows/macos 特殊处理(CLAUDE.md 规则 12)。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | Claude CLI `message_delta.event.usage` 是否真透传 `cache_creation/read_input_tokens`(代码注释只提 input/output) | P1 | execute 用真实 Claude CLI 流实测字段;不透传则 Claude cache 回退 NULL,前端显示「—」,不阻塞主功能(input/output/cost 正常) |
| R-02 | batch 路径 `total_cost_usd` 填充率取决于 daemon 上报 | P1 | 用户已确认不排查;SUM 忽略 NULL,无数据费用显示 `$0.00` |
| R-03 | 聚合重复计算(interactive run 同时挂 agent_session_id+lease_id,UNION 双路径会算两次) | P2→resolved | Design Grill 查证:interactive run 经 lease 关联(`run_sync/service.py:359-365` 用 lease.agent_run_id 定位)且 agent_session_id 非空(service.py:286 以 `agent_session_id IS NULL` 区分 batch),两字段并存。改用 LEFT JOIN+COALESCE 单查询,每 run JOIN 后唯一一行,天然去重(D-003@v2) |
| R-04 | 30 天数据聚合性能 | P2 | `created_at` 时间过滤收窄;必要时加索引(execute 确认) |
| R-05 | `date_trunc` 方言冲突(生产 PostgreSQL / 测试 SQLite in-memory) | P1 | task-08 实现做方言分支(PG 用 `func.date_trunc`、SQLite 用 `strftime` 或 dialect 检测);task-15 测试不绑死 SQL 函数名,按「daily 行数 ≤ N + ts 整点」断言 |

## 11. 决策追踪

- **D-001@v1**(codex/OpenAI 系无 cache,尽力而为)→ 覆盖:Wave 1 codex driver、Wave 4 缓存「—」、R-01
- **D-002@v1**(当日按小时 / 7d·30d 按日)→ 覆盖:Wave 3 `date_trunc`、接口 daily 粒度
- **D-003@v2**(聚合 LEFT JOIN+COALESCE,已替代 D-003@v1)→ 覆盖:Wave 3 `get_runtimes_usage`、R-03。Design Grill 查证 D-003@v1 的 UNION 双路径有重复计算风险(interactive run 同时挂 session+lease),修正为单查询 LEFT JOIN+COALESCE(每 run 唯一一行)
- **D-004@v1**(当日本地自然日 + 非实时刷新)→ 覆盖:Wave 4 切窗拉取(非 SSE)、Wave 3 since 计算

均无未解决版本,详见 `decisions.md`。

## 12. 自审

- **需求覆盖** ✅ input/output/cache/cost + sparkline + 时间窗,与对话式探索确认一致。
- **Grill/决策覆盖** ✅ 引用 D-001~D-004。
- **约束一致** ✅ `local.yaml` 子项目命令、coverage≥60%、TDD、中文 UI、跨平台。
- **真实性** ✅ 文件路径/符号来自调研(`agent_runs`/`service.py`/`router.py`/`stream-json.ts` 等真实存在);migration 序号/down_revision 标注 execute 取 alembic head。
- **YAGNI** ✅ 非目标明确(无实时刷新/无币种换算/无全局图)。
- **验收可测** ✅ 切窗数字+图变、Claude cache 可见、codex 缓存「—」。
- **兼容策略** ✅ nullable + SUM 忽略 NULL。
- **风险识别** ✅ R-01~R-04。
- **生命周期契约表** ✅ usage 数据流契约表,标注只读不改 lifecycle。
- **⚠️ 自审存疑**:R-01 的 Claude CLI cache 字段透传未 100% 实测确认,列为 execute 首要验证项。
- **Design Grill 修正**:R-03/D-003 发现 UNION 双路径重复计算风险(interactive run 同时挂 session+lease,run_sync/service.py:359-365/286 查证),已修正为 LEFT JOIN+COALESCE 单查询(D-003@v2),§5/§7/§10/§11 同步更新。
