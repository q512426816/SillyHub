# QA 修复第一轮 — 6个问题

## 重要：环境已准备
- Worktree 已创建在 `.sillyspec/.runtime/worktrees/qa-fix-round1/`
- gate-status.json 已设置 stage=quick
- 所有代码修改**必须在 worktree 内进行**：`cd .sillyspec/.runtime/worktrees/qa-fix-round1`
- 修改完成后在 worktree 内 `git add -A && git commit`

---

## Fix 1: Change 文档生成失败（P0）

**文件**: `frontend/src/lib/change-writer.ts` 和 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`

**根因**: 前端 `generateDocs()` 调 `/documents/generate`，发送 `{doc_types: string[]}`，但后端期望 `{doc_type: str, content: str}`。后端有 `/documents/batch-generate` 接受 `{doc_types: string[]}`。

**修复**: 
1. 在 `change-writer.ts` 中，找到调用 `/documents/generate` 的 `generateDocs` 函数
2. 改为调用 `batchGenerateDocuments()`（该函数已存在，调 `/documents/batch-generate`）
3. 或者直接改 `generateDocs` 的路径从 `/documents/generate` 到 `/documents/batch-generate`
4. 检查调用 `generateDocs` 的页面（changes详情页），确认参数传递正确

---

## Fix 2: Change 状态流转不持久化（P0）

**文件**: `backend/app/modules/change/service.py`

**根因**: `_apply_parsed()` 第415行 `row.status = parsed.status` 无条件用文件 frontmatter 的 status 覆盖 DB。workflow transition 更新 DB 但不回写文件，下次 reparse 把 DB 状态覆盖回 draft。

**修复**:
1. 在 `_apply_parsed()` 方法中，删除或条件化 `row.status = parsed.status`
2. 推荐：以 DB 为 source of truth，**永远不从文件覆盖 status**
3. 改为：`if row.status == "draft" and parsed.status == "draft": row.status = parsed.status`（即仅在初始态同步）
4. 或者直接删除 `row.status = parsed.status` 这一行

---

## Fix 3: Release draft 后无法继续部署（P1）

### 后端
**文件**: `backend/app/modules/release/router.py` 和 `backend/app/modules/release/service.py`

**根因**: service 有 `promote_to_staging()` 方法但 router 没暴露路由。

**修复**: 在 router.py 添加路由：
```python
@router.post(
    "/releases/{release_id}/promote",
    response_model=ReleaseRead,  # 看实际的 response model 名称
)
async def promote_release(
    release_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> ...:
    svc = ReleaseService(session)
    release = await svc.promote_to_staging(release_id)
    return ...model_validate(release)
```

### 前端
**文件**: `frontend/src/lib/releases.ts` 和 `frontend/src/app/(dashboard)/workspaces/[id]/releases/page.tsx`

**修复**:
1. `releases.ts` 添加：
```typescript
export function promoteRelease(releaseId: string) {
  return apiFetch<Release>(`/api/releases/${releaseId}/promote`, { method: "POST" });
}
```
2. `page.tsx` 在操作列添加 draft 状态的按钮："提交到预发布"

---

## Fix 4: Git Identity 创建 503（P1）

**文件**: `backend/app/modules/git_identity/` 或 `backend/app/core/config.py`

**根因**: `SILLYSPEC_MASTER_KEY` 环境变量未设置。

**修复**: 在 `.env` 文件中添加默认值（开发环境用）：
```
SILLYSPEC_MASTER_KEY=dev-local-master-key-2026
```
或者在 git_identity service 中，dev 模式下使用默认 key。

---

## Fix 5: Workspace 扫描结果显示矛盾（P1）

**文件**: 检查 `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` 或 workspace 相关页面

**根因**: 前端展示已废弃的 `scan.sillyspec_path` 字段，实际后端不返回。

**修复**: 找到显示 "已检测到 .sillyspec" 和 "未找到" 的代码，改用正确的字段。后端 ScanResponse 返回 `has_sillyspec_dir`、`has_changes_dir` 等布尔字段，用这些判断。

---

## Fix 6: Change 详情页错误态覆盖（P1）

**文件**: `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`

**根因**: 页面在 `pageError || !change` 时返回整页错误，丢失详情上下文。

**修复**: 当 change 数据存在时，即使有操作错误也继续渲染主体内容，在顶部显示错误 banner。

---

## 验证步骤

修改完成后在 worktree 目录内执行：
1. `cd frontend && npx next build` — 前端无类型错误
2. `cd backend && python -m pytest --tb=short -q` — 后端测试通过
3. `git add -A && git commit -m "fix: QA round 1 — 6 issues from test report"`
