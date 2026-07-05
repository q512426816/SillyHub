---
id: task-04
title: 前端完整度分区 + 归档门禁渲染（依赖 task-02 的类型定义）
priority: P0
estimated_hours: 1.5
created_at: 2026-06-03 16:57:56
author: qinyi
depends_on: [task-02]
blocks: [task-05]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
---

# task-04: 前端完整度分区 + 归档门禁渲染

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | A) 新增 `REQUIRED_DOCS`/`OPTIONAL_DOCS` 常量；完整度卡片分母改四件套（X/4）+ 必需/可选分区呈现。B) 归档门禁渲染由 `archiveGate.failed_checks` 改为 `archiveGate.checks`，单项判定改用 `name`/`passed`/`detail`，badge 计数改用 `checks.filter(c=>!c.passed).length` |

> 仅此一个文件。`changes.ts` 的类型契约由 task-02 提供（`ArchiveGateResponse = {can_archive, checks:[{name,passed,detail}]}`），本任务不改 `changes.ts`。

> 注意：实际行号以当前源文件为准（与设计稿粗略锚点略有偏移）。DOC_TABS 常量在 107-118 行；完整度卡片 `<section>` 在 **613-667 行**；归档门禁 `<section>` 在 **885-939 行**。下文锚点均按当前源文件实测行号给出。

---

## 实现要求

### A) 完整度卡片（问题 4）：分母改四件套 + 必需/可选分区

#### A-1. 新增常量（紧随 DOC_TABS 之后，约 118 行后）

**改前**（107-118 行，保持不动）：
```tsx
const DOC_TABS = [
  "MASTER",
  "proposal",
  "requirements",
  "design",
  "plan",
  "tasks",
  "verify_result",
  "module_impact",
  "prototypes",
  "references",
] as const;
```

**改后**（在 `DOC_TABS` 声明之后、`DOC_LABELS` 之前新增两行常量）：
```tsx
const DOC_TABS = [
  "MASTER",
  "proposal",
  "requirements",
  "design",
  "plan",
  "tasks",
  "verify_result",
  "module_impact",
  "prototypes",
  "references",
] as const;

// 完整度口径单一真相源：必需 = 四件套，分母只算这四项；其余为可选/阶段性，不进分母
const REQUIRED_DOCS = ["proposal", "design", "requirements", "tasks"] as const;
const OPTIONAL_DOCS = [
  "plan",
  "verify_result",
  "module_impact",
  "MASTER",
  "prototypes",
  "references",
] as const;
```

> `DOC_TABS` 本身保持不变（Tab 切换区仍展示全部 10 项）。新增常量只服务于完整度卡片的计数与分区。

#### A-2. 完整度卡片标题计数：分母改四件套（X/4）

**改前**（613-628 行，section 标题区）：
```tsx
      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-xs font-medium">变更文档完整性</h2>
          <span className="text-[11px] text-muted-foreground">
            {DOC_TABS.filter((dt) => {
              const doc = docExistsMap.get(dt);
              const isSpecial = dt === "prototypes" || dt === "references";
              return isSpecial
                ? (dt === "prototypes"
                    ? (matrix?.prototypes.length ?? 0)
                    : (matrix?.references.length ?? 0)) > 0
                : (doc?.exists ?? false);
            }).length}
            /{DOC_TABS.length} 文档就绪
          </span>
        </div>
```

**改后**（计数只在 `REQUIRED_DOCS` 上做，四件套无 prototypes/references，无需 isSpecial 分支；引入复用辅助函数 `docExists` 见接口定义）：
```tsx
      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-xs font-medium">变更文档完整性</h2>
          <span className="text-[11px] text-muted-foreground">
            {REQUIRED_DOCS.filter((dt) => docExists(dt)).length}
            /{REQUIRED_DOCS.length} 必需文档就绪
          </span>
        </div>
```

#### A-3. 完整度卡片主体：拆必需组 + 可选组

**改前**（629-666 行，单组 `DOC_TABS.map` 平铺全部）：
```tsx
        <div className="flex flex-wrap gap-2 px-3 py-3">
          {DOC_TABS.map((dt) => {
            const doc = docExistsMap.get(dt);
            const isSpecial = dt === "prototypes" || dt === "references";
            const count = isSpecial
              ? dt === "prototypes"
                ? (matrix?.prototypes.length ?? 0)
                : (matrix?.references.length ?? 0)
              : 0;
            const exists = isSpecial ? count > 0 : (doc?.exists ?? false);
            const isPartial = isSpecial && count > 0;

            let bg = "bg-gray-100 border-gray-200";
            let textColor = "text-gray-400";
            let icon = "—";
            if (exists && !isPartial) {
              bg = "bg-emerald-50 border-emerald-200/60";
              textColor = "text-emerald-600";
              icon = "✓";
            } else if (isPartial) {
              bg = "bg-amber-50 border-amber-200/60";
              textColor = "text-amber-600";
              icon = "◐";
            }

            return (
              <div
                key={dt}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 ${bg}`}
              >
                <span className={`text-[11px] ${textColor}`}>{icon}</span>
                <span className={`text-[11px] font-medium ${textColor}`}>
                  {DOC_LABELS[dt] ?? `${dt}.md`}
                </span>
              </div>
            );
          })}
        </div>
      </section>
```

**改后**（两组：必需组缺失标红；可选组存在绿、缺失灰显，prototypes/references 按数组计数显示 ◐/计数）：
```tsx
        <div className="space-y-3 px-3 py-3">
          {/* 必需组：四件套，缺失标红，进入分母 */}
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              必需文档（四件套）
            </p>
            <div className="flex flex-wrap gap-2">
              {REQUIRED_DOCS.map((dt) => {
                const exists = docExists(dt);
                const bg = exists
                  ? "bg-emerald-50 border-emerald-200/60"
                  : "bg-red-50 border-red-200/60";
                const textColor = exists ? "text-emerald-600" : "text-destructive";
                const icon = exists ? "✓" : "✗";
                return (
                  <div
                    key={dt}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 ${bg}`}
                  >
                    <span className={`text-[11px] ${textColor}`}>{icon}</span>
                    <span className={`text-[11px] font-medium ${textColor}`}>
                      {DOC_LABELS[dt] ?? `${dt}.md`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 可选组：阶段性/可选文档，存在绿、缺失灰显，不进分母 */}
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              可选 / 阶段性文档
            </p>
            <div className="flex flex-wrap gap-2">
              {OPTIONAL_DOCS.map((dt) => {
                const isSpecial = dt === "prototypes" || dt === "references";
                const count = isSpecial
                  ? dt === "prototypes"
                    ? (matrix?.prototypes.length ?? 0)
                    : (matrix?.references.length ?? 0)
                  : 0;
                const exists = isSpecial ? count > 0 : docExists(dt);
                const isPartial = isSpecial && count > 0;

                let bg = "bg-gray-100 border-gray-200";
                let textColor = "text-gray-400";
                let icon = "—";
                if (exists && !isPartial) {
                  bg = "bg-emerald-50 border-emerald-200/60";
                  textColor = "text-emerald-600";
                  icon = "✓";
                } else if (isPartial) {
                  bg = "bg-amber-50 border-amber-200/60";
                  textColor = "text-amber-600";
                  icon = "◐";
                }
                return (
                  <div
                    key={dt}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 ${bg}`}
                  >
                    <span className={`text-[11px] ${textColor}`}>{icon}</span>
                    <span className={`text-[11px] font-medium ${textColor}`}>
                      {DOC_LABELS[dt] ?? `${dt}.md`}
                      {isSpecial && count > 0 && (
                        <span className="ml-1 rounded bg-muted px-1 text-[10px]">{count}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
```

> `DOC_TABS` 的 Tab 切换区（669-708 行的第二个 `<section>`）**不改动**，仍遍历 `DOC_TABS` 全部 10 项，内容加载逻辑不动。

---

### B) 归档门禁渲染（问题 3 连带）：failed_checks → checks

#### B-1. badge 未通过计数

**改前**（885-894 行 section 标题区）：
```tsx
          {change.current_stage === "accepted" && (
            <section className="rounded-md border bg-card">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <h2 className="text-xs font-medium">归档门禁</h2>
                {archiveGate && (
                  <Badge variant={archiveGate.can_archive ? "success" : "destructive"}>
                    {archiveGate.can_archive ? "✅ 全部通过" : `${archiveGate.failed_checks.length} 项未通过`}
                  </Badge>
                )}
              </div>
```

**改后**（计数改用 `checks.filter((c) => !c.passed).length`）：
```tsx
          {change.current_stage === "accepted" && (
            <section className="rounded-md border bg-card">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <h2 className="text-xs font-medium">归档门禁</h2>
                {archiveGate && (
                  <Badge variant={archiveGate.can_archive ? "success" : "destructive"}>
                    {archiveGate.can_archive
                      ? "✅ 全部通过"
                      : `${archiveGate.checks.filter((c) => !c.passed).length} 项未通过`}
                  </Badge>
                )}
              </div>
```

#### B-2. 单项判定（find by name / passed / detail）

**改前**（900-923 行 6 项 map 渲染）：
```tsx
                    {[
                      { check: "no_unresolved_feedback", label: "无未解决反馈" },
                      { check: "ac_confirmed", label: "验收标准已确认" },
                      { check: "tech_verification_passed", label: "技术验证已通过" },
                      { check: "business_review_passed", label: "业务评审已通过" },
                      { check: "feedback_categorized", label: "反馈已分类" },
                      { check: "documents_complete", label: "文档已全部完成" },
                    ].map((item) => {
                      const failed = archiveGate.failed_checks.find((c) => c.check === item.check);
                      const passed = !failed;
                      return (
                        <div key={item.check} className="flex items-center gap-2 text-xs">
                          <span className={passed ? "text-emerald-600" : "text-destructive"}>
                            {passed ? "✓" : "✗"}
                          </span>
                          <span className={passed ? "text-foreground" : "text-destructive"}>
                            {item.label}
                          </span>
                          {!passed && failed?.message && (
                            <span className="text-muted-foreground text-[10px]">— {failed.message}</span>
                          )}
                        </div>
                      );
                    })}
```

**改后**（find 改 `c.name === item.check`；passed 取 `found?.passed`，找不到视为未通过；说明取 `found?.detail`）：
```tsx
                    {[
                      { check: "no_unresolved_feedback", label: "无未解决反馈" },
                      { check: "ac_confirmed", label: "验收标准已确认" },
                      { check: "tech_verification_passed", label: "技术验证已通过" },
                      { check: "business_review_passed", label: "业务评审已通过" },
                      { check: "feedback_categorized", label: "反馈已分类" },
                      { check: "documents_complete", label: "文档已全部完成" },
                    ].map((item) => {
                      const found = archiveGate.checks.find((c) => c.name === item.check);
                      const passed = found?.passed ?? false;
                      return (
                        <div key={item.check} className="flex items-center gap-2 text-xs">
                          <span className={passed ? "text-emerald-600" : "text-destructive"}>
                            {passed ? "✓" : "✗"}
                          </span>
                          <span className={passed ? "text-foreground" : "text-destructive"}>
                            {item.label}
                          </span>
                          {!passed && found?.detail && (
                            <span className="text-muted-foreground text-[10px]">— {found.detail}</span>
                          )}
                        </div>
                      );
                    })}
```

#### B-3. 全文 grep 清残留

替换完成后，对 `page.tsx` 全文 grep 以下三个 token，确认无残留：
- `failed_checks`（应为 0 处）
- `.check`（门禁项的对象字段；注意 `item.check` 是本地常量对象的 key，**保留**，不要误删——它指的是渲染清单里的 `{ check: ... }`。需清除的是 `c.check`、`failed?.check` 这类对 API 项的 `.check` 访问）
- `.message`（门禁项 `failed?.message` 应改成 `found?.detail`，确认无 `.message` 残留在门禁区）

> `ArchiveCheckItem` 仍被 import（24 行 `type ArchiveCheckItem`）。若改后该类型在本文件不再被直接引用，TS `noUnusedLocals` 可能告警——届时按需移除该 import 或保留（execute 阶段以 `tsc` 结果为准）。

---

## 接口定义（代码类任务必填）

### 常量定义
```tsx
const REQUIRED_DOCS = ["proposal", "design", "requirements", "tasks"] as const;
const OPTIONAL_DOCS = [
  "plan",
  "verify_result",
  "module_impact",
  "MASTER",
  "prototypes",
  "references",
] as const;
```

### 复用辅助：单文档存在判定
组件内 `docExistsMap`（317 行已有：`new Map(matrix?.documents.map((d) => [d.doc_type, d]) ?? [])`）保持不变。新增一个就近的内联辅助以减少重复（放在 `docExistsMap` 声明之后）：
```tsx
const docExists = (docType: string): boolean => docExistsMap.get(docType)?.exists ?? false;
```
> `docExists` 对 prototypes/references 不适用（它们走 `matrix.prototypes/references.length`），但这两项只出现在 `OPTIONAL_DOCS` 的 isSpecial 分支，已单独处理，不经过 `docExists`。

### 完整度计数表达式（X/4）
```tsx
REQUIRED_DOCS.filter((dt) => docExists(dt)).length   // 分子 X
REQUIRED_DOCS.length                                  // 分母固定 4
```

### 门禁单项渲染表达式
```tsx
const found = archiveGate.checks.find((c) => c.name === item.check); // ArchiveCheckItem | undefined
const passed = found?.passed ?? false;                               // 找不到 ⇒ 视为未通过
// 说明文案：found?.detail
```

### 门禁 badge 计数表达式
```tsx
archiveGate.checks.filter((c) => !c.passed).length   // 未通过项数
```

### 依赖的 task-02 契约（本任务消费，不定义）
```ts
interface ArchiveCheckItem { name: string; passed: boolean; detail: string }
interface ArchiveGateResponse { can_archive: boolean; checks: ArchiveCheckItem[] }
```

---

## 边界处理（必填，≥5 条）

1. **`matrix` 为 null/undefined**：`docExistsMap` 已用 `matrix?.documents.map(...) ?? []` 兜底为空 Map；`docExists(dt)` 返回 `false`；必需组全部标红显示 0/4，可选组全部灰显。`matrix?.prototypes.length ?? 0`、`matrix?.references.length ?? 0` 已带 `?? 0`，不会抛错。
2. **`checks` 缺某项 name**（后端漏返回某检查项）：`archiveGate.checks.find((c) => c.name === item.check)` 返回 `undefined`，`found?.passed ?? false` 判为未通过（✗），不取 detail，不渲染说明文案，不抛错。这是保守安全的默认（缺项当作未通过，宁严勿松）。
3. **prototypes/references 是数组计数**：可选组中这两项走 `matrix?.prototypes.length`/`matrix?.references.length`，`> 0` 显示 ◐（amber）并附数量徽标，`=== 0` 显示灰显 —；它们**不调用** `docExists`，也**不进入** `REQUIRED_DOCS` 分母。
4. **DOC_TABS 内容加载不受影响**：Tab 切换区（669-708 行）与内容渲染区（709-745 行）仍遍历 `DOC_TABS`，`handleDocSelect`/`activeDoc`/`docContent` 逻辑一行不改；完整度计数口径变化与 Tab 区完全解耦。
5. **`archiveGate` 为 null 时不渲染门禁明细**：外层 `change.current_stage === "accepted"` 才挂载 section，且 badge 与 6 项列表均在 `archiveGate &&` / `archiveGate ?` 守卫内，null 时显示"加载归档检查…"占位，不访问 `.checks`，无 NPE。
6. **grep 清干净 `failed_checks` 残留**：替换后全文 `failed_checks` 必须 0 处；门禁区对 API 项的 `c.check`/`.message` 访问全部改为 `c.name`/`.detail`；保留渲染清单本地对象的 `item.check`（那是本地 key，非 API 字段）。
7. **`ArchiveCheckItem` import 未使用告警**：若改后本文件不再直接引用该类型，`tsc`（`noUnusedLocals`）可能报错；execute 阶段据 `tsc` 输出决定移除或保留 import，不擅自预删。
8. **`DOC_LABELS` 覆盖**：`REQUIRED_DOCS`/`OPTIONAL_DOCS` 每个 key 在 `DOC_LABELS`（120-131 行）均有映射；缺失时 `DOC_LABELS[dt] ?? \`${dt}.md\`` 兜底，不渲染 undefined。

---

## 非目标

- 不改 `frontend/src/lib/changes.ts`（类型契约由 task-02 负责）。
- 不改后端 `service.py` 归档门禁逻辑与 6 项检查的 name 集合。
- 不改 `DOC_TABS` 本身，不改 Tab 切换区、文档内容加载、`handleDocSelect`。
- 不为 `ChangeDocument.status` 补任何前端读取逻辑。
- 不新增组件、不抽公共组件、不改样式系统；仅就地分组与字段对齐。
- 不动 prototypes/references 的数据来源（仍来自 `matrix`）。

---

## 参考

- `page.tsx` 既有 `docExistsMap` 用法（317 行）：`const docExistsMap = new Map(matrix?.documents.map((d) => [d.doc_type, d]) ?? []);` —— 本任务的 `docExists` 辅助与必需组计数复用它。
- `design.md` §"前端完整度卡片（问题 4）"、§"前端归档门禁契约对齐（问题 3 连带）"（约 31-37、55-59 行）。
- `plan.md` task-04 行（27 行）与全局验收标准（43-47 行）。
- task-02 提供的 `changes.ts` 契约：`ArchiveGateResponse { can_archive, checks: ArchiveCheckItem[] }`、`ArchiveCheckItem { name, passed, detail }`。

---

## TDD 步骤

> 前端无单元测试框架接入，以类型检查 + 手动验证为准。

1. **先确认契约就绪（红前置）**：确认 task-02 已落地 `changes.ts`——`ArchiveGateResponse.checks` 与 `ArchiveCheckItem.{name,passed,detail}` 存在。若未就绪，本任务被阻塞（depends_on: task-02）。
2. **改 A（完整度）**：加 `REQUIRED_DOCS`/`OPTIONAL_DOCS` 常量 + `docExists` 辅助；改标题计数为 X/4；卡片主体拆必需/可选两组。
3. **改 B（门禁）**：badge 计数改 `checks.filter(c=>!c.passed).length`；6 项 map 的 find 改 `c.name === item.check`、passed 取 `found?.passed ?? false`、说明取 `found?.detail`。
4. **grep 清残留**：`failed_checks` / API 项 `.check` / 门禁 `.message` 全部为 0 处（保留本地 `item.check`）。
5. **类型验证（绿）**：在 `frontend/` 下执行
   ```bash
   cd frontend && npx tsc --noEmit
   ```
   要求 **0 错误**。若报 `ArchiveCheckItem` 未使用，按边界 7 处理。
6. **手动验证路径**（dev 或本地 Docker 起前端后）：
   - 路径 a（完整度 X/4）：打开仅含四件套的变更详情页 → "变更文档完整性"标题显示 `4/4 必需文档就绪`；必需组四件套全绿。
   - 路径 b（可选不进分母）：打开缺 `plan`/`verify_result` 但四件套齐全的变更 → 仍显示 `4/4`；可选组对应项灰显 —，prototypes/references 有文件时显 ◐ + 数量。
   - 路径 c（缺必需标红）：构造缺 `tasks` 的变更 → 标题 `3/4`，必需组 `tasks.md` 标红 ✗。
   - 路径 d（门禁渲染）：把某变更推进到 `accepted` → 归档门禁自动加载，6 项检查按后端 `checks` 渲染 ✓/✗；未通过项 badge 显示"N 项未通过"，未通过行尾显示 `detail` 文案。
   - 路径 e（全通过）：6 项 passed 全 true → badge "✅ 全部通过"，"确认归档"按钮可点。

---

## 验收标准

| # | 验收项 | 验证方式 | 期望结果 |
|---|---|---|---|
| AC-1 | 完整度分母为四件套 | 打开仅四件套齐全的变更详情页 | 标题显示 `4/4 必需文档就绪`，必需组四项全绿 ✓ |
| AC-2 | 可选/阶段性文档缺失不影响计数 | 打开缺 plan/verify_result 但四件套齐全的变更 | 标题仍 `4/4`；可选组对应项灰显 —，不改变分子/分母 |
| AC-3 | 必需文档缺失标红并扣减 | 构造缺 tasks 的变更 | 标题 `3/4`；必需组 `tasks.md` 为红色 ✗ |
| AC-4 | prototypes/references 按数组计数 | 变更含 ≥1 个 prototype 文件 | 可选组 prototypes 显示 ◐(amber) + 数量徽标，且不进分母 |
| AC-5 | 归档门禁 6 项正确渲染 | 变更进入 accepted 阶段加载门禁 | 6 项按后端 `checks` 的 `name`/`passed`/`detail` 渲染 ✓/✗，未通过行尾显示 detail |
| AC-6 | badge 未通过计数正确 | 后端返回部分 passed=false | badge 显示 `N 项未通过`，N === `checks.filter(c=>!c.passed).length`；全通过时显示"✅ 全部通过" |
| AC-7 | grep 残留清空 | 全文 grep `failed_checks` 及门禁区 `.check`/`.message`（API 字段） | 0 处残留（保留本地 `item.check`） |
| AC-8 | 类型检查通过 | `cd frontend && npx tsc --noEmit` | 0 错误 |
| AC-9 | DOC_TABS 与内容加载不受影响 | 在详情页逐个点击 10 个 Tab | 切换与内容加载行为与改前一致，无回归 |
