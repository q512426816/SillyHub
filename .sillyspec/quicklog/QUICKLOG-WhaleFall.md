---
author: WhaleFall
created_at: 2026-06-01 18:00:00
---

# QUICKLOG

## 2026-06-01 18:00:00 — Fix TypeScript build error in workspace-scan-dialog.tsx
状态：已完成
文件：frontend/src/components/workspace-scan-dialog.tsx
结果：移除 phase==="creating" 不可能的类型比较（在 phase==="generated" 块内），disabled 改为简单条件，文本改为静态"确认创建"。Frontend Docker build 通过。

## 2026-06-02 08:00:00 — 检测到 .sillyspec 时显示直接创建按钮
状态：已完成
文件：backend/app/modules/workspace/schema.py, router.py, service.py, frontend/src/components/workspace-scan-dialog.tsx, frontend/src/lib/workspaces.ts
结果：ScanResponse 新增 sillyspec_path 字段。WorkspaceService.create 自动创建 SpecWorkspace(strategy=repo-native, spec_root=项目.sillyspec路径)。前端扫描检测到 .sillyspec 时显示"直接创建"按钮。Docker 全部 healthy。

## 2026-06-02 10:34:39 — scan-docs 递归扫描 .sillyspec/docs 所有文件 + 前端树形展示
状态：已完成
文件：backend/app/modules/scan_docs/parser.py, service.py, model.py, router.py, frontend/src/lib/scan-docs.ts, frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx, backend/migrations/versions/202606210900_scan_docs_path_index.py
结果：parser 从 parse_component 改为 parse_docs_tree(递归rglob .sillyspec/docs/)，service 从 doc_type 去重改为 path 去重，router 从 /{doc_type} 改为 /{doc_id}(UUID)，model 唯一索引从 (workspace_id,doc_type) 改为 (workspace_id,path)。前端 page.tsx 重写为左右分栏树形视图(TreeView+buildTree)。

## 2026-06-02 10:51:49 — scan-docs 树形视图优化：跳过 .sillyspec/docs 层级 + Markdown 渲染
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx, frontend/package.json
结果：buildTree 跳过 .sillyspec/docs 前两段路径，md 文件用 react-markdown+remark-gfm 渲染，yaml/yml 保持 pre 文本。Docker 重建通过。

## 2026-06-02 11:14:25 — 替换 markdown 预览为 @uiw/react-markdown-preview
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx, frontend/package.json, frontend/pnpm-lock.yaml
结果：替换 react-markdown+remark-gfm 为 @uiw/react-markdown-preview，使用 dynamic import ssr:false。移除旧包。Docker build 通过，所有服务 healthy。

## 2026-06-02 11:29:28 — Workspace 创建时自动导入 .sillyspec/projects 子项目
状态：已完成
文件：backend/app/modules/workspace/service.py
结果：rescan() 加入 reparse() 调用，扫描到 .sillyspec + has_projects_dir 时自动导入项目 YAML 为子 workspace + 拓扑关系。已验证 backend/frontend 子项目创建成功，重复 rescan 不创建重复。

## 2026-06-02 13:20:08 — 修复"直接创建"子项目未同步：_ensure_spec_workspace 已存在时跳过 reparse
状态：已完成
文件：backend/app/modules/workspace/service.py
结果：_ensure_spec_workspace() 移除 early return，无论 SpecWorkspace 是否存在都调用 reparse() 同步子项目。rescan() 也新增 reparse 调用。删除所有 workspace → 直接创建 → 子项目自动创建成功，不重复。

## 2026-06-02 13:29:58 — 出边/入边关系表显示目标 Workspace 名称+(key)
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx
结果：添加 wsMap lookup，出边目标显示名称+(component_key)，入边源显示名称+(component_key)，fallback 为截断 UUID。

## 2026-06-02 13:47:16 — 修复出边/入边表 wsMap 不含兄弟 workspace
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx
结果：新增 allWorkspaces state 存全部 workspace，wsMap 从 allWorkspaces 构建。出边/入边表现在正确显示兄弟 workspace 的名称+(key)。

## 2026-06-02 14:30:00 — 修复项目组组件数量显示错误（全局数量→子组件数量）
状态：已完成
文件：frontend/src/lib/components.ts
结果：listComponents 改为先获取当前 workspace 的 root_path，再过滤所有 workspace 中 root_path 以该前缀开头（排除自身）的项。修复了项目组组件数量显示为全局数量而非子组件数量的问题。

## 2026-06-02 14:10:25 — 修复 _build_child_root_path 绝对路径处理 + reparse 容错
状态：已完成
文件：backend/app/modules/workspace/service.py, deploy/.env
结果：1) _build_child_root_path 检测绝对路径(Windows/Posix)并用 _rewrite_path 转换。2) reparse 跳过与父 root_path 冲突的子项。3) deploy/.env 改为 HOST_PROJECTS_DIR=HOST_PATH_PREFIX=F:/Work。project-spec 创建成功，子项目路径正确。
