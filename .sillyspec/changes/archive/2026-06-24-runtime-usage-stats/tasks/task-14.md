---
id: task-14
title: runtimes/page.tsx 顶部时间窗切换器 + RuntimeCard 用量区 + sparkline
priority: P1
estimated_hours: 3
depends_on: [task-11, task-13]
blocks: [task-15]
requirement_ids: [FR-01, FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
author: qinyi
created_at: 2026-06-24 10:55:18
---

# task-14: runtimes/page.tsx 顶部时间窗切换器 + RuntimeCard 用量区 + sparkline

> Wave 4 前端集成(本变更**面向用户的核心交付**)。在 runtimes 页面:
> 1. 顶部加**时间窗切换器**(3 tab:当日 / 7 天 / 30 天),页面级状态,切窗时重发 `getRuntimesUsage` 拉**所有** runtime 的用量(D-004@v1 非实时,仅切窗/进页面触发)。
> 2. `RuntimeCard` 加**用量区**(输入/输出/缓存/费用 4 数字 + sparkline 折线)。
> 3. 批量响应按 `runtime_id` 分发到对应卡片(参考现有 `sessionStatsByRuntime` 的 Map 聚合模式)。
> token k/M 格式化、费用 `$USD`、cache 合并读+写(有数据时显示、无数据显示「—」、codex 缓存恒「—」)。

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 顶部加时间窗切换器(3 tab);页面级 `usageWindow` 状态 + `usageByRuntime` Map 状态;`useEffect` 切窗/进页面拉 `getRuntimesUsage`;`RuntimeCard` props 扩展 `usage?: RuntimeUsageItem` + `usageWindow`;卡片新增用量区(4 数字 + RuntimeUsageLineChart sparkline);token/cost 格式化 helper |

> 不动 `lib/daemon.ts`(task-11)、`charts/*`(task-12/13)、后端(已在前序 Wave 完成)。
> 仅本文件一处改动(组件 + 状态 + helper 都内聚在 page,符合现有组织——RuntimeCard/SummaryCard/sessionStatsByRuntime 均在本文件)。

## 覆盖来源

- **Requirements**:
  - `FR-01`:卡片显示输入/输出/缓存/费用 4 数字。
  - `FR-04`:卡片内嵌 sparkline 折线 + 顶部时间窗切换器驱动所有卡片同步。
- **Decisions**:
  - `D-004@v1`:非实时刷新——卡片数字不订阅 SSE,**仅进页面 + 切窗时**调用 `getRuntimesUsage`;不做 SSE 推卡片聚合(YAGNI)。

## 实现要求

### 1. 顶部时间窗切换器(页面级)

- 在「运行时列表」section 标题栏(`page.tsx:939-962`,刷新按钮所在行)左侧或上方,新增 3 tab 切换器:`当日`(1d)/ `7 天`(7d)/ `30 天`(30d)。
- tab 用现有 `Button variant="outline"` 或简单 `<button>` + active 态高亮(`variant="default"` active / `variant="outline"` inactive),照搬项目现有 tab 风格。
- 页面级状态:`const [usageWindow, setUsageWindow] = useState<RuntimeUsageWindow>("7d")`(默认 7 天)。
- 中文文案(CLAUDE.md 规则 11):tab 文案「当日」「7 天」「30 天」。

### 2. 用量数据拉取(useEffect,非实时)

- 新增状态:`const [usageByRuntime, setUsageByRuntime] = useState<Map<string, RuntimeUsageItem>>(new Map())`;`const [usageLoading, setUsageLoading] = useState(false)`;`const [usageError, setUsageError] = useState<string | null>(null)`。
- `useEffect` 依赖 `[usageWindow]`:进页面 + 切窗时调用 `getRuntimesUsage(usageWindow)`。
- 成功:把 `response.runtimes` 按 `runtime_id` 聚合成 `Map<string, RuntimeUsageItem>`(照搬 `sessionStatsByRuntime` 的 Map 模式,`page.tsx:885-895`),`setUsageByRuntime`。
- 失败:`setUsageError(...)`(用 `ApiError.message`),`usageByRuntime` 保持空 Map(卡片显示空用量,不崩)。
- loading:`setUsageLoading(true/false)`;tab 切换时显示加载态。
- **不订阅 SSE**(D-004@v1 明确);**不做轮询**(YAGNI)。
- 可选:reload(手动刷新按钮,`page.tsx:952-961`)时也重拉 usage(复用同一 fetch 函数)。

### 3. RuntimeCard 用量区(4 数字 + sparkline)

- `RuntimeCard` props 扩展:`usage?: RuntimeUsageItem`(可选,无数据时 undefined)、`usageWindow: RuntimeUsageWindow`、`usageLoading?: boolean`。
- 在卡片现有「运行环境/心跳/版本/协议/会话」grid(`page.tsx:540-576`)之后、「运行能力」section(`page.tsx:578-586`)之前,新增**用量区**:
  - 标题行:「用量统计(`{windowLabel}`)」+ 小字「`{usageLoading ? "加载中" : ""}`」。
  - 4 数字网格(2×2 或 4 列):**输入**(input_tokens)、**输出**(output_tokens)、**缓存**(cache 合并 read+creation,见下)、**费用**(total_cost_usd)。
  - sparkline:从 `@/components/charts`(**桶导出**,task-13 的 dynamic 版,非原始组件)import `RuntimeUsageLineChart`,传 `usage.daily` + `loading={usageLoading}`。
- **缓存合并显示**(D-001@v1):cache = `cache_read_tokens + cache_creation_tokens`;**有数据**(`> 0`)显示合并值;**无数据**(`=== 0`,codex 或老数据)显示「—」。
- 数字格式化(见接口定义的 helper):
  - token:`formatTokens(n)` → `< 1000` 原值;`>= 1000` 用 `k`(如 1.2k);`>= 1_000_000` 用 `M`(如 1.5M)。
  - 费用:`formatCost(n)` → `$${n.toFixed(2)}`(USD,无币种换算);`0` 显示 `$0.00`。
  - 缓存:先合并再 formatTokens;若合并为 0 显示「—」。

### 4. 批量响应分发

- 渲染 `RuntimeCard` 时(`page.tsx:968-978`),从 `usageByRuntime.get(runtime.id)` 取该 runtime 的 usage,传给卡片;`usageWindow` 同步传入。
- 无用量数据(新 runtime / 窗口内无 run):`usage` undefined,卡片用量区显示「暂无数据」(sparkline 占位) + 数字全「—」或 `$0.00`。

## 接口定义（代码类必填）

```tsx
// ===== frontend/src/app/(dashboard)/runtimes/page.tsx 新增/修改片段 =====

import { RuntimeUsageLineChart } from "@/components/charts"; // 桶导出(dynamic ssr:false),非原始组件
import {
  // ... 现有 import ...
  getRuntimesUsage,
  type RuntimeUsageItem,
  type RuntimeUsageWindow,
} from "@/lib/daemon";

// ---------- 格式化 helper(文件内私有,照搬 formatRelativeTime 的位置风格) ----------

/** token 数值 k/M 格式化(FR-01)。< 1000 原值;>= 1e6 用 M;>= 1e3 用 k。 */
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** 费用 USD 格式化(FR-01)。$xx.xx,0 显示 $0.00。 */
function formatCost(n: number): string {
  return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

/** 缓存合并显示(D-001@v1):read + creation,> 0 时 formatTokens,否则「—」。 */
function formatCache(item: RuntimeUsageItem | undefined): string {
  if (!item) return "—";
  const sum = item.summary.cache_read_tokens + item.summary.cache_creation_tokens;
  return sum > 0 ? formatTokens(sum) : "—";
}

/** 时间窗中文 label。 */
const WINDOW_LABELS: Record<RuntimeUsageWindow, string> = {
  "1d": "当日",
  "7d": "7 天",
  "30d": "30 天",
};

// ---------- RuntimeCard props 扩展 ----------
function RuntimeCard({
  runtime,
  actioning,
  sessionStats,
  usage,        // 新增:RuntimeUsageItem | undefined
  usageWindow,  // 新增
  usageLoading, // 新增
  onToggleEnabled,
  onOpenSession,
  onDelete,
}: {
  runtime: DaemonRuntimeRead;
  actioning: boolean;
  sessionStats: { total: number; active: number };
  usage?: RuntimeUsageItem;          // 新增
  usageWindow: RuntimeUsageWindow;   // 新增
  usageLoading?: boolean;            // 新增
  onToggleEnabled: (runtime: DaemonRuntimeRead) => Promise<void>;
  onOpenSession: (runtime: DaemonRuntimeRead) => void;
  onDelete: (runtime: DaemonRuntimeRead) => Promise<void>;
}) {
  // ... 现有逻辑 ...

  // 用量区(插在「会话」RuntimeMeta 之后、「运行能力」section 之前)
  const summary = usage?.summary;
  const inputLabel = summary ? formatTokens(summary.input_tokens) : "—";
  const outputLabel = summary ? formatTokens(summary.output_tokens) : "—";
  const cacheLabel = formatCache(usage);
  const costLabel = summary ? formatCost(summary.total_cost_usd) : "$0.00";

  return (
    <article>
      {/* ... 现有 header + grid ... */}

      {/* ===== 新增:用量区 ===== */}
      <div className="border-t px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase text-muted-foreground">
            用量统计（{WINDOW_LABELS[usageWindow]}）
          </p>
          <span className="text-[11px] text-muted-foreground">
            {usageLoading ? "加载中" : ""}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          <UsageStat label="输入" value={inputLabel} />
          <UsageStat label="输出" value={outputLabel} />
          <UsageStat label="缓存" value={cacheLabel} />
          <UsageStat label="费用" value={costLabel} />
        </div>
        <div className="mt-2">
          <RuntimeUsageLineChart
            points={usage?.daily ?? []}
            loading={usageLoading}
          />
        </div>
      </div>

      {/* ... 现有「运行能力」+ 操作按钮 ... */}
    </article>
  );
}

/** 用量数字小格子(类 RuntimeMeta 但更紧凑)。 */
function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

// ---------- 页面级状态 + 拉取 ----------
// 在 RuntimesPage 组件内:
const [usageWindow, setUsageWindow] = useState<RuntimeUsageWindow>("7d");
const [usageByRuntime, setUsageByRuntime] = useState<Map<string, RuntimeUsageItem>>(new Map());
const [usageLoading, setUsageLoading] = useState(false);

useEffect(() => {
  let cancelled = false;
  setUsageLoading(true);
  getRuntimesUsage(usageWindow)
    .then((resp) => {
      if (cancelled) return;
      const map = new Map<string, RuntimeUsageItem>();
      for (const item of resp.runtimes) map.set(item.runtime_id, item);
      setUsageByRuntime(map);
    })
    .catch(() => {
      if (cancelled) return;
      setUsageByRuntime(new Map()); // 失败:空 Map,卡片显示空用量
    })
    .finally(() => {
      if (!cancelled) setUsageLoading(false);
    });
  return () => { cancelled = true; };
}, [usageWindow]);

// ---------- 时间窗切换器(顶部) ----------
// 插在「运行时列表」section 标题栏:
<div className="flex items-center gap-1">
  {(Object.keys(WINDOW_LABELS) as RuntimeUsageWindow[]).map((w) => (
    <Button
      key={w}
      size="sm"
      variant={usageWindow === w ? "default" : "outline"}
      onClick={() => setUsageWindow(w)}
    >
      {WINDOW_LABELS[w]}
    </Button>
  ))}
</div>

// ---------- 渲染时分发 usage ----------
<RuntimeCard
  key={runtime.id}
  runtime={runtime}
  actioning={runtimeActionId === runtime.id}
  sessionStats={sessionStatsByRuntime.get(runtime.id) ?? { total: 0, active: 0 }}
  usage={usageByRuntime.get(runtime.id)}     // 新增
  usageWindow={usageWindow}                  // 新增
  usageLoading={usageLoading}                // 新增
  onToggleEnabled={handleToggleRuntime}
  onOpenSession={handleOpenSession}
  onDelete={handleDeleteRuntime}
/>
```

## 边界处理（必填,至少5条）

1. **getRuntimesUsage 失败(401/5xx/网络)**:catch 后 `setUsageByRuntime(new Map())`,卡片 usage=undefined → 数字全「—」、费用 `$0.00`、sparkline「暂无数据」;不崩、不阻塞页面其它部分(列表/心跳/会话数正常)。可在切换器旁显示错误提示(可选,非必须)。
2. **usage 数据未到位(初次进页面,usageByRuntime 空)**:`usageByRuntime.get(id)` = undefined → 同上空用量展示;`usageLoading=true` 时 sparkline 显示骨架、数字区显示「加载中」或骨架。
3. **codex runtime 无 cache(D-001@v1)**:`cache_read + cache_creation = 0` → `formatCache` 返回「—」(验收重点项 AC-05)。
4. **Claude runtime 有 cache**:合并 read+creation > 0 → formatTokens 显示(如「5.4M」)。
5. **token 极大值**(M 级,36_000_000):`formatTokens` → `36.0M`,不溢出卡片格子(`truncate` class 防溢出)。
6. **费用为 0**(无 cost 数据,R-02):`formatCost(0)` → `$0.00`(非「—」,费用恒显示金额)。
7. **daily 为空数组**(窗口内该 runtime 无 run):`usage.daily = []` → RuntimeUsageLineChart 走空数据占位「暂无数据」分支(task-12 已处理)。
8. **切窗竞态**(快速点 1d→7d→30d):useEffect cleanup 设 `cancelled=true`,旧请求 resolve 时跳过 set,只采最新窗数据(代码示例已含 `cancelled` 守卫)。
9. **SSR window 报错**:`RuntimeUsageLineChart` **必须**从 `@/components/charts`(桶,dynamic ssr:false)import,不能从 `./RuntimeUsageLineChart` 原始路径 import(否则 echarts SSR 报 `window is not defined`)。
10. **window 状态持久化**:切窗后刷新页面会回到默认 "7d"(useState 初值);**不做** URL query 持久化(YAGNI,D-004@v1 仅切窗/进页面拉取)。

## 非目标

- 不做 SSE 实时推卡片用量(D-004@v1 明确非实时)。
- 不做费用币种换算(design §3 非目标,按 USD 原值显示)。
- 不做用量数据的 URL query 持久化(切窗刷新回默认)。
- 不做全局多 runtime 合并总览图(design §3 非目标,只做卡片内 sparkline)。
- 不动 lib/daemon.ts / charts/* / 后端(均已在前序 task 完成)。
- 不做 export/下载用量数据(YAGNI)。
- 不改 RuntimeCard 既有结构(header/会话/能力/操作按钮),用量区是**新增** section。

## 参考

- `page.tsx:885-895` `sessionStatsByRuntime` —— **Map 聚合模板**(照搬:遍历数组 → Map.set)。
- `page.tsx:484-629` `RuntimeCard` —— **卡片结构模板**(header + grid + section + 操作);用量区插在 grid 后、能力 section 前。
- `page.tsx:433-463` `SummaryCard` —— 紧凑数字格子风格参考(UsageStat 借鉴其 label/value 排版)。
- `page.tsx:939-962` section 标题栏 + 刷新按钮 —— **切换器插入位置**。
- `page.tsx:967-978` `<RuntimeCard>` 渲染 —— **props 分发位置**(加 usage/usageWindow/usageLoading)。
- `components/charts/index.tsx`(task-13) —— RuntimeUsageLineChart **桶导出**(dynamic ssr:false)。
- design.md §5 Wave 4 + §9 兼容策略(无 cache 显示「—」、无 cost 显示 `$0.00`)。

## TDD 步骤

> 本任务为 UI 集成,涉及 React state + 副作用 + 格式化。按 plan.md,前端集成测试在 task-15 集中落地(vitest + RTL)。本任务**不强制写测试**(遵循 Wave 5 集中测试),但格式化 helper(formatTokens/formatCost/formatCache)是纯函数,**值得单测**,task-15 应覆盖:
> - formatTokens:0 → "0"、999 → "999"、1500 → "1.5k"、1_500_000 → "1.5M"。
> - formatCost:0 → "$0.00"、81.2 → "$81.20"。
> - formatCache:undefined → "—"、{0,0} → "—"、{5_400_000, 300_000} → "5.7M"。

1. (无单测,留 task-15)写完后 `cd frontend && pnpm typecheck` 确认 props 扩展、import、helper 类型正确。
2. 手动目视(本机 `pnpm dev`):进 runtimes 页 → 卡片显示用量区;点「当日/7 天/30 天」→ 数字 + sparkline 同步变。
3. codex runtime 卡片:缓存显示「—」(AC-05)。
4. task-15 RTL 测试覆盖:切窗 mock getRuntimesUsage → 断言卡片数字/sparkline 切换。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd frontend && pnpm typecheck` | 退出码 0;RuntimeCard props 扩展、getRuntimesUsage/类型 import、helper 签名正确 |
| 2 | 进 runtimes 页,卡片显示用量区 | 每张卡片有「输入/输出/缓存/费用」4 数字 + sparkline(AC-01) |
| 3 | 点顶部「当日 / 7 天 / 30 天」tab | 所有卡片的 4 数字 + sparkline 同步刷新(AC-02) |
| 4 | codex runtime 卡片缓存格 | 显示「—」(D-001@v1 / AC-05) |
| 5 | Claude runtime 卡片缓存格 | 有 cache 数据时显示合并值(formatTokens,如「5.7M」) |
| 6 | 费用格 | 有数据 `$xx.xx`、无数据 `$0.00`(非「—」) |
| 7 | token 格式化 | k/M 正确(1.5k / 1.5M) |
| 8 | 切窗快速点击(竞态) | 最终显示最后所选窗数据(无闪烁错乱,useEffect cancelled 守卫生效) |
| 9 | getRuntimesUsage 失败(断网/mock 500) | 卡片用量区显示空(「—」/$0.00/「暂无数据」),不崩、不阻塞列表其它部分 |
| 10 | RuntimeUsageLineChart import 路径 | 从 `@/components/charts`(桶)import,非原始组件路径(SSR 不报 window 错) |
| 11 | sparkline 空数据(窗口内该 runtime 无 run) | 显示「暂无数据」占位(task-12 空数据分支生效) |
| 12 | 文案中文 | tab「当日/7 天/30 天」、用量区标题「用量统计(7 天)」、占位「暂无数据」均为中文(CLAUDE.md 规则 11) |
