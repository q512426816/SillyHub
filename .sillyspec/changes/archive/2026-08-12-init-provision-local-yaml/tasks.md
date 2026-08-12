---
author: qinyi
created_at: 2026-08-12 10:13:52
---
# 任务清单（Tasks）

> 本文件为 brainstorm 阶段的任务草案，具体 Wave 分组 / 依赖关系 / 验收点由后续 `sillyspec run plan` 细化。

## 后端

### T1: PlatformSyncTokenService.get_or_issue
- 文件：`backend/app/modules/platform_sync/token_service.py`
- 要点：新增 `get_or_issue(*, workspace_id, created_by) -> tuple[ORM, plaintext]`。内联 select 旧未吊销（ws, created_by, revoked_at IS NULL）+ 命中则 UPDATE revoked_at=now 吊销（不新增 public revoke）+ 调既有 `create(*, workspace_id, name='init-provisioned', created_by, scope=None)`。
- 不改原 create/authenticate（零回归）。

### T2: McpTokenService.get_or_issue
- 文件：`backend/app/modules/mcp_gateway/service.py`
- 要点：新增 `get_or_issue(*, workspace_id, created_by)`。复用 `list_for_workspace` 查旧 + `revoke` 吊销 + `create(*, workspace_id, created_by, name='init-provisioned', scope=['dispatch'])`。scope 必须是 MCP_SCOPES 合法值。

### T3: build_claim_payload init 分支注入 token
- 文件：`backend/app/modules/daemon/lease/context.py`（mode=='init' 分支，:579）
- 要点：claim 时解析 actor_user_id（从 lease_meta，dispatch 已写）+ workspace_id，调两个 get_or_issue 拿明文，注入 `payload.platform_config.local_yaml={platform_token, mcp_token}`。**不写 lease.metadata_**。url 不放（daemon 端拼）。

### T4: start_init_dispatch 注释澄清（零行为改动）
- 文件：`backend/app/modules/agent/service.py`（:1779）
- 要点：B1 抉择下 dispatch 不签 token、不写 local_yaml 到 metadata。补注释说明 token 在 claim 时签（build_claim_payload）。确认 metadata.actor_user_id 已写（供 claim 解析 created_by）。

## daemon

### T5: local-yaml-writer.ts（文本级段替换）
- 文件：`sillyhub-daemon/src/local-yaml-writer.ts`（新增）
- 要点：TS 重写 sillyspec sync.js 的 `findTopLevelSectionRange` / `replaceTopLevelSection` / `writeLocalYaml`。顶层段匹配、字节级保留注释/其他段/CRLF。`writeLocalYaml(rootPath, {platform_token, mcp_token}, serverOrigin)`：platform 段覆盖、mcp 段有才留、文件不存在则创建。失败抛错。

### T6: handleInitLease 增 writeLocalYaml 第 4 步
- 文件：`sillyhub-daemon/src/spec-sync.ts`（handleInitLease）
- 要点：在 writeDaemonState + pullSpecBundle 之后加第 4 步 writeLocalYaml。读 ctx.platformConfig.local_yaml + serverOrigin（task-runner.config.server_url）。失败 try/catch 返回 ok:false（同 writeDaemonState 范式），不向上抛。

### T7: task-runner 透传 local_yaml + serverOrigin 到 handleInitLease
- 文件：`sillyhub-daemon/src/task-runner.ts`（_runInitLease / initParams 构造）
- 要点：确认 platformConfig.local_yaml 从 payload 透传到 handleInitLease 入参；serverOrigin 继续用 this.config?.server_url（已有 :861）。

## 测试

### T8: platform_sync get_or_issue 测试
- 文件：`backend/app/modules/platform_sync/tests/test_get_or_issue.py`（新增）
- 覆盖：空则签新 / 有旧则吊销+签新 / 多次调用不堆积（同维度仅一条活）/ 吊销的 authenticate 返回 None。

### T9: mcp_gateway get_or_issue 测试
- 文件：`backend/app/modules/mcp_gateway/tests/test_get_or_issue.py`（新增）
- 覆盖：同 T8；scope=['dispatch'] 合法性。

### T10: claim 阶段 token 注入测试
- 文件：`backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py`（新增）
- 覆盖：build_claim_payload init 分支调两个 get_or_issue、payload.platform_config.local_yaml 含明文、**明文不落 lease.metadata_**、actor_user_id 从 lease_meta 解析。

### T11: start_init_dispatch 防回退测试
- 文件：`backend/app/modules/agent/tests/test_start_init_dispatch.py`（修改）
- 覆盖：B1 下 dispatch 不签 token、metadata 不含 local_yaml（防回退到落库写法）。其余 init dispatch 行为零回归。

### T12: local-yaml-writer 单元测试
- 文件：`sillyhub-daemon/tests/test_local_yaml_writer.test.ts`（新增）
- 覆盖：platform 覆盖 / mcp 有才留 / 注释字节保留 / CRLF / 文件不存在创建 / 顶层段边界（不误伤缩进子键）。

### T13: handleInitLease 编排测试
- 文件：`sillyhub-daemon/tests/test_init_lease.test.ts`（修改）
- 覆盖：写 local.yaml 成功（含两段）/ 写失败 handleInitLease 返 ok:false → _finish(false) lease failed / url 用 serverOrigin 不用 payload.server_origin。

## 文档

### T14: 模块文档同步
- 更新 platform_sync / mcp_gateway / agent(init) / daemon 模块文档，记录 get_or_issue + init 下发 local.yaml 行为。
- local.yaml 段注释（如有平台维护的范本）补注"init 自动写入"。
