---
author: qinyi
created_at: 2026-08-12 10:13:52
scale: large
tier: independent
risk_level: integration-critical
status: drafting
---

# 设计文档（Design）— init 自动下发 local.yaml（platform + mcp token）

## 1. 背景

工作区「初始化」按钮目前的语义是：后端 `start_init_dispatch` 派一个 `mode='init'` 的 batch lease，daemon 的 `_runInitLease` 在成员本地写 `.runtime/spec-version.json` + 拉文档缓存（pullSpecBundle）。初始化完成后，成员的"接入初始化状态"徽标变绿。

但初始化完成后，成员要真正用上平台的两个能力还差一步——本地项目目录的 `.sillyspec/local.yaml` 得配上两段：

- **platform 段**（进度同步）：`sillyspec sync` 把变更进度推回平台用的 `shpsync_` token + backend 根 url。
- **mcp 段**（工作区 MCP 接入）：execute 时把 Wave 子代理派发到 SillyHub worker 用的 `shmcp_` token + `/mcp` url。

目前这两段**只能由用户手编**，或手跑跨仓 sillyspec 工具的 `sillyspec platform connect` 命令（用登录级 `shk_live_`/JWT 换发 `shpsync_` 后文本级段替换写入）。这造成两个问题：

1. **多余的手工步骤**：用户点完"初始化"，还得再去命令行跑 connect 或手填 token，体验割裂。
2. **最小权限缺失**：用户倾向直接把手里的全权限 `shk_live_` API Key 填进 platform 段（当前线上 local.yaml 即如此），一旦泄露等于全用户权限暴露；而 `shpsync_`（workspace-scoped、可独立吊销）才是该场景的正确凭证。

## 2. 设计目标

- 点完工作区「初始化」，成员本地 `.sillyspec/local.yaml` 的 `platform:` 和 `mcp:` 两段**自动配好有效 token + 正确 url**，`sillyspec sync` 和工作区 MCP 接入立即可用，无需手跑 connect。
- 下发的 token 是**最小权限形态**（`shpsync_` / `shmcp_`，workspace-scoped），替换掉用户手填的全权限 `shk_live_`。
- 明文 token **只在 lease payload 内存短暂存在**，DB 只存 hash，守住"明文只出现一次"契约（对齐 `provider_config.api_key` 既有模式）。
- init 失败语义清晰：**写 local.yaml 失败 = 整个 init 失败**（lease failed），保证"init 成功 ⟺ 配置全配好"的强契约。

## 3. 非目标（YAGNI）

- **不动 sillyspec 工具仓**：`connect` 命令保持原样，不强行让 init 复用 connect 代码路径。connect 仍是用户主动换发 token 的入口；init 是平台侧权威初始化。两者都写 platform 段、行为一致（覆盖），互不冲突。
- **不做 token 定期 gc 定时任务**：`get_or_issue` 的"吊销旧未吊销 + 签新"已控制堆积；真要后台 gc 留后续 change。
- **不改前端**：init 按钮交互不变，只是后台 lease 多干一步写 local.yaml。前端轮询 `init_synced_at` 的逻辑零改动。
- **不覆盖用户已手填的 mcp 段**：mcp 段"有才留"（对齐 connect R-09），尊重用户手工配置；只有 platform 段是权威覆盖。

## 4. 拆分判断

单一逻辑闭环（token 签发 → lease 下发 → daemon 写盘），跨两个子项目（backend + sillyhub-daemon）。不拆多 change——投影/隔离/token/下发是一个依赖链，拆开割裂。不走批量模式（非"模板×数据"）。规模 = **large**（跨两仓 + token 签发注入 + lease payload 扩展 + daemon 新增 local.yaml 写入路径 + 新测试），tier=independent。

## 5. 总体方案（方案 A）

### 5.1 数据流总览

```
用户点「初始化」
   ▼
POST /api/workspaces/{id}/init
   ▼
AgentService.start_init_dispatch（service.py:1779）
   ├── ensure_spec_workspace（已有）
   ├── resolve_member_binding（已有，拿 daemon_id/root_path/runtime_id）
   ├── 组装 metadata.platform_config（仅 server_origin/strategy，【不含 token】）
   ├── INSERT daemon_task_leases（mode='init'）  # 已有，metadata 不含明文 token
   └── wake daemon（已有）
   ▼
daemon claim lease → build_claim_payload（context.py mode=='init' 分支）
   ├── 【新增】PlatformSyncTokenService.get_or_issue(workspace_id, actor) → 明文 shpsync_（不落库）
   ├── 【新增】McpTokenService.get_or_issue(workspace_id, actor) → 明文 shmcp_（不落库）
   └── 注入 payload.platform_config.local_yaml={platform_token, mcp_token}（url 不下发）
   ▼
daemon _runInitLease（spec-sync.handleInitLease）
   ├── writeDaemonState（.runtime/spec-version.json）  # 已有
   ├── pullSpecBundle（拉文档缓存）                      # 已有
   └── 【新增】writeLocalYaml(rootPath, platformConfig.local_yaml, serverOrigin)
           ├── 读 .sillyspec/local.yaml 原文（不存在则空串）
           ├── platform 段：文本级覆盖（url=serverOrigin, token=platform_token）
           ├── mcp 段：仅在不存在时写入（url=serverOrigin+/mcp, token=mcp_token）
           ├── 写失败 → 抛错 → lease failed（严格契约）
           └── url 由 daemon._serverOrigin()（= config.server_url）拼，不用后端值
```

### 5.2 后端：token 签发（get_or_issue 语义）

两个 token service 现状不对称（Design Grill 审查项 5 发现），`get_or_issue` 实现需分别对待：

- **`McpTokenService`（mcp_gateway/service.py）三件套齐全**：已有 `create(workspace_id, created_by, name, scope)` + `list_for_workspace` + `revoke`。`get_or_issue` 直接复用：list 查旧 → revoke 吊销 → create 签新。

- **`PlatformSyncTokenService`（platform_sync/token_service.py）只有 `create` + `authenticate`，【无 revoke / 无 list_for_workspace】**（已核实 token_service.py 全文）。故 `get_or_issue` 必须**新写**吊销 + 查询逻辑（内联在 get_or_issue 内，或抽出 `_revoke_by_owner`/`_list_active_by_owner` 私有方法，不污染既有 create/authenticate 零回归）：
  1. `select ... WHERE workspace_id=:ws AND created_by=:actor AND revoked_at IS NULL` 查旧。
  2. 命中 → `UPDATE ... SET revoked_at=now WHERE id=:old_id` 吊销（不用新加 public `revoke` 方法，直接内联 UPDATE，因 platform_sync 无别处需 revoke）。
  3. 调既有 `create(*, workspace_id, name, created_by, scope)` 签新 → 返回 `(row, 明文)`。

**为什么不是"真复用明文"**：明文 token 签发后不可恢复（DB 只存 `sha256(明文)`，`token_service.py:66 _token_hash`）。要拿到一个能下发的明文，只能签新。"吊销旧 + 签新"等价于逻辑复用（同维度始终只有一条活 token），同时保证 local.yaml 里的 token 永远有效且最新，不堆积废 token。

**幂等性**：`get_or_issue` 在单次 init 调用内是非幂等的（每次签新）。但 init 本身是用户主动触发的低频操作，重复 init 重复签新可接受（旧的被吊销）。lease 层已有 `kind='batch'` 的 60s claim 窗口防并发重复 claim，但 init lease 重复派单（用户连点）可能产生多次 `get_or_issue`——缓解：前端 `initing` state 已禁用按钮（`workspace-config-card.tsx:420`），且 lease `mode='init'` 可加"同 workspace 已有 pending init lease 则拒绝重复派单"防护（design §7 风险 R-01，列为 P1 任务核实是否已存在该防护）。

### 5.3 后端：token 组装与【不落库】下发（P0 安全关键）

**关键约束**：`daemon_task_leases.metadata_` 是 DB 持久化 JSON 列（`daemon/model.py:183`），且被审计服务读取（`daemon/audit/service.py:74`）。明文 token **绝不能写进 `lease.metadata_`**，否则破坏"明文只出现一次"契约（明文落库 + 可能进审计）。

对比 `claim_token`：它确实落进 metadata（`placement.py:646-652`），但那是**必要特例**——审计服务要拿它做等值匹配鉴权（`meta.get("claim_token") == claim_token`），daemon 后续请求复用同一 token 验证。我们的 `shpsync_`/`shmcp_` 是**写进用户本地文件的外部凭证**，后端事后无需比对，必须更严格：**只进一次性 claim payload，不落 lease.metadata**。

因此签发时机与透传路径调整为 **claim 时现算注入**（不进 dispatch 阶段的 metadata）：

1. **`start_init_dispatch`（service.py:1779）**：在派 lease 前调两个 `get_or_issue` 拿明文，但**不写入 `metadata`**。而是把明文暂存到 lease 行的一个**专用一次性字段** `init_tokens`（新列，或复用既有非审计字段——见 §5.3.1 抉择）。此字段仅用于 claim 时读出注入 payload，claim 完成（lease 离开 pending）后由后端清空。
2. **`build_claim_payload`（context.py mode=='init' 分支）**：claim 时从该一次性字段读出明文，注入 `payload.platform_config.local_yaml` 下发给 daemon。
3. daemon 写盘后，token 落用户本地 local.yaml（本就是明文存储）。

**简化方案（推荐，见 §5.3.1）**：若不想加列，可在 claim 时（`build_claim_payload`）**现场重新 `get_or_issue`**——claim 是 daemon 领单的权威时刻，此时签发 + 立即注入 payload + 不落库，明文只在 claim 请求的内存里。代价：dispatch 时签的 token（若 dispatch 阶段也签）会被 claim 时再签覆盖。所以**只在 claim 阶段签一次**最干净。

### 5.3.1 签发时机抉择

| 方案 | 签发点 | 明文生命周期 | DB 影响 |
|---|---|---|---|
| **B1（推荐）** | `build_claim_payload`（claim 时）现场 `get_or_issue` + 注入 payload，**不进 metadata** | 仅 claim 请求内存 | 只签一次，无孤儿 |
| B2 | dispatch 时签 + 暂存专用一次性列，claim 读出注入后清空 | 暂存列短暂 | 加列 + 清空逻辑 |
| B3（已否决） | dispatch 时签 + 写 `metadata.platform_config.local_yaml` | **落库 + 进审计** ❌ | 破坏契约 |

选 **B1**：claim 是 daemon 真正领单的时刻，此时签发语义最准（lease 真被领走才签），明文不落任何持久化。`start_init_dispatch` 不签 token、不碰 local_yaml 字段，只派 mode='init' lease；`build_claim_payload` 的 init 分支调 `get_or_issue` 拿明文注入 `payload.platform_config.local_yaml`。

**url 仍不下发**：`local_yaml` 子结构只含 `{platform_token, mcp_token}`，url 由 daemon `_serverOrigin()` 拼（理由同 §5.4，local.yaml 给本机 sillyspec 用）。

### 5.4 daemon：写 local.yaml（文本级段替换）

`spec-sync.handleInitLease`（纯函数 + client 注入）在 `writeDaemonState` + `pullSpecBundle` 之后新增 `writeLocalYaml` 步骤。实现要点：

- **文本级段替换**：复制 sillyspec 仓 `sync.js` 的 `replaceTopLevelSection` / `findTopLevelSectionRange` 算法到 daemon（TS 重写）。规则：
  - 只匹配顶层（行首无缩进）的 `platform:` / `mcp:` 段（段 = 从该 key 行到下一个顶层 key 行或文件尾）。
  - 替换段内容，**字节级保留**段外所有内容（注释、其他段、数组、深嵌套、CRLF/LF）。
  - `platform` 段：无条件覆盖为新内容（`url` + `token`，保留段前注释）。
  - `mcp` 段：`findTopLevelSectionRange` 返回 null（不存在）才写入；存在则不动。
  - 文件不存在：创建含两段（+最小注释）的 local.yaml。

- **url 来源**：`platform_url = daemon._serverOrigin()`（`config.server_url.replace(/\/+$/,'')`，`daemon.ts:2169`），`mcp_url = platform_url + '/mcp'`。**不用 payload 里的 `server_origin`**——因为 local.yaml 给 sillyspec 工具用（在用户本机跑），必须用本机能 reach 的地址，daemon 的 `server_url` 正是此值；后端 `SERVER_ORIGIN` 在 docker/远程部署时可能与本机可达地址不一致。

- **失败语义**：对齐 `handleInitLease` 现有「逐步 try/catch 返回 `ok:false`/`ok:true`」模型（`spec-sync.ts:903-970`，不向上抛）。`writeLocalYaml` 作为 `handleInitLease` 第 4 步，失败时 try/catch 返回 `ok:false`（同 `writeDaemonState` 硬失败 abort 范式），`_runInitLease`（`task-runner.ts:833-918`，无顶层 try/catch）据 `result.ok===false` 走 `_finish(false)` → lease 标 failed。**严格契约**：写盘失败 = init 失败。此时 token 已签发入库（成为孤儿 hash 行），但下次 init 会吊销它再签新（`get_or_issue`），不永久堆积。

### 5.5 与 connect 的冲突边界

| 场景 | 行为 |
|---|---|
| 先 init 后 connect | connect 用登录 token 换发新 `shpsync_` 覆盖 platform 段（`sync.js:308`），正常 |
| 先 connect 后 init | init 覆盖 platform 段（权威初始化），正常 |
| mcp 段 | init 与 connect 都是"有才留"，一致 |

两写入方行为对齐，无冲突。connect 的 `replaceTopLevelSection` 与 init 复制的同款算法一致，段边界判定不会因写入方不同而漂移。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/platform_sync/token_service.py` | 新增 `get_or_issue(*, workspace_id, created_by)`：**内联** select 旧未吊销 + UPDATE 吊销（该 service 无既有 revoke/list，不新增 public 方法，零回归）+ 调既有 `create`。producer=本方法 → consumer=lease/context.py build_claim_payload（claim 时调，明文不落库） |
| 修改 | `backend/app/modules/mcp_gateway/service.py` | 新增 `get_or_issue(*, workspace_id, created_by)`：复用既有 `list_for_workspace`/`revoke`/`create`（三件套齐全）。producer=本方法 → consumer=build_claim_payload |
| 修改 | `backend/app/modules/daemon/lease/context.py` | `build_claim_payload` 的 mode=='init' 分支（:579）：claim 时调两个 `get_or_issue` 拿明文，注入 `payload.platform_config.local_yaml={platform_token,mcp_token}`（不写 lease.metadata）。producer=build_claim_payload → daemon payload → consumer=daemon _runInitLease |
| 修改 | `backend/app/modules/agent/service.py` | `start_init_dispatch`（:1779）：**不签 token、不写 local_yaml 到 metadata**（B1：签发移到 claim）。仅注释说明 token 在 claim 时签。零行为改动 |
| 新增 | `sillyhub-daemon/src/local-yaml-writer.ts` | `replaceTopLevelSection` / `findTopLevelSectionRange` / `writeLocalYaml`（TS，复制 sillyspec 仓 sync.js 算法）。producer=handleInitLease 传入 token+serverOrigin → 写 `<rootPath>/.sillyspec/local.yaml` |
| 修改 | `sillyhub-daemon/src/spec-sync.ts` | `handleInitLease` 在 writeDaemonState + pullSpecBundle 后调 `writeLocalYaml`；读 `platformConfig.local_yaml`（:869 附近 daemon state 之外新增）。producer=payload.platformConfig.local_yaml → consumer=local-yaml-writer |
| 新增 | `backend/app/modules/platform_sync/tests/test_get_or_issue.py` | get_or_issue：空则签新 / 有旧则吊销+签新 / 多次调用不堆积 |
| 新增 | `backend/app/modules/mcp_gateway/tests/test_get_or_issue.py` | 同上 |
| 新增 | `backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py` | **claim/context 测试**（B1：dispatch 不签 token）：build_claim_payload 的 mode=='init' 分支调两个 get_or_issue、注入 payload.platform_config.local_yaml 含明文、明文不落 lease.metadata、get_or_issue 复用旧 token 时吊销旧签新 |
| 修改 | `backend/app/modules/agent/tests/test_start_init_dispatch.py` | B1 下 dispatch 不签 token、metadata 不含 local_yaml——断言这一点（防回退到落库写法），其余 init dispatch 行为零回归 |
| 新增 | `sillyhub-daemon/tests/test_local_yaml_writer.test.ts` | 段替换：platform 覆盖 / mcp 有才留 / 注释字节保留 / CRLF / 文件不存在创建 |
| 修改 | `sillyhub-daemon/tests/test_init_lease.test.ts` | handleInitLease 编排：写 local.yaml 成功 / 写失败 lease failed / url 用 serverOrigin |

## 7. 接口定义

### 7.1 后端 service 方法

两个 service 构造器都必填 `settings`（`PlatformSyncTokenService(db, *, settings)` / `McpTokenService(db, *, settings)`），`create` 都必填 `name`。`get_or_issue` 内部 `name` 用固定语义值（如 `"init-provisioned"`）。`scope`：platform 用 `None`（token_service.create 的 `scope: dict | None = None` 默认）；mcp 用 `['dispatch']`（**必须取 `MCP_SCOPES` 合法值** `read`/`dispatch`/`converge`，见 `mcp_gateway/auth.py:44` + `router.py:46 Literal` 收口；execute 派 Wave 子代理正是 dispatch 语义，故选 dispatch；read/converge 按需后续扩展）。**不可用 `['workspace']`**——非合法 scope，get_or_issue 绕过 router 直接调 create 不会被 Literal 收口，会持久化废 token 导致 dispatch 鉴权失败。

```python
# PlatformSyncTokenService —— 无既有 revoke/list，get_or_issue 内联实现
async def get_or_issue(
    self, *, workspace_id: uuid.UUID, created_by: uuid.UUID,
) -> tuple[PlatformSyncTokenORM, str]:
    """1) select 旧未吊销(ws,created_by) → 2) 命中则 UPDATE revoked_at=now 内联吊销
    → 3) 调 self.create(workspace_id, name='init-provisioned', created_by, scope=None)
    返回 (新 row, 明文)。明文仅本次返回，调用方立即注入 payload 后丢弃。"""

# McpTokenService —— 三件套齐全，直接复用
async def get_or_issue(
    self, *, workspace_id: uuid.UUID, created_by: uuid.UUID,
) -> tuple[McpTokenORM, str]:
    """1) self.list_for_workspace 查旧 → 2) self.revoke 吊销命中行
    → 3) self.create(workspace_id, created_by, name='init-provisioned', scope=['dispatch'])
    返回 (新 row, 明文)。scope 必须是 MCP_SCOPES 合法值（read/dispatch/converge，auth.py:44）。"""
```

调用方（build_claim_payload init 分支）：
```python
from app.core.config import get_settings
settings = get_settings()
_, shpsync_plain = await PlatformSyncTokenService(session, settings=settings).get_or_issue(
    workspace_id=ws_id, created_by=actor_user_id)
_, shmcp_plain = await McpTokenService(session, settings=settings).get_or_issue(
    workspace_id=ws_id, created_by=actor_user_id)
```

### 7.2 claim payload 子结构（B1：claim 时注入，不落 lease.metadata）

```python
# build_claim_payload 的 mode=='init' 分支（claim 时执行，不写 DB）：
_, shpsync_plain = await PlatformSyncTokenService(session).get_or_issue(
    workspace_id=ws_id, created_by=actor_user_id)
_, shmcp_plain = await McpTokenService(session).get_or_issue(
    workspace_id=ws_id, created_by=actor_user_id)

payload["platform_config"] = {
    "server_origin": ...,        # 已有（spec_version 保鲜用，非 local.yaml 消费）
    "strategy": ...,             # 已有
    "local_yaml": {              # 新增，claim 时现算注入
        "platform_token": shpsync_plain,
        "mcp_token": shmcp_plain,
    },
}
# daemon 端 ctx.platformConfig.local_yaml.{platform_token, mcp_token}
# actor_user_id 解析：init lease 无 agent_run，从 lease.metadata.actor_user_id（dispatch 时已写，非敏感）取
```

### 7.3 daemon 端函数

```typescript
// local-yaml-writer.ts
export function findTopLevelSectionRange(text: string, key: string): {start:number;end:number} | null;
export function replaceTopLevelSection(text: string, key: string, entries: string | null): string;
export async function writeLocalYaml(
  rootPath: string,
  local: { platform_token: string; mcp_token: string },
  serverOrigin: string,
): Promise<void>; // 失败抛错，由 handleInitLease 第4步 try/catch 转成 ok:false → _finish(false) lease failed
```

## 8. 生命周期契约表

本变更涉及 lease / daemon / complete 关键词，补契约表：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| dispatch init lease | backend start_init_dispatch | DB daemon_task_leases | mode='init', platform_config{server_origin,strategy}（**不含 token**）, workspace_id, actor_user_id, root_path | (无 lease) → pending |
| claim lease | daemon | backend | leaseId, claimToken | pending → claimed |
| build_claim_payload（claim 时签 token） | backend | daemon(payload) | get_or_issue 现算 → platformConfig.local_yaml{platform_token,mcp_token} 注入（不落库） | — |
| init 执行（writeDaemonState/pullSpecBundle/writeLocalYaml） | daemon | 本地文件系统 | rootPath, local_yaml tokens, serverOrigin | — |
| complete lease（成功） | daemon | backend | leaseId, claimToken, result.ok | claimed → completed + 回写 init_synced_at |
| complete lease（写 local.yaml 失败） | daemon | backend | leaseId, claimToken, result.error | claimed → failed（init_synced_at 不回写） |

## 9. 安全考量

- **明文 token 不落 lease.metadata（P0，已采纳 B1）**：`daemon_task_leases.metadata_` 是 DB 持久化 JSON 列（`daemon/model.py:183`）且被审计服务读取（`audit/service.py:74`）。`shpsync_`/`shmcp_` 明文**只在 claim 时 `build_claim_payload` 现算注入 payload**（内存），不写 `lease.metadata`。对比 `claim_token` 落库是必要特例（审计需等值匹配鉴权），本变更 token 无此后置比对需求，必须更严格。
- DB 两 token 表只存 hash（`token_hash = sha256(明文)`），明文不可恢复。
- 下发的 `shpsync_`/`shmcp_` 是 workspace-scoped 最小权限，泄露仅影响单 workspace，可独立吊销。
- daemon 写盘后明文落用户本地 local.yaml（本就是明文存储，与手编一致；文件权限由用户 OS 控制）。

## 10. 风险登记

| ID | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R-01 | 用户连点 init / lease 重复 claim → 多次 get_or_issue | P1 | 前端 initing 已禁按钮；claim 有 FOR UPDATE 锁（lease/service.py:158）防并发；重复签的旧 token 被 get_or_issue 吊销，不永久堆积 |
| R-02 | ~~明文 token 写进 lease.metadata~~ | ✅ 已解决 | 采纳 B1：claim 时现算注入 payload，不落库（§5.3.1） |
| R-03 | daemon 段替换算法与 sillyspec sync.js 漂移 | P2 | 复制时逐测试对齐（含 CRLF/注释/深嵌套）；注释标注来源行号 |
| R-04 | init 写 platform 段覆盖了用户故意填的特殊 token | P2 | 产品决策已定 platform 权威覆盖；用户特殊需求应走 connect，不靠 init |
| R-05 | daemon 在 rootPath 无写权限 → lease failed 体验重 | P2 | 严格契约已拍板；错误信息明确指向 local.yaml 写权限 |
| R-06 | claim 时 get_or_issue 签发成功但 daemon 写盘失败 → token 成孤儿 | P2 | 下次 init 的 get_or_issue 会吊销它；不阻塞本次 lease failed 语义 |

## 11. 决策记录

- **D-001**：token "复用" = 吊销旧未吊销 + 签新（非真复用明文，因明文不可恢复）。等价逻辑复用，不堆积。
- **D-002**：url 由 daemon 端 `_serverOrigin()` 定，后端不下发。理由：local.yaml 给本机 sillyspec 用，需本机可达地址。
- **D-003**：写 local.yaml 失败 = init 整体失败（严格契约）。强保证"init 成功 ⟺ 配置全配好"。
- **D-004**：platform 段覆盖、mcp 段有才留（对齐 connect R-09，尊重用户手工 mcp 配置）。
- **D-005**：不动 sillyspec 工具仓；connect 与 init 并存，行为对齐无冲突。

## 12. 自审（Self-Review）

本 design 经设计者自审 + 独立子代理 Design Grill 两轮审查，逐项确认：

- **§5 方案可行性**：方案 A（init 派单 → claim 时签 token 注入 payload → daemon 写盘）经 Design Grill 终审 pass。B1 抉择（claim 时现算、不落 lease.metadata）经核实 `daemon_task_leases.metadata_` 是持久化 JSON + 进审计（audit/service.py:74），明文必须避开此列。
- **§5.2 get_or_issue**：首轮自审误把 `PlatformSyncTokenService.revoke` 当既有方法，Design Grill 审查项 5 拦截（该 service 实际只有 create+authenticate）。已修正为内联 select+UPDATE 吊销，McpTokenService 复用三件套。
- **§5.4 失败语义**：首轮误写"抛错上抛顶层 catch"，Design Grill 审查项 8 指出 handleInitLease 是逐步 catch 返 ok:false 模型。已修正为第 4 步 try/catch 返 ok:false → _finish(false)，与现有代码一致。
- **§7.1 scope**：Design Grill 终审发现 mcp scope=['workspace'] 非法（MCP_SCOPES={read,dispatch,converge}），已采纳改 ['dispatch']。
- **§8 生命周期契约表**：覆盖 dispatch/claim/build_payload/execute/complete 成功+失败五事件，必需字段在 §7.2 payload 与 §5.1 数据流均有对应，闭合。
- **§10 风险登记**：R-01~R-06 真实，R-02（P0 明文落库）已通过 B1 解决，其余缓解有效。

**自审结论**：design 内部无结构性矛盾，文件清单/接口签名/数据流/契约表四者一致，可进入 plan 阶段细化 Wave 与依赖。
