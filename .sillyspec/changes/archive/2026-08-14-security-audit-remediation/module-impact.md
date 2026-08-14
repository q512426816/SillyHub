---
author: qinyi
created_at: 2026-08-15 01:20:00
---

# 模块影响分析（Module Impact）— security-audit-remediation 安全审查高危修复

## 变更：security-audit-remediation

> 安全审查高危修复（5 高危 + 7 中危 + XSS + compose 硬化）。基于 design.md 文件变更清单 + plan.md 7 Wave 分析；module-map 参照 .sillyspec/docs/SillyHub/modules/_module-map.yaml。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 |
|------|----------|----------|-------------|
| daemon | 接口变更 | backend/app/modules/daemon/router.py | WS 升级期鉴权（4001/4003）；claim/pending-leases/heartbeat 归属校验；新增 llm-proxy 透传端点 |
| daemon | 逻辑变更 | backend/app/modules/daemon/lease/service.py | claim_lease 加 actor_user_id 校验；claim_token 改 compare_digest |
| daemon | 逻辑变更 | backend/app/modules/daemon/lease/context.py | 两处 openai_chat 分支移除 master key 下发，改 litellm_proxy 标记 |
| daemon | 逻辑变更 | backend/app/modules/daemon/runtime/service.py | heartbeat 归属校验 |
| agent | 逻辑变更 | backend/app/modules/agent/placement.py | dispatch_to_daemon 补写 metadata actor_user_id + lease_id 回填核实 |
| file | 接口变更 | backend/app/modules/file/service.py, router.py | 五端点归属断言（uploaded_by/RBAC）+ list 可见域过滤 |
| platform_sync | 接口变更 | backend/app/modules/platform_sync/auth.py, router.py | JWT/shk_live_ 写端点 403；读端点 CHANGE_READ 并集聚合 |
| change | 逻辑变更 | backend/app/modules/change/service.py, schema.py | sync_documents relative_to 守卫 + filename 白名单 |
| core | 接口变更 | backend/app/core/auth_deps.py | 删 token/api_key query 回退 |
| mcp_gateway | 逻辑变更 | backend/app/modules/mcp_gateway/sse.py | mission SSE workspace-scoped |
| workspace | 逻辑变更 | backend/app/modules/workspace/router.py | activate/init 权限收紧 |
| git_identity | 逻辑变更 | backend/app/modules/git_identity/schema.py | username/email pattern 校验 |
| worktree | 逻辑变更 | backend/app/modules/worktree/exec_env.py | write_gitconfig 防御性拒换行 |
| main | 接口变更 | backend/app/main.py | quick-chat 四端点 lease 归属过滤 |
| sillyhub-daemon | 逻辑变更 | sillyhub-daemon/src/ws-client.ts, daemon.ts | WS 连接传 X-API-Key header |
| sillyhub-daemon | 逻辑变更 | sillyhub-daemon/src/credential-injector.ts, spawn-env.ts | litellm_proxy 标记 → ANTHROPIC_BASE_URL 指向 hub 代理 |
| frontend | 逻辑变更 | frontend/src/lib/agent-stream.ts, lib/daemon.ts, lib/fetch-sse.ts(新) | EventSource → fetch-SSE（token 走 header） |
| frontend | 逻辑变更 | frontend/src/components/permissions/session-permission-panel.tsx | 同上 |
| frontend | 逻辑变更 | frontend/src/app/api/daemon-chat/[runId]/stream/route.ts, app/api/workspaces/[workspaceId]/agent/runs/[runId]/stream/route.ts | token 改 header 转传 |
| frontend | 逻辑变更 | frontend/src/components/ui/markdown-text.tsx | rehype-sanitize |
| deploy | 配置变更 | deploy/docker-compose.yml | 弱口令 fail-fast + 端口收紧 + HUB_PROXY_BASE_URL 接线 |
| deploy | 配置变更 | deploy/.env.example | 必填密钥条目 + HUB_PROXY_BASE_URL |
| core | 逻辑变更 | backend/app/core/monitoring.py, tests/test_monitoring.py | （搭车：另一并行会话性能观测工作被 commit 裹挟，非本变更范围，自包含有测试） |
| ppm | 逻辑变更 | backend/app/modules/ppm/problem/router.py, tests | file get_stream 签名连带（export-excel 唯一外部调用者） |
| sillyhub-daemon | 逻辑变更 | sillyhub-daemon/src/types.ts, cli.ts | ProviderConfig.litellm_proxy 字段 + setDaemonApiKey 注入落点（task-04 连带） |

## 未匹配文件

| 文件路径 | 说明 |
|----------|------|

## 更新结果

| 模块文档 | 操作 | 状态 |
|----------|------|------|
| modules/_module-map.yaml | daemon entrypoints 补 llm-proxy 端点 + WS 升级期鉴权；main_symbols 补 llm_proxy/_authenticate_bearer_headers/_authenticate_ws_upgrade；generated_at 更新 2026-08-15 | done |
| modules/daemon.md | 契约摘要补 llm-proxy 端点 + WS header 鉴权；注意事项补「WS 升级期鉴权 4001/4003」「llm-proxy master key 不出进程 + v1 路径白名单」；变更索引补 security-audit-remediation 条目 | done |
| modules/file.md | 契约摘要补可见域（uploaded_by/WORKSPACE_READ/admin 豁免、跨用户 404）；注意事项补 get_stream 签名连带（PPM export-excel） | done |
| modules/platform_sync.md | 卡片不存在，跳过不创建（写端点仅 shpsync_/JWT·shk_live_ 403/读并集聚合语义未入模块卡） | skipped |
