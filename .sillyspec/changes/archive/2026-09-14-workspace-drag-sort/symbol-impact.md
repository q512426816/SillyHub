# 符号影响面报告

> tasks.md 内容指纹（生成时）: 42bfb1baa0e916c4——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增符号 UserWorkspaceOrder（新模型/新表），无既有签名变更；无外部调用点（仅 task-03/04 后续引用，均在范围内）。
- task-02: 新增 DTO WorkspaceMoveRequest/WorkspaceMoveResponse + 新端点 POST /workspaces/{id}/move（新增签名）；既有签名级变更的消费侧调用点=router.py 两处 list_with_owner 调用（backend/app/modules/workspace/router.py:301 管理员/316 普通用户）增传 order_user_id=user.id——该文件在本 task allowed_paths 内，范围内。
- task-03: WorkspaceService 新增方法 move_workspace/_backfill_order_rows（新增签名，不改既有方法）；唯一消费调用点=task-02 router 端点，范围内。
- task-04: 签名级变更：list_with_owner 新增 keyword-only 可选参数 order_user_id: uuid.UUID | None = None（默认 None=现状分支，未更新调用点不破坏）；既有调用点仅 backend/app/modules/workspace/router.py:301/316 两处，归 task-02（W4 透传）范围；total/rows 双语句内部改动无签名外泄。
- task-05: 无签名级变更（新增测试文件 test_move_order.py）。
- task-06: api-types.ts 再生成：新增导出类型 WorkspaceMoveRequest/WorkspaceMoveResponse（新增 DTO），不修改既有类型形状；消费方=task-07 moveWorkspace，范围内。
- task-07: 新增导出符号 moveWorkspace()/WORKSPACE_PAGE_SIZE（新增签名）；package.json/pnpm-lock 依赖新增；page.tsx 本地 PAGE_SIZE 引用替换归 task-09，范围内。
- task-08: 新增组件 WorkspaceDragGrid（新签名）；签名级变更：workspace-card.tsx Props 增可选挂点字段（默认不渲染，向后兼容）——既有调用点 page.tsx（归 task-09）与 workspace-card.test.tsx（回归归 task-10），均在任务范围内。
- task-09: page.tsx 消费 WorkspaceDragGrid/moveWorkspace/WORKSPACE_PAGE_SIZE（接线）；新增组件 workspace-move-dialog.tsx；无范围外调用点。
- task-10: 无签名级变更（新增/增补测试文件）。
