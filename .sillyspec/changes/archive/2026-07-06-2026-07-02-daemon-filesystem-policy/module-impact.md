---
author: WhaleFall
created_at: 2026-07-06 14:30:00
change: 2026-07-02-daemon-filesystem-policy
stage: archive
---

# Module Impact: Daemon Filesystem Policy Engine

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| daemon/policy | 新增 | sillyhub-daemon/src/policy/path-utils.ts, runtime-policy.ts, shell-paths.ts, filesystem-policy.ts, audit-sink.ts | 新增 PolicyEngine/PolicyCache/AuditSink 核心引擎：canRead 放行不审计，canWrite/canCreate/canDelete 按 runtime_id 隔离 + resolveRealPath 防 symlink 绕过 + 全量 audit。path-utils resolveRealPath/isPathUnderAnyRoot 窗口平台兼容。 | no |
| daemon | 逻辑变更 | sillyhub-daemon/src/daemon.ts, config.ts, cli.ts, task-runner.ts, file-rpc.ts | _handlePolicyUpdate WS 热更新 + _syncAllowedRoots 心跳同步 + _syncPolicyCache 兜底 + config.ts normalizeAllowedRoots。cli.ts/task-runner 装配 policyEngine/AuditSink。file-rpc listDir 读自由语义。 | no |
| daemon/interactive | 逻辑变更 | sillyhub-daemon/src/interactive/session-manager.ts, write-guard.ts | session-manager _wrapWithWriteGuard/_judgeWriteViaPolicyEngine 写拦截 + write-guard.ts Bash/PowerShell/CMD 间接写检测+路径提取。 | no |
| daemon/adapters | 调用关系变更 | sillyhub-daemon/src/adapters/stream-json.ts, json-rpc.ts | batch Claude/Codex 注入 policyCache 快照 + TaskRunner canWrite 带内审批。 | no |
| backend/daemon | 逻辑变更 | backend/app/modules/daemon/router.py, schema.py, model.py, service.py | PUT /runtimes/{rid}/allowed-roots + WS POLICY_UPDATE 推送。heartbeat/register 响应带已规范化 allowed_roots。心跳 sync 回 daemon。 | no |
| backend/daemon/runtime | 调用关系变更 | backend/app/modules/daemon/runtime/service.py | register_daemon/update_allowed_roots 读写 allowed_roots。 | no |
| backend/daemon/audit | 新增 | backend/app/modules/daemon/audit/*（model, router, schema, service, tests） | 新增审计模块：POST /api/daemon/audit/batch（攒批上报）+ GET policy-audit（分页查询）+ claim_token 鉴权。 | no |
| backend/daemon/ws_hub | 逻辑变更 | backend/app/modules/daemon/ws_hub.py | send_policy_update（带 runtime_id per-runtime 标识）。 | no |
| backend/daemon/permission_service | 配置变更 | backend/app/modules/daemon/permission_service.py | adapter semantic-adapt 模式兼容。 | no |
| backend/daemon/lease | 调用关系变更 | backend/app/modules/daemon/lease/context.py | lease 生命周期政策适配（policyCache 装配前预读取）。 | no |
| backend/migration | 新增 | backend/migrations/versions/policy_audit_log 等 | 审计表 migration。 | no |
| frontend | 新增 | frontend/src/lib/daemon-audit.ts, frontend/src/app/(dashboard)/runtimes/[id]/audit/page.tsx | 审计页政策日志展示。 | no |

## 未匹配文件

| 文件 | 说明 |
|---|---|
| .sillyspec/** | 规范文档/quicklog，非业务代码 |
| .claude/skills/** | SillySpec skill 模板 |
| .codex/skills/** | Codex skill 副本 |
