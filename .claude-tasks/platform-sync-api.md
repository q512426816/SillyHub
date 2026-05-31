# SillyHub 平台对接 SillySpec CLI SQLite 迁移

## 背景

SillySpec CLI 已完成 SQLite 迁移（变更 `2026-05-31-sqlite-migration`），现在需要 SillyHub 平台侧实现对接。

CLI 的 `sync.js` 已经写好了 API 调用逻辑，平台必须提供以下 4 个 API 端点。
CLI 用 `changeName`（string slug）而非数字 ID 来路由。

## 任务清单

### Task 1: DB Migration — Change 表改造

文件：`backend/migrations/versions/` 新增迁移文件

在 `changes` 表新增以下字段：

```sql
ALTER TABLE changes ADD COLUMN current_stage VARCHAR DEFAULT NULL;
-- 值：scan/brainstorm/propose/plan/execute/verify/archived/quick

ALTER TABLE changes ADD COLUMN stages JSONB DEFAULT '{}';
-- 结构：{"brainstorm": {"status": "completed", "startedAt": "...", "completedAt": "...", "steps": [...]}, ...}

ALTER TABLE changes ADD COLUMN approval_status VARCHAR DEFAULT 'not_required';
-- 值：pending/approved/rejected/not_required

ALTER TABLE changes ADD COLUMN approved_by VARCHAR DEFAULT NULL;
ALTER TABLE changes ADD COLUMN approved_at TIMESTAMP DEFAULT NULL;
ALTER TABLE changes ADD COLUMN rejection_reason VARCHAR DEFAULT NULL;
```

同时更新 `backend/app/modules/change/model.py` 的 Change ORM 模型，添加对应字段。

### Task 2: API — POST /api/changes/{changeName}/progress

文件：`backend/app/modules/change/router.py` + `service.py`

CLI 发送 ProgressData 完整对象（JSON），格式如下：

```json
{
  "_version": 3,
  "project": "my-app",
  "currentChange": "2026-05-31-qa-fix",
  "currentStage": "execute",
  "lastActive": "2026-05-31T10:00:00Z",
  "stages": {
    "brainstorm": {
      "status": "completed",
      "startedAt": "2026/5/31 08:00:00",
      "completedAt": "2026/5/31 09:00:00",
      "steps": [
        {"name": "状态检查", "status": "completed", "output": "...", "completedAt": "..."}
      ]
    },
    "execute": {
      "status": "in-progress",
      "startedAt": "2026/5/31 10:00:00",
      "completedAt": null,
      "steps": []
    }
  },
  "batchProgress": {"total": 20, "completed": 5, "failed": 0, "skipped": 1}
}
```

后端处理：
1. 通过 `changeName` 查找 change（可能需要查 `slug` 或 `change_key` 字段，看看现有 model 怎么存的）
2. 更新 `current_stage` = body.currentStage
3. 更新 `stages` = body.stages（直接存 JSONB）
4. 返回 `{"ok": true}`

认证：`Authorization: Bearer {token}`

### Task 3: API — POST /api/changes/{changeName}/documents

文件：同上

CLI 发送四件套文档内容：

```json
{
  "proposal.md": "# Proposal\n...",
  "design.md": "# Design\n...",
  "requirements.md": "# Requirements\n...",
  "tasks.md": "# Tasks\n..."
}
```

后端处理：
1. 通过 `changeName` 找到 change
2. 遍历每个 key（文件名），提取 doc_type（去掉 .md 后缀）
3. 对每个文档，写文件到 `.sillyspec/changes/{changeName}/` 目录
4. 更新或创建 `change_documents` 表记录
5. 返回 `{"synced": N}`

### Task 4: API — GET /api/changes/{changeName}/approval

文件：同上

返回当前审批状态：

```json
{
  "status": "pending",  // pending/approved/rejected/not_required
  "reason": null        // rejection_reason，仅 rejected 时有值
}
```

### Task 5: API — POST /api/changes/{changeName}/approve + reject

文件：同上

Approve：
```json
// POST /api/changes/{changeName}/approve
// Body: {"approved_by": "admin@sillyhub.local"}
// 设置 approval_status='approved', approved_by, approved_at
```

Reject：
```json
// POST /api/changes/{changeName}/reject
// Body: {"reason": "设计有问题"}
// 设置 approval_status='rejected', rejection_reason
```

### Task 6: 前端 API 层

文件：`frontend/src/lib/` 新增或修改

在 `changes.ts` 或新建 `sync.ts` 中添加：

```typescript
// 同步变更进度到平台（内部API，CLI调的）
// 前端不需要调这个，但需要新增：
export async function approveChange(changeName: string): Promise<void>
export async function rejectChange(changeName: string, reason: string): Promise<void>
export async function getChangeApproval(changeName: string): Promise<{status: string, reason?: string}>
```

### Task 7: 前端 — Change 详情页阶段进度展示

文件：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`

在 Change 详情页新增一个「阶段进度」卡片：

1. 读取 change 对象的 `current_stage` 和 `stages` 字段
2. 渲染一个水平步骤条：`scan → brainstorm → plan → execute → verify → archived`
3. 当前阶段高亮，已完成打✅，未开始灰色
4. 展开可看到每个阶段的步骤列表和状态

### Task 8: 前端 — 审批操作

文件：同上或新建审批组件

1. 当 change 的 `approval_status === 'pending'` 时，在详情页显示审批按钮
2. 「审批通过」按钮 → 调 approveChange API
3. 「驳回」按钮 → 弹出输入拒绝原因的 Modal → 调 rejectChange API
4. 已审批的显示审批人和时间
5. 审批状态 badge：pending=黄色待审，approved=绿色已通过，rejected=红色已驳回

### Task 9: 兼容处理

- 现有的 ChangeFSM（draft→proposed→...）暂时保留不删，但新增字段独立工作
- 现有的 `transition_change()` 不受影响，继续管审批流
- 新增的 `current_stage` + `stages` 由 CLI sync 写入
- 前端同时展示两套（审批状态 + SillySpec 阶段）

## 验证

完成后运行：
```bash
cd backend && python -m pytest --tb=short -q
cd frontend && npx next build
```

全部通过即可。

## 关键参考文件

- 后端 Change model: `backend/app/modules/change/model.py`
- 后端 Change router: `backend/app/modules/change/router.py`
- 后端 Change service: `backend/app/modules/change/service.py`
- 前端 Change 详情页: `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- 前端 API 层: `frontend/src/lib/changes.ts`
- 迁移目录: `backend/migrations/versions/`
- CLI sync.js 参考: `/Users/qinyi/Desktop/sillyspec/src/sync.js`
