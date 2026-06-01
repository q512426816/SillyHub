---
id: task-06
title: Frontend详情页工作流UI — 阶段流转按钮+反馈表单+归档门禁
priority: P0
estimated_hours: 3
depends_on:
  - task-05
blocks:
  - task-08
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
---

# task-06: Frontend 详情页工作流 UI

## 背景

本任务在 task-05（`changes.ts` 新增 `transitionChange` / `submitFeedback` / `checkArchiveGate` 三个 API 函数）的基础上，重构变更详情页的工作流 UI。当前页面使用旧状态模型（`draft / proposed / reviewed / approved / in_progress / completed / merged / rejected`）和旧的 6 阶段进度条（`scan / brainstorm / plan / execute / verify / archived`），需要替换为 design.md §1 定义的 10 阶段线性状态机 UI。

核心变更：
- **替换**旧的 `STAGES`、`STAGE_LABELS`、`TRANSITIONS` 常量为新的 10 阶段工作流常量
- **替换**固定显示的 "🚀 启动执行" 按钮为根据当前 `current_stage` 动态渲染的工作流流转按钮
- **新增**反馈表单面板（`business_review` / `technical_verification` 阶段可用），包含 A/B/C/D 类别下拉 + 文本输入
- **新增**归档门禁面板（`accepted` 阶段可用），显示 6 项检查的通过/失败状态
- **更新**数据源：从 `@/lib/changes` 导入 task-05 新增的 API 函数

## 修改文件

| 操作 | 文件路径 |
|------|----------|
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` — 替换旧常量、替换按钮逻辑、新增反馈表单、新增归档门禁面板 |

> 注意：`@/lib/changes.ts` 中的 API 函数由 task-05 添加，本任务仅负责消费。

## 实现要求

### 1. 替换旧常量 — 新增 10 阶段工作流常量

删除文件顶部的旧常量：

```typescript
// ── 删除以下旧常量 ──────────────────────────────────────────────
// const STAGES = ["scan", "brainstorm", "plan", "execute", "verify", "archived"] as const;
// const STAGE_LABELS = { scan: "扫描", brainstorm: "构思", ... };
// const TRANSITIONS = { draft: [{ target: "proposed", ... }], ... };
```

替换为新的 10 阶段常量：

```typescript
// ── Workflow Stages (task-06) ──────────────────────────────────────

const WORKFLOW_STAGES = [
  "draft",
  "clarifying",
  "design_review",
  "ready_for_dev",
  "in_dev",
  "technical_verification",
  "business_review",
  "rework_required",
  "accepted",
  "archived",
] as const;

const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  draft: "草稿",
  clarifying: "需求澄清",
  design_review: "设计评审",
  ready_for_dev: "待开发",
  in_dev: "开发中",
  technical_verification: "技术验证",
  business_review: "业务验收",
  rework_required: "需返工",
  accepted: "已验收",
  archived: "已归档",
};

const WORKFLOW_STAGE_COLORS: Record<string, "success" | "outline" | "destructive" | "default" | "warning"> = {
  draft: "outline",
  clarifying: "warning",
  design_review: "warning",
  ready_for_dev: "default",
  in_dev: "default",
  technical_verification: "warning",
  business_review: "warning",
  rework_required: "destructive",
  accepted: "success",
  archived: "default",
};

// 每个阶段可用的流转按钮，按 design.md §3.1 TRANSITIONS 表定义
const WORKFLOW_TRANSITIONS: Record<
  string,
  { target: string; label: string; variant: "default" | "outline" | "destructive"; icon?: string }[]
> = {
  draft: [
    { target: "clarifying", label: "提交审核", variant: "default", icon: "📝" },
  ],
  clarifying: [
    { target: "design_review", label: "提交设计评审", variant: "default", icon: "🔍" },
  ],
  design_review: [
    { target: "ready_for_dev", label: "评审通过", variant: "default", icon: "✅" },
    { target: "clarifying", label: "退回澄清", variant: "destructive", icon: "↩️" },
  ],
  ready_for_dev: [
    { target: "in_dev", label: "开始开发", variant: "default", icon: "🚀" },
  ],
  in_dev: [
    { target: "technical_verification", label: "提交自测", variant: "default", icon: "🧪" },
  ],
  technical_verification: [
    { target: "business_review", label: "提交验收", variant: "default", icon: "📋" },
    { target: "rework_required", label: "退回返工", variant: "destructive", icon: "⚠️" },
  ],
  business_review: [
    { target: "accepted", label: "验收通过", variant: "default", icon: "✅" },
    { target: "rework_required", label: "退回返工", variant: "destructive", icon: "⚠️" },
  ],
  rework_required: [
    { target: "clarifying", label: "返回澄清", variant: "outline", icon: "↩️" },
    { target: "design_review", label: "返回设计评审", variant: "outline", icon: "↩️" },
    { target: "in_dev", label: "返回开发", variant: "outline", icon: "↩️" },
  ],
  accepted: [
    { target: "archived", label: "归档", variant: "default", icon: "📦" },
  ],
  archived: [], // 终态，无可用流转
};
```

### 2. 更新 import 语句

在文件顶部的 import 区域，从 `@/lib/changes` 追加 task-05 新增的 API 函数：

```typescript
import {
  // ... 现有 imports 保持不变 ...
  transitionChange,     // 已有，从 @/lib/workflow 导入（task-05 迁移到 changes.ts 后改路径）
  submitFeedback,       // 新增 — task-05 在 changes.ts 中添加
  checkArchiveGate,     // 新增 — task-05 在 changes.ts 中添加
} from "@/lib/changes";
```

> **注意**：如果 task-05 将 `transitionChange` 仍在 `@/lib/workflow` 中，则保持从 `@/lib/workflow` 导入 `transitionChange`，仅从 `@/lib/changes` 导入新增的 `submitFeedback` 和 `checkArchiveGate`。同时保留 `submitReview`、`listReviews` 等现有 workflow 函数的导入。

追加新的类型导入：

```typescript
// 归档门禁检查项类型（与 task-05 定义保持一致）
type ArchiveCheckItem = {
  name: string;
  passed: boolean;
  detail: string;
};

type ArchiveGateResult = {
  can_archive: boolean;
  checks: ArchiveCheckItem[];
};
```

### 3. 新增 state 变量

在组件函数内的现有 state 声明区域追加：

```typescript
// ── Feedback form state (task-06) ──────────────────────────────────
const [feedbackCategory, setFeedbackCategory] = useState<string>("");
const [feedbackText, setFeedbackText] = useState("");
const [submittingFeedback, setSubmittingFeedback] = useState(false);

// ── Archive gate state (task-06) ───────────────────────────────────
const [archiveGate, setArchiveGate] = useState<ArchiveGateResult | null>(null);
const [loadingArchiveGate, setLoadingArchiveGate] = useState(false);
const [archiving, setArchiving] = useState(false);
```

### 4. 替换阶段进度条

将现有的 6 阶段进度条（第 322–365 行）替换为 10 阶段进度条。使用新的 `WORKFLOW_STAGES` 和 `WORKFLOW_STAGE_LABELS`：

```tsx
{change.current_stage && (() => {
  const currentIndex = WORKFLOW_STAGES.indexOf(
    change.current_stage as (typeof WORKFLOW_STAGES)[number],
  );
  if (currentIndex < 0) return null;
  const stagesObj = change.stages as Record<string, { lastActive?: string }> | null;
  const lastActive = stagesObj?.[change.current_stage]?.lastActive ?? change.updated_at;

  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        {WORKFLOW_STAGES.map((stage, i) => {
          const isCompleted = currentIndex > i;
          const isCurrent = currentIndex === i;
          // 不显示归档后的已完成态圆点文字，保持简洁
          return (
            <div key={stage} className="flex items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium ${
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : isCompleted
                      ? "bg-emerald-500 text-white"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {isCompleted ? "✓" : i + 1}
              </div>
              <span
                className={`ml-1 text-[11px] ${
                  isCurrent ? "text-foreground font-medium" : "text-muted-foreground"
                }`}
              >
                {WORKFLOW_STAGE_LABELS[stage]}
              </span>
              {i < WORKFLOW_STAGES.length - 1 && (
                <div className="mx-1 h-px w-3 bg-border" />
              )}
            </div>
          );
        })}
      </div>
      {lastActive && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          当前阶段: {WORKFLOW_STAGE_LABELS[change.current_stage] ?? change.current_stage}
          {" · "}最后活跃: {new Date(lastActive).toLocaleString()}
        </p>
      )}
    </div>
  );
})()}
```

### 5. 替换流转按钮区域

**删除** header 中的固定 "🚀 启动执行" 按钮（第 304–312 行）。

**替换**现有的流转按钮区域（第 367–385 行）为基于 `current_stage` 的动态按钮：

```tsx
{(() => {
  const stage = change.current_stage ?? "draft";
  const availableTransitions = WORKFLOW_TRANSITIONS[stage] ?? [];
  if (availableTransitions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/workspaces/${workspaceId}/changes/${changeId}/tasks`}
        className="inline-flex h-7 items-center rounded bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        任务看板
      </Link>
      {availableTransitions.map((t) => (
        <Button
          key={t.target}
          variant={t.variant}
          size="sm"
          onClick={() => void handleTransition(t.target)}
          disabled={transitioning}
        >
          {t.icon && <span className="mr-1">{t.icon}</span>}
          {t.label}
        </Button>
      ))}
    </div>
  );
})()}
```

> **注意**：旧的 `handleTransition` 函数已经调用 `transitionChange(workspaceId, changeId, targetStatus)`，逻辑基本不变，但需要更新返回值处理——`setChange` 时更新 `current_stage` 而非 `status`：

```typescript
const handleTransition = async (targetStage: string) => {
  if (!change) return;
  setTransitioning(true);
  setPageError(null);
  try {
    const result = await transitionChange(workspaceId, changeId, targetStage);
    setChange({ ...change, current_stage: targetStage, status: result.status ?? change.status });
    // 如果流转到 accepted，清除归档门禁缓存以触发重新检查
    if (targetStage === "accepted") {
      setArchiveGate(null);
    }
  } catch (err) {
    if (err instanceof ApiError) {
      const violations = (err.details as { violations?: string[] })?.violations;
      setPageError(violations ? violations.join("；") : err.message);
    } else {
      setPageError("状态转移失败");
    }
  } finally {
    setTransitioning(false);
  }
};
```

### 6. 新增反馈表单面板

在右侧边栏（`<aside>` 区域）的审查记录 section 之后，追加反馈表单。仅在 `current_stage` 为 `business_review` 或 `technical_verification` 时显示：

```tsx
{(change.current_stage === "business_review" || change.current_stage === "technical_verification") && (
  <section className="rounded-md border bg-card p-3">
    <h3 className="mb-2 text-xs font-medium">提交反馈（返工）</h3>
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-[11px] text-muted-foreground">反馈类别</label>
        <select
          className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
          value={feedbackCategory}
          onChange={(e) => setFeedbackCategory(e.target.value)}
        >
          <option value="">— 选择类别 —</option>
          <option value="A">A — Bug / 快速修复</option>
          <option value="B">B — 需求理解错误（重设计）</option>
          <option value="C">C — 歧义 / 信息不足</option>
          <option value="D">D — 衍生新 change（当前通过）</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[11px] text-muted-foreground">反馈内容</label>
        <textarea
          className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
          rows={3}
          placeholder="描述具体问题…"
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          maxLength={2000}
        />
      </div>
      <Button
        size="sm"
        variant="destructive"
        disabled={submittingFeedback || !feedbackCategory || !feedbackText.trim()}
        onClick={() => void handleSubmitFeedback()}
      >
        {submittingFeedback ? "提交中…" : "提交反馈并退回"}
      </Button>
    </div>
  </section>
)}
```

新增反馈提交 handler：

```typescript
const handleSubmitFeedback = async () => {
  if (!change || !feedbackCategory || !feedbackText.trim()) return;
  setSubmittingFeedback(true);
  setPageError(null);
  try {
    const result = await submitFeedback(
      workspaceId,
      changeId,
      feedbackCategory,
      feedbackText.trim(),
    );
    // 更新本地状态：根据返回结果更新 stage 和反馈字段
    setChange({
      ...change,
      current_stage: result.current_stage ?? change.current_stage,
      status: result.status ?? change.status,
    });
    setFeedbackCategory("");
    setFeedbackText("");
    setSuccessMsg("✅ 反馈已提交");
    setTimeout(() => setSuccessMsg(null), 3000);
  } catch (err) {
    setPageError(err instanceof ApiError ? err.message : "提交反馈失败");
  } finally {
    setSubmittingFeedback(false);
  }
};
```

### 7. 新增归档门禁面板

在右侧边栏追加归档门禁面板，仅在 `current_stage === "accepted"` 时显示。加载时自动调用 `checkArchiveGate`：

```tsx
{change.current_stage === "accepted" && (
  <ArchiveGatePanel
    workspaceId={workspaceId}
    changeId={changeId}
    archiveGate={archiveGate}
    loading={loadingArchiveGate}
    archiving={archiving}
    onLoadGate={() => void loadArchiveGate()}
    onArchive={() => void handleArchive()}
  />
)}
```

**面板实现（可内联或提取为组件函数）**：

```typescript
// 归档门禁检查项中文名映射
const CHECK_LABELS: Record<string, string> = {
  no_unresolved_feedback: "无未解决反馈",
  ac_confirmed: "验收标准已确认",
  tech_verification_passed: "技术验证已通过",
  business_review_passed: "业务评审已通过",
  feedback_categorized: "反馈已分类",
  documents_complete: "文档已全部完成",
};
```

```tsx
{/* 归档门禁面板 — 内联于 aside 中 */}
{change.current_stage === "accepted" && (() => {
  // 懒加载归档门禁数据
  if (!archiveGate && !loadingArchiveGate) {
    // 首次渲染 accepted 阶段时触发加载（通过 useEffect，见下方）
  }

  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-xs font-medium">归档门禁</h2>
        {archiveGate && (
          <Badge variant={archiveGate.can_archive ? "success" : "destructive"}>
            {archiveGate.can_archive ? "✅ 全部通过" : `${archiveGate.checks.filter((c) => !c.passed).length} 项未通过`}
          </Badge>
        )}
      </div>
      <div className="px-3 py-2 space-y-2">
        {loadingArchiveGate ? (
          <p className="text-xs text-muted-foreground">检查中…</p>
        ) : archiveGate ? (
          <>
            {archiveGate.checks.map((check) => (
              <div key={check.name} className="flex items-center gap-2 text-xs">
                <span className={check.passed ? "text-emerald-600" : "text-destructive"}>
                  {check.passed ? "✓" : "✗"}
                </span>
                <span className={check.passed ? "text-foreground" : "text-destructive"}>
                  {CHECK_LABELS[check.name] ?? check.name}
                </span>
                {!check.passed && check.detail && (
                  <span className="text-muted-foreground text-[10px]">— {check.detail}</span>
                )}
              </div>
            ))}
            <div className="pt-2">
              <Button
                size="sm"
                disabled={!archiveGate.can_archive || archiving}
                onClick={() => void handleArchive()}
              >
                {archiving ? "归档中…" : "📦 确认归档"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">加载归档检查…</p>
        )}
      </div>
    </section>
  );
})()}
```

新增归档相关 handler：

```typescript
// 加载归档门禁数据
const loadArchiveGate = async () => {
  setLoadingArchiveGate(true);
  try {
    const result = await checkArchiveGate(workspaceId, changeId);
    setArchiveGate(result);
  } catch (err) {
    setPageError(err instanceof ApiError ? err.message : "加载归档检查失败");
  } finally {
    setLoadingArchiveGate(false);
  }
};

// 执行归档
const handleArchive = async () => {
  if (!change) return;
  setArchiving(true);
  setPageError(null);
  try {
    await handleTransition("archived");
    setSuccessMsg("📦 变更已归档");
    setTimeout(() => setSuccessMsg(null), 3000);
  } catch (err) {
    setPageError(err instanceof ApiError ? err.message : "归档失败");
  } finally {
    setArchiving(false);
  }
};
```

新增 useEffect 监听 `accepted` 阶段自动加载归档门禁：

```typescript
useEffect(() => {
  if (change?.current_stage === "accepted" && !archiveGate && !loadingArchiveGate) {
    void loadArchiveGate();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [change?.current_stage]);
```

### 8. 更新 header 中的 Badge

将 header 中显示旧 `status` badge 的逻辑改为显示 `current_stage` badge：

```tsx
{/* 旧：*/}
<Badge variant={STATUS_COLORS[change.status] ?? "outline"}>
  {STATUS_LABELS[change.status] ?? change.status}
</Badge>

{/* 新：*/}
<Badge variant={WORKFLOW_STAGE_COLORS[change.current_stage ?? "draft"] ?? "outline"}>
  {WORKFLOW_STAGE_LABELS[change.current_stage ?? "draft"] ?? change.current_stage ?? "未知"}
</Badge>
```

### 9. 清理旧代码

以下旧代码/常量在任务完成后应删除（或注释掉），因为已被新常量替代：

- 旧 `STAGES` 常量（`scan / brainstorm / plan / execute / verify / archived`）
- 旧 `STAGE_LABELS` 常量
- 旧 `TRANSITIONS` 常量（`draft → proposed` 等）
- 旧 `STATUS_COLORS` 中与新阶段无关的条目（可选保留，用于其他场景）
- 旧 `STATUS_LABELS` 中与新阶段无关的条目（可选保留）
- `handleExecute` 函数 — 保留但更新调用逻辑，仅当 `current_stage === "ready_for_dev"` 时显示执行按钮

> `handleExecute` 保留用于 `ready_for_dev → in_dev` 的 Agent 启动场景。可在 `WORKFLOW_TRANSITIONS.ready_for_dev` 按钮旁追加一个 "🚀 启动执行" 按钮（调用 `handleExecute`）。

## 接口定义

### 使用的 API 函数（由 task-05 提供）

```typescript
// 从 @/lib/changes 导入（task-05 新增）

/** 状态流转 — POST /workspaces/{id}/changes/{cid}/transition */
transitionChange(
  workspaceId: string,
  changeId: string,
  targetStage: string,
): Promise<{ id: string; status: string; current_stage: string }>;

/** 提交反馈 — POST /workspaces/{id}/changes/{cid}/feedback */
submitFeedback(
  workspaceId: string,
  changeId: string,
  category: string,   // "A" | "B" | "C" | "D"
  text: string,
  targetStage?: string, // 可选覆盖返工目标
): Promise<{ id: string; status: string; current_stage: string }>;

/** 归档门禁检查 — GET /workspaces/{id}/changes/{cid}/archive-gate */
checkArchiveGate(
  workspaceId: string,
  changeId: string,
): Promise<{ can_archive: boolean; checks: ArchiveCheckItem[] }>;
```

### 本地类型

```typescript
type ArchiveCheckItem = {
  name: string;
  passed: boolean;
  detail: string;
};
```

## 边界处理

1. **`current_stage` 为 null 或 undefined**：视为 `draft`（新建 change 未设置 stage）。所有使用 `change.current_stage` 的位置统一使用 `change.current_stage ?? "draft"`，包括 `WORKFLOW_TRANSITIONS` 查找和 `WORKFLOW_STAGES.indexOf`。

2. **`WORKFLOW_TRANSITIONS` 中无匹配的 `current_stage`**：如果后端返回了一个前端未知的阶段值（如新增了阶段但前端未同步），`WORKFLOW_TRANSITIONS[stage]` 返回 `undefined`，此时 `availableTransitions` 默认为 `[]`，不渲染任何流转按钮，也不报错。用户看到的是一个无操作按钮的详情页。

3. **反馈提交时 category 或 text 为空**：按钮 `disabled` 条件为 `!feedbackCategory || !feedbackText.trim()`，确保不会发送无效请求。清除输入框时使用 `setFeedbackCategory("")` 和 `setFeedbackText("")`。

4. **归档门禁在非 `accepted` 阶段调用**：面板仅在 `current_stage === "accepted"` 时渲染，从 UI 层杜绝非预期调用。但 `loadArchiveGate` 函数本身不做阶段校验，如果未来需要在其他阶段预览归档状态，可扩展。

5. **归档门禁 API 调用失败**：`loadArchiveGate` catch 中设置 `pageError`，面板显示错误提示而非无限 loading。`archiveGate` 保持为 `null`，用户可刷新页面重试。

6. **并发操作冲突**：用户快速连续点击多个流转按钮时，`transitioning` state 锁定所有按钮（`disabled={transitioning}`），防止重复提交。反馈提交使用独立的 `submittingFeedback` 锁。归档使用 `archiving` 锁。

7. **流转后 `change` 状态同步**：`handleTransition` 成功后更新 `setChange({ ...change, current_stage: targetStage })`，确保进度条和按钮立即反映新状态，无需重新请求完整数据。但如果后端返回额外变更字段（如 `feedback_category` 被清空），应优先使用后端返回值。推荐做法：流转成功后调用 `getChange` 刷新完整数据。

8. **`rework_required` 阶段的流转按钮**：根据 design.md §3.1，`rework_required` 可退回 `clarifying` / `design_review` / `in_dev`。前端展示所有三个按钮，实际退回目标由后端根据 `feedback_category` 校验。如果用户选择的退回目标与反馈类别不匹配，后端应拒绝（由 task-03 保证）。

9. **归档门禁懒加载**：仅当用户第一次进入 `accepted` 阶段时触发 `checkArchiveGate` 调用，避免在每次页面加载时都请求归档数据。使用 `archiveGate === null` 判断是否需要加载。切换到其他阶段再切回 `accepted` 时，需要重新加载（在 `handleTransition` 成功后设置 `setArchiveGate(null)` 清除缓存）。

10. **旧 `handleExecute` 与新流转按钮共存**：`ready_for_dev` 阶段同时显示 "开始开发"（调用 `transitionChange` 推到 `in_dev`）和 "🚀 启动执行"（调用 `executeChange` 启动 Agent）。两者逻辑不同：前者仅改状态，后者创建 AgentRun。建议保留 `handleExecute` 并在 `ready_for_dev` 的流转区域追加执行按钮。

## 非目标（本任务不做的事）

- **不修改** `frontend/src/lib/changes.ts` — API 函数由 task-05 添加
- **不修改** `frontend/src/lib/workflow.ts` — 保留现有函数，迁移由 task-05 负责
- **不修改** `frontend/src/components/StageBadge.tsx` — 独立的 Badge 组件由 task-07 负责
- **不修改** 列表页 `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` — 由 task-07 负责
- **不新增** 独立组件文件 — 受 `allowed_paths` 约束，所有变更在 `page.tsx` 中完成
- **不实现** WebSocket / SSE 实时状态推送 — 使用轮询或手动刷新，实时能力由后续迭代补充
- **不实现** 流转历史时间线 — stages JSON 中的 transitions 日志数据展示由后续迭代补充
- **不实现** 角色权限前端隐藏 — 当前不区分用户角色，所有按钮均可见；权限校验由后端保证
- **不重构** 文档 Tab 区域、审批状态区域等其他 section — 仅修改与工作流直接相关的 UI

## TDD 步骤

### 测试文件位置

前端组件测试：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page.test.tsx`

> 如果 `allowed_paths` 不允许创建测试文件，测试约定为手动验证（见验收标准）。

### Step 1 — 准备测试环境

确认 `vitest` / `@testing-library/react` 已配置。如未配置，本任务仅做手动验证。

### Step 2 — 编写测试用例

```typescript
// === 常量正确性 ===

describe("WORKFLOW_STAGES", () => {
  it("包含 10 个阶段", () => {
    expect(WORKFLOW_STAGES).toHaveLength(10);
  });

  it("首元素为 draft，末元素为 archived", () => {
    expect(WORKFLOW_STAGES[0]).toBe("draft");
    expect(WORKFLOW_STAGES[9]).toBe("archived");
  });
});

// === 流转按钮渲染 ===

describe("流转按钮", () => {
  it("draft 阶段显示 '提交审核' 按钮", async () => {
    // 模拟 change.current_stage = "draft"
    // 查找包含 "提交审核" 文字的 button
  });

  it("ready_for_dev 阶段显示 '开始开发' 按钮", async () => {
    // 模拟 change.current_stage = "ready_for_dev"
  });

  it("archived 阶段不显示任何流转按钮", async () => {
    // 模拟 change.current_stage = "archived"
    // 断言无 WORKFLOW_TRANSITIONS 按钮渲染
  });

  it("rework_required 阶段显示 3 个退回按钮", async () => {
    // 模拟 change.current_stage = "rework_required"
    // 断言 3 个按钮：返回澄清、返回设计评审、返回开发
  });
});

// === 反馈表单 ===

describe("反馈表单", () => {
  it("business_review 阶段显示反馈表单", async () => {
    // 模拟 change.current_stage = "business_review"
    // 断言 select 和 textarea 存在
  });

  it("draft 阶段不显示反馈表单", async () => {
    // 模拟 change.current_stage = "draft"
    // 断言反馈表单不存在
  });

  it("类别或内容为空时提交按钮 disabled", async () => {
    // 模拟 business_review 阶段
    // 断言按钮 disabled
    // 选择类别 A，输入文本后断言按钮 enabled
  });
});

// === 归档门禁 ===

describe("归档门禁面板", () => {
  it("accepted 阶段显示归档门禁面板", async () => {
    // 模拟 change.current_stage = "accepted"
    // 断言面板渲染
  });

  it("非 accepted 阶段不显示归档门禁面板", async () => {
    // 模拟 change.current_stage = "in_dev"
    // 断言面板不渲染
  });

  it("can_archive=false 时归档按钮 disabled", async () => {
    // 模拟 archiveGate = { can_archive: false, checks: [...] }
    // 断言归档按钮 disabled
  });

  it("can_archive=true 时归档按钮 enabled", async () => {
    // 模拟 archiveGate = { can_archive: true, checks: 全部 passed }
    // 断言归档按钮 enabled
  });

  it("显示 6 项检查结果", async () => {
    // 模拟 archiveGate 包含 6 项
    // 断言渲染 6 个检查行
  });
});

// === 阶段进度条 ===

describe("阶段进度条", () => {
  it("显示 10 个阶段节点", async () => {
    // 断言渲染 10 个圆点
  });

  it("当前阶段高亮", async () => {
    // 模拟 current_stage = "in_dev"（index 4）
    // 断言第 5 个节点有 bg-primary 样式
  });
});
```

### Step 3 — 手动验证流程

如测试环境不可用，按以下流程手动验证：

1. 创建一个新 change，确认 `current_stage = "draft"`
2. 点击 "提交审核"，确认 stage 变为 `clarifying`
3. 点击 "提交设计评审"，确认 stage 变为 `design_review`
4. 点击 "评审通过"，确认 stage 变为 `ready_for_dev`
5. 点击 "开始开发"，确认 stage 变为 `in_dev`
6. 点击 "提交自测"，确认 stage 变为 `technical_verification`
7. 在 technical_verification 阶段：点击 "提交验收" → `business_review`
8. 在 business_review 阶段：填写反馈（类别 A + 文本）→ 提交 → 确认进入 `rework_required`
9. 在 rework_required 阶段：点击 "返回开发" → `in_dev`
10. 重新走到 `accepted`，确认归档门禁面板显示 6 项检查
11. 确认全部通过后 "确认归档" 按钮可用，点击归档

### Step 4 — 构建验证

```bash
cd /Users/qinyi/SillyHub
cd frontend && npx next build
# 预期：构建成功，无 TypeScript 错误
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | 页面使用 `WORKFLOW_STAGES` 10 阶段常量 | 进度条显示 10 个节点：草稿 → 需求澄清 → 设计评审 → 待开发 → 开发中 → 技术验证 → 业务验收 → 需返工 → 已验收 → 已归档 |
| AC-02 | 旧 "🚀 启动执行" 按钮不再固定显示 | header 中无固定的启动执行按钮，`ready_for_dev` 阶段显示 "开始开发" 流转按钮 |
| AC-03 | `draft` 阶段显示 "提交审核" 按钮 | 点击后 stage 变为 `clarifying`，进度条更新 |
| AC-04 | `ready_for_dev` 阶段显示 "开始开发" 按钮 | 点击后 stage 变为 `in_dev` |
| AC-05 | `technical_verification` 阶段显示 "提交验收" 和 "退回返工" | 两个按钮正确渲染，variant 分别为 default 和 destructive |
| AC-06 | `business_review` 阶段显示 "验收通过" 和 "退回返工" | 两个按钮正确渲染 |
| AC-07 | `rework_required` 阶段显示 3 个退回按钮 | 返回澄清、返回设计评审、返回开发 |
| AC-08 | `archived` 阶段无流转按钮 | `WORKFLOW_TRANSITIONS.archived` 为空数组，不渲染按钮 |
| AC-09 | 反馈表单在 `business_review` 阶段可见 | 包含类别下拉（A/B/C/D）、文本域、提交按钮 |
| AC-10 | 反馈表单在 `technical_verification` 阶段可见 | 同 AC-09 |
| AC-11 | 反馈表单在其他阶段不可见 | `draft`、`in_dev` 等阶段不显示反馈表单 |
| AC-12 | 反馈类别或内容为空时提交按钮 disabled | 两者均有值后按钮 enabled |
| AC-13 | 提交反馈后 stage 更新 | 类别 A/B/C → `rework_required`，类别 D → `accepted` |
| AC-14 | 提交反馈后输入框清空 | `feedbackCategory` 和 `feedbackText` 重置为空 |
| AC-15 | 归档门禁面板在 `accepted` 阶段可见 | 显示 6 项检查的通过/失败状态 |
| AC-16 | 归档门禁面板在其他阶段不可见 | 非 `accepted` 阶段不渲染面板 |
| AC-17 | 归档门禁自动加载 | 进入 `accepted` 阶段时自动调用 `checkArchiveGate` API |
| AC-18 | 归档门禁 `can_archive=false` 时归档按钮 disabled | 显示未通过项数，按钮不可点击 |
| AC-19 | 归档门禁 `can_archive=true` 时归档按钮 enabled | 点击 "确认归档" 后 stage 变为 `archived` |
| AC-20 | 6 项检查项显示中文名称 | 使用 `CHECK_LABELS` 映射：无未解决反馈、验收标准已确认、技术验证已通过、业务评审已通过、反馈已分类、文档已全部完成 |
| AC-21 | 流转操作期间按钮全部 disabled | `transitioning` state 锁定所有流转按钮，防止重复提交 |
| AC-22 | `next build` 通过 | TypeScript 无类型错误，构建成功 |
| AC-23 | 现有功能不受影响 | 文档 Tab 切换、审批状态、审查记录、任务进度、影响组件等 section 正常工作 |
