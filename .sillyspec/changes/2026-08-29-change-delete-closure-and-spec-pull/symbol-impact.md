---
author: qinyi
created_at: 2026-08-29 13:25:00
---

# 符号影响面报告 — 2026-08-29-change-delete-closure-and-spec-pull

> 按 plan.md 15 个 task 逐条给出签名级变更结论（无签名级变更也显式声明）。

- task-01: 无签名级变更（仅 DB 列新增 `spec_file_manifest.platform_deleted` / `quicklog_entries.hidden` + ORM 属性声明；不改任何函数/方法签名，调用方零影响）。
- task-02: 响应结构级变更——`apply_ops` 返回 dict 新增键 `platform_deleted: list[str]`，经 `POST /changes/-/spec-sync` 响应体透出（spec_sync schema conflict 项扩展）；受影响调用点：platform_sync/router.py spec-sync 端点响应构造、daemon spec-sync.ts SpecPushConflict 消费方（兼容：新键可选，旧消费方忽略）；`_write_spec_root` 行为变更不改签名。在任务范围内。
- task-03: 私有方法签名变更——`ChangeService._detect_renames` 增加 scope 集参数（限定 scope 内 rename 检测），受影响调用点：change/service.py:1202-1213（reparse 内部调用，同文件同步改）；`reparse()` 对外签名不变。在任务范围内。
- task-04: 返回结构级变更——`upsert_progress` 返回的 `PlatformSyncResult`（platform_sync/service.py:115）新增 `change_deleted` 标记字段；受影响调用点：platform_sync/router.py:104-152 push_progress 409 分支（同任务内改）；错误体为 router 内 JSONResponse 构造，不改 ConflictResponse schema。在任务范围内。
- task-05: 无签名级变更（apply_ops 内部对账钩子 + `merge_entries` 行为过滤；函数签名与返回结构均不变）。
- task-06: 新增签名——`SpecWorkspaceService.soft_delete_change_dir(workspace_id, change_key)`、`ChangeService.delete_change(...)`、`DELETE /api/workspaces/{ws}/changes/{cid}` 端点 + `ChangeDeleteResponse` DTO（均为新增，无既有签名修改）；受影响调用点：change/router.py 新路由注册、enrich_summaries deleted 前置过滤（内部）。在任务范围内。
- task-07: 新增签名——前端 `deleteChange(workspaceId, changeId)`（lib/changes.ts）+ DeleteChangeConfirm 组件 props；无既有组件签名修改。在任务范围内。
- task-08: 新增签名——`GET /api/changes/-/spec-bundle` 端点（platform_sync/router.py，前置注册）；`build_bundle` 签名不变（tar 内容+响应头扩展，daemon getSpecBundle 消费方兼容——tar 增一个顶层 json 文件，extractTar 按 regular file 解包天然兼容，task-10 实证）；endpoints.json 契约产物随任务落盘。在任务范围内。
- task-09: 新增签名——前端 `downloadSpecBundle(workspaceId)`（lib/spec-workspaces.ts）；无既有签名修改。在任务范围内。
- task-10: 无签名级变更（纯 daemon 测试新增，源码零修改前提）。
- task-11: DTO 字段级变更——`ChangeSummary` 新增可空字段 `last_pushed_at`（change/schema.py:108-138）；受影响调用点：前端 changes 列表/详情消费方（旧字段全保留，加字段向后兼容）；gen:types 再生成。在任务范围内。
- task-12: 无签名级变更（新增 change-activity-badge 组件 + 页面内部渲染；无既有 props/接口签名修改）。
- task-13: 跨仓 sillyspec——无函数签名级变更（X1 为六表 JSON 载荷的 status 取值扩展；X3/X4 为既有 `triggerSync`（src/run/shared.js:587）新调用点注入）；受影响调用点：src/stages/execute.js 任务循环、归档/unregister 链。在任务范围内。
- task-14: 跨仓 sillyspec——新增签名 `SyncManager.pullSpecBundle(opts)`（src/sync.js，不动既有 `pull()` :986 函数体）+ index.js 顶层命令注册。在任务范围内。
- task-15: 无签名级变更（纯文档：模块文档/ROADMAP/知识库/工具回执）。
