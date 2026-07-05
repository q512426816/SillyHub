---
author: qinyi
created_at: 2026-07-04 17:33:31
task_id: task-08
allowed_paths:
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/daemon.ts
---

# task-08: 前端类型重生成 + 升级 hook

## 所属 Wave
Wave 3（前端）

## 文件
- 重新生成 `frontend/src/lib/api-types.ts`（基于 Wave 2 完成后的 backend openapi.json，含 DaemonRuntimeRead.daemon_version/build_id、DaemonInstanceRead.version/build_id、DaemonVersionResponse.latest_version/build_id）
- 修改 `frontend/src/lib/daemon.ts`：补/确认 `triggerDaemonSelfUpdate(runtimeId)` 调用封装（OpenAPI 已生成 trigger_daemon_self_update 操作）

## 验收标准
- [ ] api-types.ts 含全部新字段
- [ ] triggerDaemonSelfUpdate hook 封装 self-update 端点
- [ ] 不回退既有字段（手动核对 diff）
- [ ] 前端类型检查通过

## 依赖
- Wave 2 完成（backend schema 定型）

## 覆盖
- FR-06, FR-07, D-005@V1

## 测试命令
`cd frontend && pnpm typecheck`（或 tsc）

## 风险防范
- R-05：重生成与并行变更 2026-07-04-frontend-openapi-types 冲突——基于最新 openapi.json，手动核对 diff
- 参见 memory: 前端类型迁移画像（OpenAPI 重生成）
