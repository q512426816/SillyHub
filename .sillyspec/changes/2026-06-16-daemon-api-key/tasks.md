---
author: qinyi
created_at: 2026-06-16T12:00:00
---

# Tasks — daemon-api-key

任务列表（细节在 plan 阶段展开）。

## Backend

- [ ] T1: ApiKey 数据模型 + Alembic 迁移
  - 文件：`backend/app/modules/auth/model.py`、`backend/migrations/versions/202606300900_add_api_keys.py`
- [ ] T2: ApiKeyService（create/list/revoke/authenticate）
  - 文件：`backend/app/modules/auth/api_key_service.py`
- [ ] T3: ApiKey Pydantic Schema
  - 文件：`backend/app/modules/auth/api_key_schema.py`
- [ ] T4: ApiKey CRUD 端点（POST/GET/DELETE /api/auth/api-keys）
  - 文件：`backend/app/modules/auth/router.py`
- [ ] T5: get_current_principal dependency + _extract_api_key
  - 文件：`backend/app/core/auth_deps.py`
- [ ] T6: daemon 端点切到 get_current_principal
  - 文件：`backend/app/modules/daemon/router.py`
- [ ] T7: agent-runs 端点切到 get_current_principal
  - 文件：`backend/app/modules/agent/router.py`
- [ ] T8: spec-workspace 端点切到 get_current_principal
  - 文件：`backend/app/modules/spec_workspace/router.py`

## Backend 测试

- [ ] T9: ApiKeyService 单测（create/list/revoke/authenticate/expire/owner-check）
  - 文件：`backend/app/modules/auth/tests/test_api_key_service.py`
- [ ] T10: ApiKey router 单测（POST/GET/DELETE/权限）
  - 文件：`backend/app/modules/auth/tests/test_api_key_router.py`
- [ ] T11: get_current_principal 双路径测试（JWT 优先 / X-API-Key 回退 / 都缺）
  - 文件：`backend/tests/core/test_auth_deps_principal.py`
- [ ] T12: API Key 端到端生命周期（create → use → revoke → 401）
  - 文件：`backend/app/modules/auth/tests/test_api_key_lifecycle.py`

## Daemon

- [ ] T13: DaemonConfig 加 api_key 字段
  - 文件：`sillyhub-daemon/src/config.ts`
- [ ] T14: HubClient 构造签名改造（token/apiKey options）+ _headers 分支
  - 文件：`sillyhub-daemon/src/hub-client.ts`
- [ ] T15: daemon.ts / task-runner.ts 同步 HubClient 构造
  - 文件：`sillyhub-daemon/src/daemon.ts`、`sillyhub-daemon/src/task-runner.ts`
- [ ] T16: cli.ts 加 --api-key 选项 + 与 --token 互斥校验 + config 持久化
  - 文件：`sillyhub-daemon/src/cli.ts`
- [ ] T17: daemon CLI 单测（--api-key 解析 / 互斥 / config 写入）
  - 文件：`sillyhub-daemon/tests/cli.test.ts`
- [ ] T18: HubClient 单测（X-API-Key header / Authorization header）
  - 文件：`sillyhub-daemon/tests/hub-client.test.ts`

## Frontend

- [ ] T19: API 客户端（createKey/listKeys/revokeKey）
  - 文件：`frontend/src/lib/api-keys.ts`
- [ ] T20: 签发弹窗组件（双阶段：表单 → plaintext 一次性显示）
  - 文件：`frontend/src/components/api-key-create-dialog.tsx`
- [ ] T21: /settings/api-keys 页面（列表 + 签发 + 吊销）
  - 文件：`frontend/src/app/(dashboard)/settings/api-keys/page.tsx`
- [ ] T22: settings 导航加入 API Keys 入口
  - 文件：`frontend/src/app/(dashboard)/settings/page.tsx`（或 layout）
- [ ] T23: /runtimes CopyDaemonCommand 改造（默认 --api-key，fallback --token）
  - 文件：`frontend/src/app/(dashboard)/runtimes/page.tsx`

## 部署 / 收尾

- [ ] T24: 部署 stack，端到端验证（签发 key → daemon 启动 → runtime online → 吊销 → runtime offline）
- [ ] T25: 提交 + 推送
