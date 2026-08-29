---
author: qinyi
created_at: 2026-08-29 13:15:00
---
# 模块影响分析（Module Impact）— 变更中心删除闭环、文档拉取与进行中可见性

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:change | 修改+新增 | reparse scoped 定向删除与 deleted 行三点豁免（service.py）、progress 联动删、delete_change/DELETE 端点与 ChangeDeleteResponse（router/schema）、enrich last_pushed_at 投影与 deleted 前置过滤、quicklog merge_entries 过滤 hidden（quicklog_service） |
| backend:spec_workspace | 修改+新增 | apply_ops 空目录清理与 platform_deleted 复活拦截（add/rename 拒、delete 放行）、_write_spec_root 落盘级前缀排除（B-2）、quicklog apply 期对账、soft_delete_change_dir 新方法、build_bundle 加 X-Spec-Version/PLATFORM-BUNDLE.json、SpecFileManifest + platform_deleted 列（model） |
| backend:platform_sync | 修改+新增 | _ensure_change_row 双层拒收与 CLI 墓碑写路径处理（service）、progress 409 code=change_deleted（router）、GET /changes/-/spec-bundle 新端点（前置注册）、QuicklogEntryORM + hidden 列（model） |
| backend:migrations | 新增 | 单 revision 两列：spec_file_manifest.platform_deleted + quicklog_entries.hidden（backend/migrations/versions/20260829130000_*，执行时接唯一 head） |
| frontend:changes | 修改+新增 | 列表操作列/活动徽标三态/详情页危险按钮与最后信号（page.tsx、[cid]/page.tsx、m/ 镜像页）、DeleteChangeConfirm 新组件、change-activity-badge 新组件 |
| frontend:workspace-config | 修改 | 「下载文档包」按钮（blob 范式）与快照语义文案 |
| frontend:lib | 修改 | changes.ts deleteChange、spec-workspaces.ts downloadSpecBundle、api-types.ts 再生成（gen:types） |
| sillyhub-daemon:spec-sync | 测试 | bundle 含 PLATFORM-BUNDLE.json 后 pullSpecBundle/spec_version 判定兼容回归（源码零修改前提，task-10） |
| sillyspec 仓（跨仓，X1-X4） | 修改+新增 | src/run/shared.js 墓碑/步骤开始上报、src/sync.js 载荷 + pullSpecBundle、src/index.js pull 命令注册、src/stages/execute.js 任务边界 triggerSync |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/openapi.json、frontend/src/lib/api-types.ts | 生成物（pnpm gen:types），task-11/task-07 收口再生成，不手改 |
| .sillyspec/local.yaml | 跨仓注册表 repos 段（sillyspec 仓路径），plan 阶段已加，非源码模块 |
| frontend/src/components/delete-change-confirm.tsx、change-activity-badge.tsx | 本变更新增组件，归 frontend:changes 域，scan 刷新 _module-map 时补条目 |
| sillyspec 仓四触点（src/run/shared.js 等） | 跨仓 repo: sillyspec（local.yaml repos 已注册），不在主仓 _module-map 覆盖范围 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `docs/SillyHub/scan/` 六文档 + `modules/` 模块文档 | task-15 收尾统一同步（change/spec_workspace/platform_sync/frontend 页面规范） | pending（task-15） |
| `.sillyspec/ROADMAP.md` | task-15 补记本变更条目 | pending（task-15） |
| `.sillyspec/knowledge/decisions/` | task-15 提炼 D-001~D-007 入 backend/frontend/sillyhub-daemon 域 | pending（task-15） |
| `_module-map.yaml` | 新增组件/端点落地后由 scan 刷新（本变更不手动改映射） | skipped |
