---
schema_version: 1
doc_type: module-card
module_id: components-agent
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 借用方案查看组件（components-agent）

## 定位
「借用方案」查看组件（`components/agent/`，2 个组件 + 3 个测试文件），服务业务人员（business_member）
借用工作区共享 daemon 跑智能体后的产出查看。借用产出的方案文件由后端回调
（close_interactive_run/complete_lease）落文件中心：owner_type="workspace"、owner_id=ws_id、
uploaded_by=业务人员。前端严格两层分工：容器层拉活数据、展示层纯渲染，预览全量复用
FileViewer，不重写 MIME 判定/图片网格/下载链。派生自 2026-07-25-daemon-borrow-for-business
（task-13 / FR-06 / D-001@v1 / D-009@v1）。

## 契约摘要
- `BorrowedSolutionFilesPanel`（`borrowed-solution-files-panel.tsx`）：容器层组件。
  - props：`{ workspaceId: string; title?: string; refreshKey?: number }`。
  - 数据：`listFiles({ owner_type: "workspace", owner_id: workspaceId })`（lib/file/api），
    取响应的 id 列表（后端已按 created_at 倒序，前端不再排序）透传展示层。
  - 三分支渲染：loading（"加载借用方案..."）/ error（ApiError.message 或兜底文案）/ 正常。
  - `refreshKey` 计数变更即重拉（父组件刷新触发器）。
- `BorrowedSolutionFiles`（`borrowed-solution-files.tsx`）：纯展示组件。
  - props：`{ fileIds?: string[]; emptyText?: string; title?: string }`。
  - 空列表渲染虚线空态卡（默认文案引导业务人员）；非空直接 `<FileViewer fileIds={ids} />`。
  - data-testid：`borrowed-solution-empty` / `borrowed-solution-files`（测试锚点）。
- 测试：
  - `borrowed-solution-files-panel.test.tsx`：容器 fetch 透传链路（mock listFiles）。
  - `borrowed-solution-files.test.tsx`：展示层空态/透传。
  - `__tests__/borrow-trigger-contract.test.ts`：借用触发契约锁定。

## 关键逻辑
- 容器层数据流（useEffect 内 `active` 标记防卸载后 setState）：
  ```
  useEffect(() => {
    listFiles({ owner_type: "workspace", owner_id })
      .then(files => setFileIds(files.map(f => f.id)))
      .catch(err => setError(...))      // finally → setLoading(false)
    return () => { active = false }
  }, [workspaceId, refreshKey])
  ```

## 注意事项
- 分层红线：容器层只管「活数据」（fetch + loading/error），展示层只管渲染
  （fileIds → FileViewer）；改其一勿侵入另一层职责（两文件头注释均明示）。
- 触发借用（FR-04）不在本组件——复用现有 agent 触发 UI（前端无感），本组件只负责
  "看产出"；勿在此加触发按钮或"选 daemon"交互。
- 方案归属判定完全靠 owner_type/owner_id 查询参数，勿在前端再做二次过滤。
- 依赖 lib/file/api（lib-file-api 模块）；若文件中心 API 变更，本模块只受透传影响。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
