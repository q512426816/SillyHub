---
author: qinyi
created_at: 2026-08-12 10:13:52
---
# 决策记录（Decisions）

## D-001: token "复用" = 吊销旧未吊销 + 签新

**决策**：get_or_issue 的"复用"语义是查到同 (workspace_id, created_by) 维度未吊销 token 就吊销它（revoked_at=now）+ 签发新 token 返回明文，不是真正复用明文。

**理由**：明文 token 签发后不可恢复（DB 只存 `sha256(明文)`，`token_service.py:_token_hash`）。要拿到能下发的明文只能签新。"吊销旧+签新"等价逻辑复用（同维度始终一条活 token），同时保证 local.yaml 里的 token 永远有效最新，不堆积废 token。

**实现差异**（Design Grill 审查项 5 发现）：
- `McpTokenService`（mcp_gateway/service.py）三件套齐全（create/list_for_workspace/revoke），get_or_issue 直接复用。
- `PlatformSyncTokenService`（platform_sync/token_service.py）**只有 create+authenticate，无 revoke/list**。get_or_issue 必须**内联** select 旧未吊销 + UPDATE revoked_at=now 吊销（不新增 public revoke 方法，避免污染既有接口，零回归）+ 调既有 create。

## D-002: 明文 token 不落 lease.metadata（P0 安全），claim 时现算注入

**决策**：token 在 `build_claim_payload` 的 mode=='init' 分支（claim 时）现场 get_or_issue + 注入 payload，**不写 lease.metadata_**。url 不下发，由 daemon 端 `config.server_url` 拼。

**理由**：`daemon_task_leases.metadata_` 是 DB 持久化 JSON 列（daemon/model.py:183）且被审计服务读取（audit/service.py:74）。明文落库破坏"明文只出现一次"契约。对比 claim_token 落库是必要特例（审计需等值匹配鉴权 audit/service.py:75），本 token 无后置比对需求，必须更严格。

**url 由 daemon 定**：local.yaml 给 sillyspec 工具用（本机跑），需本机可达地址；daemon `config.server_url` 正是此值。后端 `SERVER_ORIGIN` 在 docker/远程部署时可能与本机可达地址不一致，故不下发。

## D-003: 写 local.yaml 失败 = init 整体失败（严格契约）

**决策**：writeLocalYaml 失败时 handleInitLease 第 4 步 try/catch 返回 ok:false（同 writeDaemonState 范式），_runInitLease 据 result.ok===false 走 _finish(false)，lease 标 failed。

**理由**：强保证"init 成功 ⟺ 配置全配好"，避免出现"显示已初始化但 local.yaml 没配上、后续 sync 静默失败让用户困惑"。对齐 handleInitLease 现有"逐步 catch 返回 ok:false/true"模型（不向上抛，spec-sync.ts:903-970），不引入新的"抛错顶层 catch"路径。

**代价**：token 已签发入库但 init 失败 → 孤儿 hash 行。缓解：下次 init 的 get_or_issue 会吊销它（D-001），不永久堆积（R-06）。

## D-004: platform 段覆盖、mcp 段有才留

**决策**：init 写 local.yaml 时，platform 段无条件权威覆盖；mcp 段仅在不存在时写入，已存在则保留。

**理由**：init 是平台侧权威初始化，platform 同步配置以平台签发的 shpsync_ 为准（替换用户手填的全权限 shk_live_）。mcp 段对齐 sillyspec connect 的 R-09 行为（有才留），尊重用户手工配置；两者写入行为一致，无冲突。

## D-005: 不动 sillyspec 工具仓，connect 与 init 并存

**决策**：不修改 `~/IdeaProjects/sillyspec/` 任何文件；connect 命令保持原样。

**理由**：connect 是用户主动换发 token 的入口，init 是平台侧权威初始化，职责不同。两者都写 platform 段（覆盖）、mcp 段（有才留），行为对齐，互不冲突（先 init 后 connect / 先 connect 后 init 均正常）。强行让 init 复用 connect 代码路径会引入跨仓耦合，无收益。
