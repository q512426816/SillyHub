---
id: task-15
title: 三子项目单测(daemon cache/backend 聚合去重/frontend 图表)
priority: P1
estimated_hours: 6
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13, task-14]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-003@v2]
allowed_paths:
  - sillyhub-daemon/tests/adapters/stream-json-cache.test.ts
  - sillyhub-daemon/tests/adapters/ndjson-cache-passthrough.test.ts
  - backend/app/modules/daemon/tests/test_runtimes_usage_aggregation.py
  - backend/app/modules/daemon/tests/test_run_sync_cache_parse.py
  - backend/app/modules/agent/tests/test_apply_run_metadata_cache.py
  - frontend/src/components/charts/__tests__/RuntimeUsageLineChart.test.tsx
  - frontend/src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx
  - frontend/src/lib/__tests__/daemon-usage.test.ts
author: qinyi
created_at: 2026-06-24 10:55:18
---

# task-15: 三子项目单测(daemon cache/backend 聚合去重/frontend 图表)

本任务为 Wave 5 测试与验收汇总任务,收尾整个变更 `2026-06-24-runtime-usage-stats` 的三层单测,直接对应 AC-07(三子项目测试通过、backend coverage≥60%),并补强 AC-03(聚合去重)、AC-04(分组粒度)、AC-05(cache 尽力而为)等正确性核心断言。

依据文档:
- design.md §7(接口/聚合 SQL)、§10 R-03(LEFT JOIN+COALESCE 去重)、§11 D-003@v2
- plan.md AC-01~07、Wave 5 任务说明
- decisions.md D-003@v2(UNION 双路径会重复计算 interactive run,改 LEFT JOIN+COALESCE)

## 修改文件(必填)

### 新增测试文件

| 子项目 | 文件路径 | 覆盖 |
|---|---|---|
| daemon | `sillyhub-daemon/tests/adapters/stream-json-cache.test.ts` | task-01:message_delta cache 提取 + extractResultStats 透传 |
| daemon | `sillyhub-daemon/tests/adapters/ndjson-cache-passthrough.test.ts` | task-03:ndjson cache 透传到 TaskResult.usage |
| backend | `backend/app/modules/daemon/tests/test_runtimes_usage_aggregation.py` | task-08:双路径去重 + 分组粒度 + since 计算(R-03/D-002@v1/D-003@v2 核心) |
| backend | `backend/app/modules/daemon/tests/test_run_sync_cache_parse.py` | task-07:interactive 路径 cache 解析(max 逻辑) |
| backend | `backend/app/modules/agent/tests/test_apply_run_metadata_cache.py` | task-06:batch 路径 `_apply_run_metadata` cache 解析 |
| frontend | `frontend/src/components/charts/__tests__/RuntimeUsageLineChart.test.tsx` | task-12:line sparkline 双线渲染 + 空数据占位 |
| frontend | `frontend/src/app/(dashboard)/runtimes/__tests__/page-usage.test.tsx` | task-14:时间窗切换 + 数字/图同步 + token 格式化 + codex 「—」 |
| frontend | `frontend/src/lib/__tests__/daemon-usage.test.ts` | task-11:`getRuntimesUsage(window)` 类型 + fetch URL |

### 不修改的实现文件(本任务为汇总测试,实现已在 task-01~14 完成)

仅当测试暴露实现缺陷时,按 TDD 红绿循环回到对应 task 修复,不在 task-15 内改实现。

## 覆盖来源

- **Requirements**: FR-01(卡片 4 数字 + sparkline)、FR-02(cache 全链路采集)、FR-03(批量聚合接口)、FR-04(时间窗 sparkline)、FR-05(兼容/nullable)
- **Decisions**: D-002@v1(1d 按小时 / 7d·30d 按日)、D-003@v2(LEFT JOIN+COALESCE 去重,替代 UNION)
- **Risks**: R-03(interactive run 同时挂 session+lease 只算一次,核心去重断言)
- **AC 映射**: AC-01~04 由实现任务覆盖,本任务的断言直接守 AC-03(去重)、AC-04(粒度)、AC-05(cache 尽力而为)、AC-07(三项目绿 + coverage)

## 实现要求

### daemon(vitest) — cache 采集层单测

测试位置:`sillyhub-daemon/tests/`(对照现有 `tests/adapters/ndjson.test.ts`、`tests/stats-passthrough.test.ts` 模式),用真实 `StreamJsonAdapter`/`NdjsonAdapter` 实例 + `createFakeChild` 驱动完整 parse 链路。命令:`cd sillyhub-daemon && pnpm test`(`vitest run --passWithNoTests`)。

#### `stream-json-cache.test.ts`(覆盖 task-01)

用例见「接口定义」daemon 小节。关键点:`message_delta` 事件 `event.usage` 中提取 `cache_creation_input_tokens`/`cache_read_input_tokens`,映射为 daemon 内部 `cache_creation_tokens`/`cache_read_tokens`,经 `extractResultStats` 透传到 `metadata.stats`。

#### `ndjson-cache-passthrough.test.ts`(覆盖 task-03)

`NdjsonAdapter.getUsage()` 在 `step_finish` 的 `tokens.cache.read/write` 已有 `cache_read_tokens`/`cache_write_tokens`(现有 `ndjson.test.ts:176-187` 已断言);本测试聚焦透传到 `TaskResult.usage`(经 `stats-passthrough.test.ts` 同款 FakeChild 路径)。

### backend(pytest, coverage≥60%) — 聚合去重与 cache 解析单测

测试位置:`backend/app/modules/daemon/tests/` 与 `backend/app/modules/agent/tests/`(对照现有 `daemon/tests/test_lease_service.py` 的 `db_session` fixture + ORM 行构造模式)。命令:`cd backend && uv run pytest -q --cov=app --cov-fail-under=60`。

**基础设施**:`conftest.py` 提供 `db_session`(SQLite in-memory `async_sessionmaker`)、`client`(httpx ASGITransport)、`auth_admin_token`/`auth_headers`。**关键陷阱**:conftest 用 SQLite,而 design §7 聚合依赖 PostgreSQL `date_trunc`;测试须适配 —— 要么断言 task-08 实现做了方言分支(`func.date_trunc` 仅 PG / SQLite 用 `strftime` 或 Python 桶),要么聚合测试仅验证 **summary 去重正确性**(不依赖 date_trunc 的 SQL 分组),daily 粒度用 Python 层重排校验行数(24 / N 天)。本任务在「接口定义」backend 小节按后者设计,避免测试被方言卡死。

#### `test_runtimes_usage_aggregation.py`(覆盖 task-08, **本变更正确性核心**)

构造 runtime + session + lease + agent_run ORM 行,调 `RuntimeService.get_runtimes_usage(window)` 断言。核心用例:interactive run 同时挂 `agent_session_id` + `lease_id`,只算一次(R-03)。

#### `test_run_sync_cache_parse.py`(覆盖 task-07)

interactive 路径 `_eventToMessages`/`submit_messages`/`close_interactive_run` 从 usage 取 cache,沿用 input/output 的 **max 逻辑**(多 turn 取最大,不累加)。构造 usage dict,断言写入 `AgentRun.cache_*`。

#### `test_apply_run_metadata_cache.py`(覆盖 task-06)

batch 路径 `_apply_run_metadata` 从 meta 解析 `cache_read_tokens`/`cache_creation_tokens`(`_METADATA_FIELDS` 包含两字段)。构造 `agent_runs` meta,断言写入。

### frontend(vitest + @testing-library/react) — 图表与页面单测

测试位置:`frontend/src/components/charts/__tests__/` 与 `frontend/src/app/(dashboard)/runtimes/__tests__/`(对照 `components/__tests__/work-hour-bar-chart.test.tsx`、`app/(dashboard)/runtimes/page.test.tsx` 模式)。命令:`cd frontend && pnpm test`(`vitest run`)。

**基础设施**:`src/test/setup.ts`(globals: true,无需 import describe/it);**关键陷阱**:直接 import 具体组件文件,绕过 `charts/index.tsx` 的 `next/dynamic(ssr:false)`(dynamic 在 jsdom 会卡 loading 态,见 `work-hour-bar-chart.test.tsx:4-5` 注释);断言 `.echarts-for-react` 容器存在(不验证 canvas 像素);mock `@/lib/daemon` 的 `getRuntimesUsage`。

#### `RuntimeUsageLineChart.test.tsx`(覆盖 task-12)

echarts `type:'line'` sparkline,输入/输出双线。

#### `page-usage.test.tsx`(覆盖 task-14)

runtimes 页顶部时间窗切换器(当日/7天/30天)切窗 → `getRuntimesUsage(window)` 重拉 → 数字 + sparkline 同步变。RuntimeCard 用量区 4 数字 k/M 格式化、费用 `$USD`、codex 无 cache 显示「—」。

#### `daemon-usage.test.ts`(覆盖 task-11)

`getRuntimesUsage(window)` fetch URL(`/api/daemon/runtimes/usage?window=7d`)+ 返回类型 `RuntimeUsageResponse` 字段映射。

## 接口定义(代码类)

### daemon

```typescript
// stream-json-cache.test.ts
describe('StreamJsonAdapter cache 提取(message_delta)', () => {
  it('message_delta.event.usage 带 cache_*_input_tokens → 累加到 _currentTurnUsage.cache_*', () => {
    // 给输入:assistant usage(input/output) + message_delta{usage:{cache_creation_input_tokens:100, cache_read_input_tokens:200, input_tokens:50, output_tokens:30}}
    // 断言:adapter.getUsage().cache_creation_tokens === 100, cache_read_tokens === 200
    //       (或经 result 事件 extractResultStats metadata.stats.cache_* === 100/200)
  });

  it('message_delta 无 cache 字段(Claude CLI 不透传,R-01 回退)→ cache_* 保持 0/undefined,不影响 input/output', () => {
    // 给输入:message_delta{usage:{input_tokens:50, output_tokens:30}}(无 cache_*_input_tokens)
    // 断言:input_tokens/output_tokens 正常累加;cache_creation_tokens/cache_read_tokens === 0 或不存在
  });

  it('多 turn message_delta cache 累加(取 max,沿用 input/output 逻辑)', () => {
    // 给输入:turn1 message_delta cache_read=200;turn2 cache_read=300
    // 断言:final cache_read_tokens === 300(max 非 sum,与 input/output 一致)
  });

  it('extractResultStats(result 事件)透传 cache_* 到 metadata.stats', () => {
    // 给输入:assistant(message.usage.cache_read_input_tokens=200) + result(usage.cache_read_input_tokens=200)
    // 断言:complete 事件 metadata.stats.cache_read_tokens === 200
  });
});

// ndjson-cache-passthrough.test.ts
describe('NdjsonAdapter cache 透传到 TaskResult.usage', () => {
  it('step_finish tokens.cache.read/write → getUsage() cache_read/write_tokens', () => {
    // (现有 ndjson.test.ts:176-187 已断言 getUsage;本用例补 TaskResult.usage 透传)
    // 给输入:step_finish{tokens:{cache:{read:20, write:10}}}
    // 断言:TaskRunner.runLease 结果 stats.cache_read_tokens === 20, cache_write_tokens === 10
  });

  it('cache 缺失(tokens 无 cache 键)→ cache_* = 0,不报错(D-001@v1 尽力而为)', () => {
    // 给输入:step_finish{tokens:{input:100, output:50}}(无 cache)
    // 断言:cache_read_tokens === 0, cache_write_tokens === 0
  });
});
```

### backend

```python
# test_runtimes_usage_aggregation.py — 核心去重 + 粒度(R-03/D-003@v2/D-002@v1)

async def test_get_runtimes_usage_interactive_run_dedup_ac03(db_session):
    """AC-03 核心:interactive run 同时挂 agent_session_id + lease_id 只算一次(R-03)。

    setup:
      - runtime rt-A
      - session s1(runtime_id=rt-A)
      - lease l1(runtime_id=rt-A)
      - agent_run r1(agent_session_id=s1, lease_id=l1, input=1000, output=200, cache_read=5000, cost=1.5)
        (interactive run 的真实形态:两 FK 都非空)
    断言:
      - get_runtimes_usage('7d') rt-A summary.input_tokens == 1000(不是 2000)
      - output == 200(不是 400), cache_read == 5000(不是 10000), cost == 1.5(不是 3.0)
      - 即 LEFT JOIN+COALESCE 单查询每 run 唯一一行,UNION 双路径会翻倍的场景被去重
    """

async def test_get_runtimes_usage_batch_run_via_lease_only(db_session):
    """batch run(agent_session_id IS NULL)经 lease.runtime_id 归属。

    setup:runtime rt-B, lease l2(rt-B), agent_run r2(agent_session_id=None, lease_id=l2, input=500)
    断言:rt-B summary.input_tokens == 500(经 COALESCE(NULL, l.runtime_id) 取 lease.runtime_id)
    """

async def test_get_runtimes_usage_multi_runtime_isolation(db_session):
    """多 runtime 数据隔离 + 按 runtime_id 分组。

    setup:rt-A(s1+r1 input=1000)、rt-C(s3+r3 input=3000)
    断言:返回 2 个 RuntimeUsageRead,各自 summary 正确,不串台
    """

async def test_get_runtimes_usage_window_1d_hour_buckets_ac04(db_session):
    """AC-04:1d 窗按小时分组(24 点)。

    setup:runtime + 1 个 agent_run(created_at=今天某小时)
    断言:daily 返回 24 行(或仅含数据的非零桶,行数 <= 24,ts 为整点);
          task-08 用 date_trunc('hour') 或 SQLite 等价;本测试不强依赖 date_trunc,
          断言 daily 行数 <= 24 且每行 ts 的 minute/second 为 0
    """

async def test_get_runtimes_usage_window_7d_30d_day_buckets_ac04(db_session):
    """AC-04:7d/30d 窗按日分组。

    断言:7d daily 行数 <= 7,ts 为当天 00:00;30d 行数 <= 30
    """

async def test_get_runtimes_usage_since_local_midnight_d004(db_session):
    """D-004@v1:1d 窗 since = 本地自然日 today 00:00。

    setup:agent_run created_at = 昨天 23:59
    断言:window='1d' 不返回该 run(created_at < since);
          window='7d' 返回(since 往前 7 天)
    """

async def test_get_runtimes_usage_nullable_sum_ignores_null_ac06(db_session):
    """AC-06/FR-05:NULL 列被 SUM(COALESCE(...,0)) 忽略。

    setup:agent_run(cache_read_tokens=None, cache_creation_tokens=None, total_cost_usd=None)
    断言:summary.cache_read_tokens == 0, total_cost_usd == 0.0(不报错,不 NaN)
    """

async def test_get_runtimes_usage_empty_runtime(db_session):
    """无任何 run 的 runtime:返回 summary 全 0 + daily 空列表(前端显示占位)。

    setup:runtime rt-E,无 session/lease/run
    断言:get_runtimes_usage 返回 rt-E(若实现含零数据 runtime)或不含 rt-E(若实现只返有数据 runtime);
          断言二者之一 + 文档化预期行为(本测试用例需在实现后确认)
    """

# test_run_sync_cache_parse.py — interactive cache max 逻辑(task-07)
async def test_close_interactive_run_cache_max_logic(db_session):
    """interactive 路径 cache 沿用 input/output 的 max 逻辑(多 turn 取最大非累加)。

    setup:turn1 usage cache_read=200;turn2 cache_read=500
    断言:AgentRun.cache_read_tokens == 500(max)
    """

async def test_submit_messages_cache_from_usage(db_session):
    """_eventToMessages 从 usage.cache_read_tokens/cache_creation_tokens 解析写入。"""

# test_apply_run_metadata_cache.py — batch cache 解析(task-06)
async def test_apply_run_metadata_cache_fields(db_session):
    """batch meta 含 cache_read_tokens/cache_creation_tokens → 写入 AgentRun。

    setup:meta={'input_tokens':100, 'cache_read_tokens':5000, 'cache_creation_tokens':200}
    断言:AgentRun.cache_read_tokens == 5000, cache_creation_tokens == 200
    """

async def test_apply_run_metadata_cache_missing_stays_null(db_session):
    """meta 无 cache 字段 → AgentRun.cache_* 保持 None(D-001@v1 codex 尽力而为)。

    setup:meta={'input_tokens':100}(codex 系,无 cache)
    断言:cache_read_tokens is None, cache_creation_tokens is None
    """
```

### frontend

```typescript
// RuntimeUsageLineChart.test.tsx
describe('RuntimeUsageLineChart', () => {
  it('有数据时挂载 echarts 容器(双线)', () => {
    // 给输入:points=[{ts, input_tokens:1000, output_tokens:200}, ...]
    // 断言:container.querySelector('.echarts-for-react') 非空(不验 canvas 像素)
  });

  it('空数据显示「暂无数据」占位', () => {
    // 给输入:points=[]
    // 断言:screen.getByText('暂无数据');querySelector('.echarts-for-react') 为 null
  });

  it('自定义颜色/高度透传(复用 CHART_COLORS)', () => {
    // 断言:.echarts-for-react 根 div style.height 透传
  });
});

// page-usage.test.tsx — 对照 runtimes/page.test.tsx mock 模式
describe('RuntimesPage 用量区 + 时间窗(task-14)', () => {
  it('卡片显示输入/输出/缓存/费用 4 数字(AC-01)', () => {
    // mock getRuntimesUsage 返回 rt-A summary(input=7800000, output=1500000, cache_read=36000000, cost=81.20)
    // 断言:卡片渲染「7.8M」「1.5M」「36.0M」「$81.20」(token k/M 格式化)
  });

  it('token k/M 格式化(<1000 原值,>=1000 → k,>=1000000 → M)', () => {
    // 断言:999 → '999';1500 → '1.5k';1500000 → '1.5M'
  });

  it('时间窗切窗触发 getRuntimesUsage 重拉 + 数字/图同步(AC-02)', () => {
    // 初始 window=7d;点「当日」tab
    // 断言:getRuntimesUsage 被以 '1d' 再调一次;数字/图刷新
  });

  it('codex 无 cache → 缓存项显示「—」(D-001@v1/AC-05)', () => {
    // mock getRuntimesUsage 返回 rt-codex summary(cache_read=0 或字段缺失)
    // 断言:卡片缓存区显示「—」(非 0)
  });

  it('loading=true 显示骨架/加载态', () => {
    // mock getRuntimesUsage pending
    // 断言:getByLabelText(/加载中/) 或 skeleton 存在
  });
});

// daemon-usage.test.ts
describe('getRuntimesUsage(window)', () => {
  it('fetch /api/daemon/runtimes/usage?window=7d 并映射 RuntimeUsageResponse', async () => {
    // mock fetch 返回 {window, runtimes:[{runtime_id, summary, daily}]}
    // 断言:fetch URL 含 window=7d;返回类型字段映射正确
  });

  it('window 参数透传(1d/7d/30d)', () => {
    // 断言:三个 window 值各调一次,URL 参数正确
  });
});
```

## 边界处理(必填,至少 5 条)

1. **空数据(runtime 无任何 run)**:`get_runtimes_usage` 返回该 runtime summary 全 0 + daily 空列表;前端 RuntimeUsageLineChart 空数组显示「暂无数据」占位;不报错不 NaN。
2. **NULL cache 列(老数据/codex 无 cache)**:`SUM(COALESCE(r.cache_read_tokens, 0))` 忽略 NULL,summary.cache_* = 0;前端 codex 卡片缓存区显示「—」(D-001@v1),不显示误导性的「0」。
3. **NULL cost 列**:`SUM(COALESCE(r.total_cost_usd, 0))` → 0.0;前端显示 `$0.00`,不 NaN(AC-06/FR-05)。
4. **Claude CLI message_delta 不透传 cache(R-01 回退)**:`cache_*_input_tokens` 缺失 → daemon cache_* 保持 0/undefined,后端写入 NULL,前端显示「—」;input/output/cost 不受影响,主功能不阻塞。
5. **interactive run 同时挂 session+lease(去重核心 R-03/D-003@v2)**:LEFT JOIN+COALESCE 单查询,每 run JOIN 后唯一一行,COALESCE 优先 `s.runtime_id`;UNION 双路径会算两次的场景被天然去重。本条为 AC-03 核心断言,必须有专项单测。
6. **batch run(agent_session_id IS NULL)**:经 `COALESCE(NULL, l.runtime_id)` 取 lease.runtime_id,不被 session 路径漏算(D-003@v1 漏 lease 会少算 batch)。
7. **since 边界(本地自然日零点,D-004@v1)**:`window='1d'` since = 本地 today 00:00 转 UTC;昨天 23:59 的 run 在 1d 窗不返回,7d 窗返回。测试用 `freezegun` 或显式构造 created_at 避免时区抖动。
8. **date_trunc 方言(conftest SQLite vs 生产 PG)**:task-08 实现需方言分支(PG `func.date_trunc` / SQLite `strftime` 或 Python 桶);本任务测试在 SQLite 下可跑,粒度断言用「行数 <= N + ts 整点」而非直接断言 SQL 函数名,避免绑死方言。
9. **重复 run(同一 run 被多 turn 更新)**:`agent_run` 行级 max 逻辑(interactive 多 turn 取最大 cache_*),不累加;聚合 SUM 在 run 行级,不因 turn 数翻倍。
10. **多 runtime 数据隔离**:rt-A 与 rt-C 的 token/cost 不串台,GROUP BY runtime_id 各自独立;前端按 runtime_id 分发批量响应到对应卡片。

## 非目标

- 不做端到端联调测试(daemon→backend→frontend 全链路),本任务为各子项目独立单测,联调留 verify 阶段。
- 不测 SSE/WS 实时推送(D-004@v1 明确非实时刷新,切窗/进页面拉取)。
- 不测费用币种换算(非目标,按 USD 原值)。
- 不测全局多 runtime 合并总览图(非目标)。
- 不测 echarts canvas 像素级渲染(只断言 `.echarts-for-react` 容器存在 + 数据 prop 传入)。
- 不修改 task-01~14 的实现代码;若测试暴露缺陷,按 TDD 回到对应 task 红绿修复,不在 task-15 内改实现。
- 不测 migration 的 up/down(数据可清空,task-04 已覆盖 `alembic upgrade head`)。
- 不测 lease/session/agent_run 生命周期状态机(本次为只读统计)。

## 参考

### 各子项目现有测试模式

- **daemon**:
  - `sillyhub-daemon/tests/adapters/ndjson.test.ts` — `NdjsonAdapter` parse + getUsage(`cache_read_tokens`/`cache_write_tokens` 累加已断言 L176-187),用 `loadFixture` + `makeNdjsonLine` helper。
  - `sillyhub-daemon/tests/stats-passthrough.test.ts` — `StreamJsonAdapter` `extractResultStats` + `_spawnAndStream`→`TaskRunnerResult.stats` 透传链路,用 `createFakeChild`(`tests/helpers/fake-child.ts`)驱动真实 adapter,5 case 覆盖累加/reset/payload。本任务的 stream-json cache 测试直接复用此 FakeChild 模式。
  - `sillyhub-daemon/tests/helpers.ts` — `loadFixture`、通用断言工具。
- **backend**:
  - `backend/app/modules/daemon/tests/test_lease_service.py` — `db_session` fixture + `_create_user`/`_create_runtime`/`_create_lease_row` ORM 行构造 helper(本任务聚合测试复用此 helper 模式建 runtime/session/lease/agent_run 行)。
  - `backend/conftest.py` — `db_session`(SQLite in-memory)、`client`(httpx ASGITransport)、`auth_admin_token`/`auth_headers`、`asyncio_mode=auto`(测试协程无需 `@pytest.mark.asyncio`)。
  - `backend/tests/modules/daemon/test_session_sse.py` — `_FakeSession`/`_FakePubSub` hermetic fake 模式(本任务聚合测试走真实 `db_session` ORM,无需 fake,但 cache 解析若涉及 service 内部可参考)。
- **frontend**:
  - `frontend/src/components/__tests__/work-hour-bar-chart.test.tsx` — echarts 组件测试样本:直接 import 具体组件(绕过 `next/dynamic`)、断言 `.echarts-for-react` 容器、空数据「暂无数据」、loading 骨架、颜色/高度透传。RuntimeUsageLineChart 测试 1:1 对照此模式。
  - `frontend/src/app/(dashboard)/runtimes/page.test.tsx` — page 层测试样本:mock `@/lib/daemon`(`vi.hoisted` + `vi.importActual`)、mock `next/navigation`、`useSession.setState`、`vi.stubGlobal("EventSource")`。page-usage 测试复用此 mock 脚手架,补 `getRuntimesUsage` mock。
  - `frontend/src/test/setup.ts` — globals: true(无需 import describe/it/expect)+ jest-dom。

### 测试命令(CONVENTIONS.md)

| 子项目 | 命令 | 备注 |
|---|---|---|
| backend | `cd backend && uv run pytest -q --cov=app --cov-fail-under=60` | coverage 门槛 60%,asyncio_mode=auto |
| frontend | `cd frontend && pnpm test` | = `vitest run`,globals: true |
| daemon | `cd sillyhub-daemon && pnpm test` | = `vitest run --passWithNoTests` |

## TDD 步骤

本任务为汇总测试,实现已在 task-01~14 完成;TDD 在此体现为「测试守卫既有实现 + 暴露回归」:

1. **写测试(红)**:按「接口定义」三子项目用例,先写全部测试文件;预期跑红(若 task-01~14 实现到位则部分跑绿,但边界/格式化用例可能暴露缺陷)。
2. **跑测试定位**:
   - daemon:`cd sillyhub-daemon && pnpm test` → 定位 cache 提取/透传缺陷 → 回 task-01/task-03 修。
   - backend:`cd backend && uv run pytest -q --cov=app --cov-fail-under=60` → 定位聚合去重/粒度/cache 解析缺陷 → 回 task-06/task-07/task-08 修;coverage < 60% 则补用例。
   - frontend:`cd frontend && pnpm test` → 定位图表/格式化/切窗缺陷 → 回 task-12/task-14 修。
3. **绿**:三子项目测试全绿,backend coverage ≥ 60%。
4. **守卫**:测试进 CI,后续改动若破坏 AC-03(去重)/AC-04(粒度)/AC-05(cache 尽力而为)即红。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd sillyhub-daemon && pnpm test` | vitest 全绿;stream-json-cache.test.ts(message_delta cache 提取)+ ndjson-cache-passthrough.test.ts(TaskResult.usage 透传)用例通过(对应 task-01/task-03,守 AC-05) |
| 2 | `cd backend && uv run pytest app/modules/daemon/tests/test_runtimes_usage_aggregation.py -q` | 聚合测试全绿;**`test_get_runtimes_usage_interactive_run_dedup_ac03` 必过**(interactive run 同时挂 session+lease 只算一次,R-03/D-003@v2 核心去重) |
| 3 | 同上 backend 聚合测试 | `test_get_runtimes_usage_window_1d_hour_buckets_ac04` + `test_get_runtimes_usage_window_7d_30d_day_buckets_ac04` 必过(1d 按小时 / 7d·30d 按日,D-002@v1/AC-04) |
| 4 | 同上 backend 聚合测试 | `test_get_runtimes_usage_nullable_sum_ignores_null_ac06` 必过(NULL cache/cost 被 SUM(COALESCE) 忽略,AC-06/FR-05) |
| 5 | `cd backend && uv run pytest app/modules/daemon/tests/test_run_sync_cache_parse.py app/modules/agent/tests/test_apply_run_metadata_cache.py -q` | interactive(max 逻辑)+ batch(meta 解析)cache 解析测试全绿(task-06/task-07,守 FR-02) |
| 6 | `cd backend && uv run pytest -q --cov=app --cov-fail-under=60` | **全量 backend 测试全绿 + coverage ≥ 60%**(AC-07 backend 部分) |
| 7 | `cd frontend && pnpm test` | vitest 全绿;RuntimeUsageLineChart.test.tsx(双线 + 空数据占位)+ page-usage.test.tsx(4 数字 k/M 格式化 + 切窗同步 + codex「—」)+ daemon-usage.test.ts(fetch URL)用例通过(对应 task-11/task-12/task-14,守 AC-01/AC-02/AC-05) |
| 8 | (覆盖核对)grep 验收 | 三个子项目测试文件均已新增;AC-01~07 在测试用例中有对应断言(AC-03/AC-04/AC-05 为本任务重点守卫,AC-01/AC-02 由 frontend 测试覆盖,AC-06 由 backend nullable 测试覆盖,AC-07 由本任务全绿达成) |

## 自审

- **独立完整**:本任务单测自包含,不依赖运行时 daemon/backend/frontend 实例;backend 用 SQLite in-memory,frontend 用 jsdom,daemon 用 FakeChild。
- **接口详尽**:三子项目用例给输入/断言,核心去重(R-03)、粒度(D-002)、cache 尽力而为(D-001)均有专项。
- **边界 ≥ 5**:列 10 条边界,覆盖空数据/NULL/codex 无 cache/去重/since/方言/max/隔离。
- **AC 覆盖**:AC-01(frontend 4 数字)、AC-02(切窗同步)、AC-03(去重核心)、AC-04(粒度)、AC-05(cache 尽力而为)、AC-06(nullable)、AC-07(三项目绿 + coverage)均有对应验收行。
- **陷阱已识别**:SQLite vs PG date_trunc 方言(conftest 用 SQLite,design §7 依赖 PG date_trunc)→ 测试按「行数 <= N + ts 整点」断言,不绑死方言函数名;frontend dynamic 组件 → 直接 import 绕过。
