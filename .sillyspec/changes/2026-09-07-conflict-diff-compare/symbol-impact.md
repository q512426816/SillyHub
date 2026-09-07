# 符号影响面报告

> tasks.md 内容指纹（生成时）: fb71834322b13388——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行结论：签名级变更（构造函数参数/接口/DTO/方法签名增删改）写变更类型 + 受影响调用点 + 是否在任务范围内。

- task-01: 无签名级变更（仅新增测试文件 sillyspec-conflict-snapshot.test.ts，锚定 design §7.1 契约）
- task-02: 新增签名——sillyspec-manager.ts 新增公开 async conflictSnapshot(change, kind)；SillySpecStatusPendingConflict 接口加可选 ql_id 字段；daemon.ts 新增私有 _registerSillySpecRpcHandler(ws)。受影响调用点：daemon.ts:5091 区注册段（新增一行注册调用）、collectStatusOnce 心跳投影后处理（同文件内部）。均在任务范围内；buildSillySpecStatusSummary 纯函数签名不变。
- task-03: 无签名级变更（仅新增测试文件 test_sillyspec_compare.py）
- task-04: 新增签名——新文件 sillyspec_compare.py（compare 编排 service 函数）；router.py 新增 GET compare 端点函数；DaemonHeartbeatSillySpecConflict DTO 加可选 ql_id 字段（router.py:313 区）。受影响调用点：心跳落库为 JSON 零改写透传不受影响；前端经 task-05 gen:types 重新生成消费。均在任务范围内；resolve/ghost-cleanup 既有端点签名不变。
- task-05: 无签名级变更（pnpm gen:types 重新生成 api-types.ts + openapi.json，生成物不手改）
- task-06: 无签名级变更（新增 conflict-compare-modal.test.tsx + 适配 platform-sync-section.test.tsx/changes-overview-card.test.tsx 断言）
- task-07: 新增签名——lib/daemon.ts 新增 getSillySpecConflictCompare(instanceId, change, kind, workspaceId)；新文件 conflict-compare-modal.tsx 导出 ConflictCompareModal 组件（props：open/instanceId/change/kind/qlId/workspaceId/onClose/裁决回调）。受影响调用点：task-08 的 platform-sync-section.tsx 挂载点（同 Wave 5 合流，契约由 design §7.2 冻结）。范围内。
- task-08: 无对外签名级变更——platform-sync-section.tsx 行内结构改造（移除行内裁决按钮、新增查看对比入口、ql 标题），changes-overview-card.tsx 只读清单标题规则同步；两文件对外组件签名均不变。既有测试断言因文案/按钮变化失效，归 task-06 适配（related_tests 已登记）。
- task-09: 无签名级变更（仅跑本变更相关测试与 tsc）
- task-10: 无签名级变更（实机集成验收，证据落 acceptance/ 目录）
- task-11: 无签名级变更（模块文档更新）
