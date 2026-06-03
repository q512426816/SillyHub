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
