---
id: task-11
title: lib/daemon.ts 加 getRuntimesUsage(window) + RuntimeUsage* 类型
priority: P2
estimated_hours: 1
depends_on: [task-10]
blocks: [task-14]
requirement_ids: [FR-01, FR-03]
decision_ids: []
allowed_paths:
  - frontend/src/lib/daemon.ts
author: qinyi
created_at: 2026-06-24 10:55:18
---

# task-11: lib/daemon.ts 加 getRuntimesUsage(window) + RuntimeUsage* 类型

> Wave 4 前端数据层。为 runtime 卡片用量展示（task-14）提供 REST client。
> 打 `GET /api/daemon/runtimes/usage?window=1d|7d|30d`（端点由 task-10 在 backend 落地），
> 一次返回**所有** runtime 的 summary + daily 序列。本任务只加 fetch 函数 + TS 类型，
> 不写组件、不动 page.tsx。类型与后端 `RuntimeUsageSummaryRead` / `PointRead` / `Read`（task-09 schema）一一对齐。

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/lib/daemon.ts` | 新增 `RuntimeUsageWindow` 联合类型、`RuntimeUsageSummary` / `RuntimeUsagePoint` / `RuntimeUsageItem` / `RuntimeUsageResponse` 接口、`getRuntimesUsage(window)` fetch 函数。插入位置:文件末尾(Sessions 区块之后),与其它只读 GET(listAgentSessions/listDaemonRuntimes)并列。 |

> 不新增文件。类型与函数都进既有 `lib/daemon.ts`(单一 daemon API client,符合现有组织约定——所有 daemon REST 都在此文件)。

## 覆盖来源

- **Requirements**:
  - `FR-01`:卡片显示输入/输出/缓存/费用 → 本任务提供拉取这些数字的 client。
  - `FR-03`:时间窗(1d/7d/30d)聚合接口 → 本任务的 `window` 入参 + 批量响应类型。
- **Decisions**:无(本任务只是后端 D-002/D-003/D-004 决策产出的 API 的薄 client,自身不承载决策)。

## 实现要求

1. **类型对齐 task-09 后端 Pydantic**(字段名、可空性严格一致,后端 SUM 后字段恒为 int/float 不可空;daily 的 `ts` 为 ISO 字符串——后端序列化 datetime 为 str,前端不再 Date 化,图表 x 轴直接用字符串)。
2. **复用 `apiFetch`**(文件已 import `apiFetch`,见 `listAgentSessions`/`listDaemonRuntimes` 模式),**不要**手写 `fetch`(会丢 accessToken/错误归一化)。
3. **window 入参收紧为联合字面量** `'1d' | '7d' | '30d'`(非 string),编译期防 typo。走 `query` 选项传参(见 `api.ts:91` 的 `query?: Record<...>`),`apiFetch` 内部已做 URLSearchParams 编码,不要手拼 query string。
4. **URL 路径** `/api/daemon/runtimes/usage`(批量,无 runtime_id 路径段——一次拉全部 runtime)。
5. 函数/类型加 JSDoc,说明:批量响应、window 粒度(1d 小时桶 24 点 / 7d·30d 日桶,D-002@v1)、本函数非实时(D-004@v1,进页面/切窗拉取)。

## 接口定义（代码类必填）

```typescript
// ===== 插入位置:frontend/src/lib/daemon.ts 文件末尾 =====

/**
 * 时间窗字面量(D-002@v1):
 *   - "1d":当日(本地自然日 today 00:00 起,D-004@v1),daily 按小时 24 桶;
 *   - "7d" / "30d":daily 按日桶。
 */
export type RuntimeUsageWindow = "1d" | "7d" | "30d";

/**
 * 单个 runtime 的用量汇总(SUM over window)。对齐后端 RuntimeUsageSummaryRead(task-09)。
 * 后端 `SUM(COALESCE(col, 0))` 保证这些字段恒为数值(无 NULL);
 * 前端类型用 number 不可空。codex 等无 cache 的 runtime,cache_read/creation_tokens = 0。
 */
export interface RuntimeUsageSummary {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_cost_usd: number;
}

/**
 * 时间序列单点(小时桶 1d / 日桶 7d·30d,D-002@v1)。ts 为 ISO 8601 字符串(后端 datetime 序列化结果)。
 */
export interface RuntimeUsagePoint {
  ts: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_cost_usd: number;
}

/** 单个 runtime 的完整用量(summary + 序列)。 */
export interface RuntimeUsageItem {
  runtime_id: string;
  summary: RuntimeUsageSummary;
  daily: RuntimeUsagePoint[];
}

/** GET /api/daemon/runtimes/usage 响应体。runtimes 为全部 runtime 的数组(可能含 0 用量项)。 */
export interface RuntimeUsageResponse {
  window: RuntimeUsageWindow;
  runtimes: RuntimeUsageItem[];
}

/**
 * GET /api/daemon/runtimes/usage?window=1d|7d|30d — 批量拉取所有 runtime 的 token/cost 用量(FR-01 / FR-03)。
 *
 * 非实时(D-004@v1):本函数仅进页面/切窗时主动调用,后端不做 SSE 推送卡片聚合。
 * 后端聚合用 LEFT JOIN+COALESCE 去重(D-003@v2),interactive run 只算一次。
 * codex / OpenAI 系无 cache(D-001@v1),其 cache_* 恒为 0,前端显示「—」。
 *
 * @param window 时间窗;默认 "7d"。
 * @throws ApiError 401 未登录 / 5xx 后端故障——由 apiFetch 归一化抛出,调用方 try/catch。
 */
export async function getRuntimesUsage(
  window: RuntimeUsageWindow = "7d",
): Promise<RuntimeUsageResponse> {
  return apiFetch<RuntimeUsageResponse>("/api/daemon/runtimes/usage", {
    query: { window },
  });
}
```

## 边界处理（必填,至少5条）

1. **window 非法值**:TS 联合类型编译期拦截;若上层(切窗 UI)误传 string,`apiFetch` 原样透传给后端,FastAPI 校验 422→ApiError(调用方 task-14 已 try/catch 降级)。
2. **401 未登录 / token 过期**:由 `apiFetch` 抛 ApiError(401),不在本函数吞错;task-14 用法兜底(显示空用量)。
3. **5xx 后端故障 / 网络中断**:同上,抛 ApiError;本函数不重试(YAGNI,task-14 切窗重拉即可)。
4. **runtimes 为空数组**(无任何 runtime):合法响应,`runtimes: []` 原样返回;task-14 对空数组展示空卡片(不崩)。
5. **某 runtime 的 daily 为空数组**(窗口内该 runtime 无 run):合法,`daily: []`;task-14 sparkline 显示「暂无数据」占位(照搬 WorkHourBarChart 空数据逻辑)。
6. **cache_* 为 0**(codex 等无 cache,或 Claude 老数据 NULL):字段恒为 number 0,不抛 undefined;task-14 据此显示「—」。
7. **ts 字符串格式**:不在此解析为 Date(避免时区/格式分歧),x 轴直接用字符串;task-12/14 如需格式化自行 `new Date(point.ts)`。
8. **类型与后端漂移**:dev-time 校验不强制(对齐 AgentSessionListResponseSchema 的宽松策略——passthrough,不做运行时 zod 严格校验,避免双重维护)。

## 非目标

- 不写组件(RuntimeUsageLineChart 在 task-12、page 集成在 task-14)。
- 不动后端端点(task-10 负责)。
- 不做 SSE 订阅(D-004@v1 明确非实时;本函数是纯 REST GET)。
- 不做运行时 zod 严格校验(与 AgentSessionListResponseSchema 的 passthrough 策略一致)。
- 不做 token/cost 格式化(那是 task-14 的展示职责;本任务只搬数据)。

## 参考

- `lib/daemon.ts:22` `listDaemonRuntimes()` —— 最简 GET + apiFetch 模板。
- `lib/daemon.ts:854-866` `listAgentSessions({limit,offset,status})` —— query 参数传递模板(`query` 选项 + `apiFetch`)。
- `lib/api.ts:88-107` `ApiRequestOptions.query` + `apiFetch` URLSearchParams 编码。
- design.md §7 接口定义(REST Response 结构) + §7.5 生命周期契约表(聚合查询=只读 SUM)。

## TDD 步骤

> 本任务为纯类型 + fetch 透传函数,无业务逻辑分支可单测(单一 happy path 就是 `apiFetch(path, {query})`,mock apiFetch 测它等于测 mock 自身,价值低)。
> 正确性靠**类型检查** + task-15 的 page 级集成测试覆盖。按 CLAUDE.md 规则 7(非逻辑调整不强改测试通过),本任务**不写新单测**。

1. (无单测)在 `frontend/` 跑 `pnpm typecheck` 验证类型正确(含与 apiFetch 泛型、RuntimeUsageResponse 字段对齐)。
2. 静态走查:确认 `getRuntimesUsage` 与类型已 export、import 路径无循环依赖。
3. task-15 将在 page 集成层(mock fetch)覆盖 window 参数透传 + 响应反序列化。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd frontend && pnpm typecheck` | 退出码 0,无类型错误(RuntimeUsage* 类型与 apiFetch 泛型契合) |
| 2 | 检查 `lib/daemon.ts` 新增符号 export | `getRuntimesUsage` / `RuntimeUsageWindow` / `RuntimeUsageSummary` / `RuntimeUsagePoint` / `RuntimeUsageItem` / `RuntimeUsageResponse` 均命名 export |
| 3 | 检查 `getRuntimesUsage` 调用走 `apiFetch` | 函数体为 `return apiFetch<RuntimeUsageResponse>("/api/daemon/runtimes/usage", { query: { window } })`,无手写 fetch / 手拼 query string |
| 4 | 检查 window 参数为联合字面量 | 签名为 `window: RuntimeUsageWindow = "7d"`,非 `string` |
| 5 | 检查类型字段名与后端 task-09 schema 一致 | input_tokens/output_tokens/cache_read_tokens/cache_creation_tokens/total_cost_usd/runtime_id/window/daily/ts 命名完全对齐(驼峰/下划线一致) |
| 6 | (后端 task-10 就绪后)`getRuntimesUsage("7d")` 真实调用 | 返回 RuntimeUsageResponse,runtimes 数组每项含 summary + daily(由 task-14 验收时实测) |
