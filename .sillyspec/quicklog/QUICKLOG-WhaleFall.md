---
author: WhaleFall
created_at: 2026-06-03T08:42:04
---

## 2026-06-03 08:42:04 — scan API 400: 路径含不可见 Unicode 控制字符导致 path.exists() 失败
状态：已完成
文件：backend/app/modules/workspace/schema.py, backend/app/modules/workspace/tests/test_router.py
结果：在 ScanRequest/ScanGenerateRequest/WorkspaceCreate 添加 _sanitize_path validator 剥离不可见 Unicode 双向控制字符，19 tests 全部通过

## 2026-06-03 08:59:15 — SSE stream 返回 200 但不推送数据
状态：已完成
文件：backend/app/modules/agent/router.py, backend/app/modules/agent/service.py, backend/app/modules/agent/tests/test_router.py
结果：添加防缓冲 SSE 头 + 初始 ": connected" comment 刷新代理 + Redis 订阅后重查 DB 状态防竞态，16 tests 通过

## 2026-06-03 09:48:00 — SSE 数据批量回显 + token 过期致假失败
状态：已完成
文件：backend/app/modules/agent/router.py, backend/app/modules/agent/service.py, backend/app/modules/agent/tests/test_router.py, frontend/src/lib/api.ts, frontend/src/lib/agent.ts, frontend/src/components/workspace-scan-dialog.tsx
结果：1) EventSource 改用 getDirectApiBaseUrl() 直连后端绕过 Next.js rewrite 代理缓冲；2) done 事件携带 {status, exit_code}，前端不再调 getAgentRun() 避免长任务 token 过期 401，16 tests 通过

## 2026-06-03 10:44:29 — 直接创建时拷贝 .sillyspec 到平台目录，脱离本地依赖
状态：已完成
文件：backend/app/modules/workspace/service.py, backend/app/modules/workspace/router.py, frontend/src/lib/workspaces.ts
结果：_ensure_spec_workspace 改用 shutil.copytree 将 .sillyspec 拷贝到 spec_data_root/<ws_id>/，策略改为 platform-managed；reparse/rescan 从 spec_root 读取；新增 activate endpoint + service 方法，19 tests 通过

## 2026-06-03 12:02:42 — 直接创建重复点击 500: copytree 崩溃 + 已存在 workspace 唯一约束冲突
状态：已完成
文件：backend/app/modules/workspace/service.py
结果：1) copytree 用 try-except 包裹 + ignore_dangling_symlinks 防崩溃；2) create() 增加 active 已存在判断直接返回，避免唯一约束冲突 500

## 2026-06-03 12:23:54 — reparse 子 workspace 路径错误 + copytree 排除 .runtime + scan 读平台存储
状态：已完成
文件：backend/app/modules/workspace/service.py
结果：1)reparse分离parse_root和host_root，子workspace路径正确指向host路径；2)copytree排除.runtime目录(1.1GB→几MB)；3)查询清理旧的错误路径子workspace；4)rescan已从spec_root读取

## 2026-06-03 12:36:16 — scan-docs reparse 应从平台存储读取，不应读本地
状态：已完成
文件：backend/app/modules/scan_docs/service.py, backend/app/modules/workspace/service.py
结果：scan_docs reparse 和 workspace reparse 均优先从 spec_root(平台存储)读取，不再依赖用户本地路径

## 2026-06-03 13:17:33 — 直接创建 pending workspace(无本地.sillyspec)报 400
状态：已完成
文件：backend/app/modules/workspace/service.py, backend/app/modules/scan_docs/service.py
结果：create()先检查pending workspace的平台存储.sillyspec，有则直接激活无需本地路径；scan-docs reparse也从平台存储读取

## 2026-06-03 13:25:14 — 生成项目规范后自动创建 workspace，去掉确认创建步骤
状态：已完成
文件：frontend/src/components/workspace-scan-dialog.tsx
结果：agent onDone回调自动调用createWorkspace，移除确认创建按钮和generated阶段

## 2026-06-03 13:48:35 — 进入扫描文档页面时自动 reparse 获取最新
状态：已完成
文件：frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx
结果：load函数中先调reparseScanDocs从平台存储读取最新文件，再listScanDocs展示

## 2026-06-03 13:53:52 — 前端容器未包含最新代码，需重建前端镜像
状态：已完成
文件：frontend (rebuild)

## 2026-06-03 14:00:47 — 中文名 workspace slugify 回退 "workspace" 与已有 slug 冲突 409
状态：已完成
文件：backend/app/modules/workspace/service.py
结果：新增_ensure_unique_slug方法，slug冲突时自动加uuid后缀；pending激活和resurrect两处都已使用
