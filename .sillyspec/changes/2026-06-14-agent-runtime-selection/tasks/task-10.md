---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-10
title: workspace 设置页 — 默认 Agent 下拉 + 保存
priority: P0
estimated_hours: 2
depends_on: [task-08, task-09]
blocks: [task-14]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
---

# task-10: workspace 设置页 — 默认 Agent 下拉 + 保存

## 上下文
workspace 详情页（`[id]/page.tsx`）当前无编辑表单。加"默认 Agent"区块，让所有者配置 `default_agent`（FR-07）。依赖 task-08（updateWorkspace）+ task-09（AgentProviderSelect）。

## 修改文件（必填）
- `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`

## 实现要求
1. 在详情页加一个"默认 Agent"区块（对齐现有 Spec Workspace 管理区域的卡片风格）：
   - 本地 state `const [defaultAgent, setDefaultAgent] = useState<string|null>(workspace.default_agent)`，初始化自 props/加载的 workspace。
   - `<AgentProviderSelect value={defaultAgent} onChange={setDefaultAgent} includeDefault />`
   - "保存"按钮 → `handleSaveDefaultAgent`。
2. **`handleSaveDefaultAgent`**：
   ```typescript
   const [saving, setSaving] = useState(false);
   const [saveMsg, setSaveMsg] = useState<string | null>(null);
   const handleSaveDefaultAgent = async () => {
     setSaving(true); setSaveMsg(null);
     try {
       const updated = await updateWorkspace(workspace.id, { default_agent: defaultAgent });
       setWorkspace(updated);  // 同步刷新
       setSaveMsg("已保存");
     } catch (err) {
       setSaveMsg(err instanceof ApiError ? err.message : "保存失败");
     } finally { setSaving(false); }
   };
   ```
3. 保存成功后用返回的 `updated` 同步本地 workspace 状态（重新打开显示已选值）。

## 接口定义（代码类任务必填）
```tsx
const [defaultAgent, setDefaultAgent] = useState<string | null>(workspace.default_agent);
// JSX
<section>
  <h3>默认 Agent</h3>
  <AgentProviderSelect value={defaultAgent} onChange={setDefaultAgent} includeDefault />
  <Button onClick={handleSaveDefaultAgent} disabled={saving}>保存</Button>
  {saveMsg && <span>{saveMsg}</span>}
</section>
```

## 边界处理（必填）
- **default_agent 初始 null**：下拉显示"未设置"。
- **选"未设置"保存**：`updateWorkspace(id, {default_agent: null})` → 后端清空 NULL（FR-01）。
- **选某 provider 保存**：`{default_agent: "claude"}` → 后端更新。
- **保存失败**：ApiError 显示 message，不崩。
- **重复保存/未改动**：允许（幂等 PATCH）。
- **页面加载后 workspace 更新**：用 updated 返回值同步，避免脏读。

## 非目标（本任务不做的事）
- 不做完整 workspace 编辑表单（name/slug 等）——只 default_agent。
- 不改后端（task-04）。
- 不改其他 workspace 字段。

## 参考
- 现有详情页结构（`[id]/page.tsx` 的 Spec Workspace 管理区域卡片风格）。
- `updateWorkspace`（task-08）、`AgentProviderSelect`（task-09）。
- 既有 ApiError 错误处理模式（tasks 面板）。

## TDD 步骤
1. typecheck：`cd frontend && pnpm typecheck`。
2. 手动验收：选 claude → 保存 → 刷新页面仍显示 claude（对照 FR-07）；选"未设置" → 保存 → 显示未设置。
3. `cd frontend && pnpm build` 通过。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 选 provider + 保存 | PATCH 成功，GET 返回该 provider |
| AC-02 | 重新打开页面 | 显示已保存的 default_agent（对照 FR-07） |
| AC-03 | 选"未设置" + 保存 | default_agent 清空为 null |
| AC-04 | 保存失败 | 显示错误信息，不崩 |
| AC-05 | pnpm typecheck + build | 通过 |
