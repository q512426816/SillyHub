---
author: qinyi
created_at: 2026-08-30 16:45:12
scale: large
tier: independent
risk_level: contract-required
---

# 设计文档（Design）— 变更中心用量与耗时统计

## 背景

变更中心已有「变更」（changes）与「快速修复」（quicklog_entries）两个维度的管理与展示，但用户看不到一个变更/快速修复**实际花了多少时间、烧了多少 token**：

- `changes` 表与 `quicklog_entries` 表均无 started_at / finished_at / duration / token 字段；
- 数据面其实齐备——`agent_runs` 已有 `started_at`/`finished_at`/`duration_ms`/`num_turns`/四维 token 列（`input_tokens`/`output_tokens`/`cache_read_tokens`/`cache_creation_tokens`；`ctx_tokens` 为快照列不入聚合），`agent_run_model_usage` 有 run×模型四维+`api_requests` 明细；变更侧 `agent_runs.change_id` FK（派发锚点）与 `change_session_links`（会话锚点）、快速修复侧 `quicklog_session_links`→`agent_sessions` 链路均可聚合；
- 会话维度上周已落地同构能力（2026-08-29-session-usage-stats：`GET /api/daemon/sessions/{id}/usage`，明细主源+四维兜底两段聚合范式）。

本变更把该能力推广到变更中心两个维度：**只读聚合，零 schema 变更，不改 daemon**。

## 设计目标

1. 变更列表/快速修复列表各加「执行」摘要列：耗时 + token 总量 + 调用次数（紧凑两行，起止时间悬浮提示）。
2. 变更详情页与快速修复抽屉展示完整用量卡：开始时间、结束时间、耗时、轮次、输入/输出/缓存读/缓存写、调用次数、缓存命中率 + 分模型折叠明细。
3. 时间口径 = 执行时间口径（D-001）：首次执行的 `started_at` → 最近执行的 `finished_at`，耗时 = `duration_ms` 累加（纯执行时长）。
4. token 口径 = 并集去重（D-002）：变更侧「挂 change_id 的派发执行 ∪ 关联会话内执行」，按 run 去重；快速修复侧恒走关联会话链路。
5. 全部实时聚合计算字段（D-003），零迁移；列表批量聚合零 N+1。

## 非目标（Non-Goals）

- 不做金额/计费折算（对齐运行时页/会话页先例口径）。
- 不做工作区级/全局汇总（运行时页 `/runtimes/usage` 已覆盖）。
- 不改 daemon 侧任何代码（用量已由既有 run 终态上报链路落库）。
- 零数据库迁移（复用 `agent_runs`/`agent_run_model_usage`/两张 link 表，不改任何表结构）。
- 不动移动端页面（`frontend/src/app/m/**` 的变更详情/列表本次不加列，移动端后续单独迭代）。
- 不做实时逐 token 更新（数据粒度 = run 终态落库，展示随列表轮询/详情打开刷新）。

## 拆分判断

单一功能模块（一个聚合服务 + 两个列表加列 + 一个可复用详情组件），前后端 DTO 契约耦合紧密，不满足拆分条件（<3 个可独立交付模块、无多角色视图、无跨页面状态流转）；任务数 <10，无批量模式诉求。单变更推进，Wave 按 后端→前端→收口 排。

## 总体方案

**Wave 1（backend 聚合服务与 DTO）**：新建 `change/usage_service.py`（`ChangeUsageQueryService`），核心是「去重执行集合」语义：

- 变更执行集合（D-002 并集去重）：
  ```sql
  SELECT r.id FROM agent_runs r WHERE r.change_id = :cid
  UNION                                    -- UNION 自带按整行去重
  SELECT r.id FROM agent_runs r
    JOIN change_session_links csl ON csl.session_id = r.agent_session_id
   WHERE csl.change_id = :cid
  ```
  两锚点均经 change 定位，天然限定在本工作区内（change 属于 workspace，link 行挂 change），无需额外 workspace join。
- 快速修复执行集合（无派发锚点，恒走会话链路）：
  ```sql
  SELECT DISTINCT r.id FROM agent_runs r
    JOIN quicklog_session_links qsl ON qsl.session_id = r.agent_session_id
   WHERE qsl.workspace_id = :wid AND qsl.ql_id = :ql
  ```
- 详情聚合（两端点共用，对齐 session-usage 两段范式）：明细段 `agent_run_model_usage` JOIN 集合 GROUP BY model（SUM 四维 + api_requests）；兜底段集合中无明细行的 run 按 `COALESCE(run.model,'未记录')` 归并 SUM 四维列（`ctx_tokens` 快照列显式排除，api_requests 按 0 诚实值）；时间三元组与轮次在集合上 `MIN(started_at)`/`MAX(finished_at)`/`SUM(duration_ms)`/`SUM(num_turns)`（SQL 聚合自动忽略 NULL，全 NULL → None）。
- 列表批量摘要：变更侧按 `(change_id, run_id)` 维度 UNION 去重后外层 GROUP BY change_id（一次查询出整页摘要）；快速修复侧 `quicklog_session_links` JOIN `agent_runs` 后 `DISTINCT (ql_id, run_id)` 再 GROUP BY ql_id。分别挂进 `ChangeService.enrich_summaries` 批量管道与 quicklog 列表组装处（对齐 `_project_current_stage`/`_resolve_user_names` 既有批量模式，R-03 禁 N+1）。

**Wave 2（backend 端点）**：`change/router.py` 新增两个只读端点（权限 `CHANGE_READ`，404 语义对齐既有详情端点——不存在/不属于该工作区 → 404 resource-hiding）：
- `GET /api/workspaces/{workspace_id}/changes/{change_id}/usage`
- `GET /api/workspaces/{workspace_id}/quicklog-entries/{ql_id}/usage`

**Wave 3（frontend 展示）**：新组件 `change-usage-card.tsx`（react-query `useQuery` 自取数——两个目标渲染点的既有卡片 `change-sessions-card.tsx:60` / `quicklog-sessions-card.tsx:60` 均用 useQuery，均在 QueryClientProvider 内；不沿用 session-usage-bar 的 useEffect 模式，因其规避的是会话浮窗零 react-query 约束，本变更两渲染点无此约束。变更详情页头部「本页禁新增网络请求」注释（[cid]/page.tsx:339）经核实为 last-signal 功能局部语境——同页 sessions 卡已 useQuery 自取数，用量卡单次取数不违反其本意（禁的是为派生小字段加轮询）。摘要行 + 分模型折叠明细 + 口径注脚；命中率口径 `cache_read/(cache_read+input)`，分母 0 显示「—」，公式口径与会话页一致（`cacheHitRate` 为 session-usage-bar.tsx 文件私有未导出，抽公共库属另一变更范围；本组件私有 helper + 注释锚定口径，对齐先例 R-02 处理方式））。四个接线点：变更列表「执行」列、快速修复列表「执行」列、变更详情页（`ChangeStageHeader` 下方）、快速修复抽屉（`quicklog-sessions-card` 旁）。

**Wave 4（契约与回归收口）**：`pnpm gen:types` 同步 `api-types.ts` + `backend/openapi.json`；前后端相关测试回归。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/change/usage_service.py | `ChangeUsageQueryService`：`get_change_usage(wid, cid)` / `get_quicklog_usage(wid, ql_id)`（详情两段聚合）+ `summarize_changes(change_ids)` / `summarize_quicklogs(wid, ql_ids)`（批量摘要，零 N+1）。集合语义见总体方案 |
| 修改 | backend/app/modules/change/schema.py | 新增 `UsageByModelItemRead` / `UsageTotalsRead` / `UsageSummaryRead` / `ChangeUsageRead` DTO；`ChangeSummary.usage` / `QuicklogEntryListItem.usage` 加 optional 计算字段（「计算字段（DTO 层），非表列，零 migration」惯例注释）。数据流：producer=`usage_service` 聚合 → `enrich_summaries`/quicklog 列表组装填充 → router `response_model` 序列化 → consumer=前端 `api-types.ts` 生成物（gen:types） |
| 修改 | backend/app/modules/change/service.py | `enrich_summaries` 尾段挂 `usage_service.summarize_changes` 批量投影（对齐 `_resolve_user_names` 批量模式；空列表/无执行 → usage 保持 None） |
| 修改 | backend/app/modules/change/router.py | ①新增两个 usage 端点（producer=`usage_service.get_*` → consumer=前端用量卡）；②`list_quicklog_entries` 组装处填充 `usage` 摘要（producer=`summarize_quicklogs`） |
| 新增 | backend/app/modules/change/tests/test_usage_stats.py | 聚合正确性：纯明细/纯兜底/混合/空集合/多模型排序/并集去重（同 run 双锚点不重复计数）/跨变更共享会话各计一次/时间三元组 NULL 语义/归属 404 |
| 新增 | frontend/src/components/changes/detail/change-usage-card.tsx | 可复用用量卡（摘要行+折叠明细+口径注脚）。react-query `useQuery` 自取数（对齐同渲染点 change-sessions-card/quicklog-sessions-card 先例）+ `kind: "change"\|"quicklog"` + `refKey` props；数据流：consumer ← `lib/changes.getChangeUsage` / `lib/quicklog.getQuicklogUsage` ← api-types `ChangeUsageRead` |
| 新增 | frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx | 渲染用例：五指标+轮次+时间三元组/命中率分母 0 →「—」/无执行边界态/折叠交互/双 kind 取数端点 |
| 修改 | frontend/src/lib/changes.ts | 新增 `getChangeUsage(workspaceId, changeId)` API 封装 |
| 修改 | frontend/src/lib/quicklog.ts | 新增 `getQuicklogUsage(workspaceId, qlId)` API 封装 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 变更列表 columns 加「执行」列（紧凑两行：耗时 + `N tok · N 次`，title 悬浮起止时间；usage None →「—」） |
| 修改 | frontend/src/components/changes/quicklog-table.tsx | 快速修复列表加同款「执行」列（含「进行中」标记：started 有值且 finished 缺） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | `ChangeStageHeader` 下方渲染 `<ChangeUsageCard kind="change">`（page.tsx:326 接线点） |
| 修改 | frontend/src/components/changes/quicklog-drawer.tsx | 抽屉底部（`quicklog-sessions-card` 旁）渲染 `<ChangeUsageCard kind="quicklog">` |
| 修改 | frontend/src/components/changes/__tests__/quicklog-table.test.tsx | 新列断言补充（现有测试 mock 数据补 usage 字段） |
| 修改 | backend/openapi.json + frontend/src/lib/api-types.ts | gen:types 生成物同步（新增 4 个 schema + 2 端点） |

## 接口定义

```python
# backend/app/modules/change/schema.py 新增
class UsageByModelItemRead(BaseModel):
    model: str                          # 模型名；兜底桶 = run.model 或 "未记录"
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    api_requests: int = 0               # 兜底桶恒 0（无来源，诚实值）

class UsageTotalsRead(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    api_requests: int = 0
    num_turns: int = 0                  # 轮次 = SUM(agent_runs.num_turns)

class ChangeUsageRead(BaseModel):
    started_at: datetime | None = None  # 集合 MIN(started_at)；无执行 → None
    finished_at: datetime | None = None # 集合 MAX(finished_at)；进行中/无执行 → None
    duration_ms: int | None = None      # SUM(duration_ms)；无任何非 NULL 值 → None
    totals: UsageTotalsRead
    by_model: list[UsageByModelItemRead] = []  # input+output 降序；「未记录」恒末位

class UsageSummaryRead(BaseModel):
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_ms: int | None = None
    totals: UsageTotalsRead
# ChangeSummary.usage: UsageSummaryRead | None = None（计算字段）
# QuicklogEntryListItem.usage: UsageSummaryRead | None = None（计算字段）
```

```python
# 端点（权限 CHANGE_READ；不存在/跨工作区 → 404，对齐既有详情端点 resource-hiding）
GET /api/workspaces/{workspace_id}/changes/{change_id}/usage      → ChangeUsageRead
GET /api/workspaces/{workspace_id}/quicklog-entries/{ql_id}/usage → ChangeUsageRead
```

```tsx
// frontend change-usage-card.tsx props
interface ChangeUsageCardProps {
  kind: "change" | "quicklog";
  workspaceId: string;
  refKey: string;            // changeId 或 qlId
}
// 自取数：useQuery（对齐同渲染点 sessions 卡先例，两渲染点均在 QueryClientProvider 内）
// 命中率（展示层派生，不入 DTO，公式口径与会话页 D-003 同式）：
// hitRate = cache_read + input > 0 ? cache_read / (cache_read + input) : null（null →「—」）
// 「进行中」标记 = started_at 有值且 finished_at 为 null
// 取数失败/404（含抽屉开着条目被删的竞态）→ 渲染边界态文案，不弹错误
```

聚合 SQL 语义（详见总体方案）：变更集合 UNION 去重、quicklog 集合 DISTINCT；明细段 JOIN `agent_run_model_usage` GROUP BY model；兜底段无明细 run 四维列求和，逐列 `SUM(COALESCE(col, 0))`（NULL run 显式归 0，对齐先例 daemon/session/service.py:6059-6063 写法；`ctx_tokens` 排除）；批量摘要 UNION/DISTINCT 后 GROUP BY 维度键。SQLAlchemy select 实现，不拉 run 行进内存循环（防 IN 膨胀，对齐先例 R-03）。

边界口径（Design Grill 补充，G2/G3/F12）：
- **软删会话计入统计**：`agent_sessions.deleted_at` 非空的会话其执行仍计入（消耗真实发生；`agent_runs.agent_session_id` 外键刻意 `SET NULL` 不断链，agent/model.py:767-769）；UI 会话卡隐藏软删会话是展示层考虑，与用量口径不矛盾——注脚声明。无 `agent_session_id` 的孤儿 run（外键置空）无法经会话锚点命中，但派发锚点 `change_id` 仍可命中，不丢数。
- **quicklog usage 端点 404 语义对齐详情端点**（严格 404，不像姊妹端点 `/sessions` 容忍「有 link 无条目」竞态——usage 卡只在条目存在的抽屉内渲染，窗口极小且前端按边界态降级）。
- **deleted 变更行 usage 恒 None**：`enrich_summaries` 对 `location='deleted'` 行 continue 在投影段之前（service.py:1933-1936），尾段挂的 usage 投影同样不作用；usage 端点对 deleted 变更 404（对齐既有详情读侧防复活口径）。

## 生命周期契约

不涉及生命周期契约——本变更为纯只读聚合查询与展示：仅 SELECT 读取 `agent_runs`/`agent_run_model_usage`/`change_session_links`/`quicklog_session_links`，不改任何 session/lease/agent_run 状态机、不新增事件、不改 daemon。

## 数据模型

零 schema 变更。`UsageSummaryRead`/`ChangeUsageRead` 均为 DTO 层计算字段（非表列，零 migration），填充方式与 `owner_name`/`step_progress`/`last_pushed_at` 同款（`enrich_summaries` 批量管道 + quicklog 列表组装处）。

## 兼容策略（brownfield）

- 新字段全部 optional default None：旧客户端/旧前端不读 `usage` 字段不受影响；gen:types 前后端不同步发布也不炸（字段缺失走 None 降级）。
- 不改任何既有 API 的既有字段、不改表结构、无迁移、无回填。
- 无关联执行的变更/快速修复：`usage = None`（列表显示「—」、详情卡显示边界态文案），不回退 `created_at`（D-001 明确否决生命周期口径）。
- quicklog 双源（PG ∪ 文件解析）不受影响：usage 聚合只依赖 PG 的 link 表与 runs，文件源条目无绑定时 usage=None。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | quicklog 会话绑定写入点多（agent-logs 上报 quick_id / 门户发会话），聚合可能含弱相关会话 | P1 | 口径注脚声明「统计关联会话内全部执行」；抽屉内既有「关联会话」卡片可逐会话核对，用户可解绑修正 |
| R-02 | 列表批量聚合 SQL 复杂度（两锚点 UNION + GROUP BY） | P1 | SQL 侧一次批量完成；`agent_runs.change_id`/`agent_runs.agent_session_id` 均有既有索引；列表只算摘要不算 by_model；每页 ≤50 行量级实测覆盖（测试造多变更分页） |
| R-03 | 跨变更共享会话 → 同一份消耗在多个变更各显示一次 | P1 | D-002 已确认为口径特性非 bug；详情卡注脚明示 |
| R-04 | 兜底桶（2026-08-29 之前老 run）api_requests 无来源 | P2 | 按 0 诚实值 + 注脚（对齐 by_provider「未记录」先例） |
| R-05 | 时间三元组 NULL 语义组合（started 有/finished 无 = 进行中；全无 = 未执行） | P1 | DTO 注释固化语义；前端「进行中」标记 = started 有值且 finished 缺；测试覆盖三种组合 |
| R-06 | `enrich_summaries` 是既有热路径（列表），挂新查询引入回归 | P1 | 批量模式对齐既有先例；usage 投影放管道尾段、空集合零查询；`test_enrich_projection` 既有用例回归 |
| R-07 | 软删会话执行计入统计，与会话卡 UI 隐藏形成认知张力 | P2 | D-006 口径：消耗真实发生应计入；注脚声明，用户对不上数时可对照注脚理解 |

## 决策追踪

| 决策 | 状态 | 覆盖位置 |
|---|---|---|
| D-001@v1 时间口径 = 执行时间口径 | accepted | 设计目标 3、总体方案 Wave 1、接口定义（started_at/finished_at/duration_ms 语义） |
| D-002@v1 统计范围 = 并集去重 | accepted | 设计目标 4、总体方案 Wave 1（集合 SQL）、测试（并集去重/跨变更共享用例）、R-03 |
| D-003@v1 落地 = 实时聚合零迁移 | accepted | 设计目标 5、数据模型、兼容策略 |
| D-004@v1 展示 = 列表+详情 | accepted | 设计目标 1/2、总体方案 Wave 3、文件变更清单前端段 |
| D-005@v1 API 形态 = 方案 A（独立端点+列表摘要） | accepted | 总体方案 Wave 2、接口定义 |
| D-006@v1 软删会话执行计入统计 | accepted | 接口定义边界口径段、R-07 |
| D-007@v1 用量卡取数 = react-query useQuery | accepted | 总体方案 Wave 3、文件变更清单 |

无未解决决策；无剩余风险超出上表。

## 自审（Self-Review）

- **章节齐全**：背景/目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约/数据模型/兼容策略/风险登记/决策追踪/自审——全部在位。
- **生命周期关键词扫描**：正文出现 `agent_runs`（只读表名）→ 已按规则在紧邻位置写明「不涉及生命周期契约」豁免短语，且为事实（纯 SELECT，零状态变更）。
- **数据流完整性**：两处对外新增（`usage` DTO 字段、两个端点）均在文件清单标注 producer→consumer 链路，无 dormant 字段。
- **契约硬要求预检**：frontmatter（author/created_at/scale/tier）齐；「文件变更清单」「风险」「自审 / Self-Review」字面命中；`scale: large`（跨 backend/frontend 约 15 文件、DTO 契约变更）→ 后续 plan 走四件套。
- **原型**：`prototype-change-center-usage.html` 已生成（四场景+边界态，分级=建议生成级：列表列调整+详情卡片），UI 以其为视觉基准。
- **Design Grill 复审结论（2026-08-30，独立子代理）**：specVerdict=pass / qualityVerdict=pass，0 个 P0/P1 未决项；3 个 P2 gap（G1 命中率实现措辞、G2 软删会话语义、G3 quicklog 404 竞态）与 2 个 note（N1 详情页约束边界、N2 COALESCE 写法）已全部吸收进上文（Wave 3 / 接口定义边界口径段 / R-07 / D-006 / D-007）。原自审存疑 1（quicklog link 唯一约束）经子代理核实实为 `UNIQUE(workspace_id, ql_id, session_id)`（change/model.py:319-324），DISTINCT 防御充分；存疑 2（批量 UNION 行同构）核实成立。
