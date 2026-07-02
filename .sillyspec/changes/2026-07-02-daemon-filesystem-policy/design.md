---
author: WhaleFall
created_at: 2026-07-02T14:58:00
change: 2026-07-02-daemon-filesystem-policy
---

# Design: 重构 Daemon Runtime 文件系统权限控制（Filesystem Policy Engine）

## 1. 背景

当前 Daemon Runtime 的文件写权限控制（`allowed_roots`）由 `2026-06-29-runtime-allowed-roots-config` 引入，但存在三类问题：

### 1.1 权限校验散落、不统一
现有 3 套独立的文件权限层，互不通信：
- **backend `DaemonRuntime.allowed_roots`**（`backend/app/modules/daemon/model.py:89-92`）：per-runtime 持久化，心跳响应下发。
- **backend `tool_gateway.tool_policy.allowed_paths`**（`tool_policy.py:77-80`）：per-workspace 工具策略，相对路径，语义不同。
- **daemon `write-guard.ts`**（`sillyhub-daemon/src/interactive/write-guard.ts`）：interactive CC session 的 canUseTool 回调层写白名单。

4 条 Tool 注入路径各异：
| 模式 | 注入方式 | 文件 |
|---|---|---|
| Claude batch | CC `--settings` permission rules | `stream-json.ts:307` |
| Claude interactive | canUseTool 回调 + write-guard | `session-manager.ts:822` |
| **Codex batch** | **无注入（完全无沙箱）** | `json-rpc.ts:128` |
| Codex interactive | canUseTool 回调 | `session-manager.ts:743` |

### 1.2 大量写入口绕过
`write-guard.ts` 仅正则解析 **Bash** 写命令（`>/>>/cp/mv/tee/mkdir/touch`）。以下全部绕过：
- **PowerShell**（`Set-Content/Add-Content/Out-File/New-Item/Copy-Item/Move-Item/Remove-Item`）：`write-guard.ts` 全文无 PowerShell 关键字，全放行。
- **CMD**（`copy/move/mkdir/echo >/del`）：同上。
- **Python/Node 脚本内部**（`open("...","w")` / `fs.writeFile`）：孙进程系统调用，用户态进程看不到。

### 1.3 daemon 取并集，丢失 per-runtime 隔离
`daemon.ts:1682-1704` `_syncAllowedRoots` 把所有 runtime 的 allowed_roots **取并集**塞进全局 `config.allowed_roots`，所有 session 共用。claude runtime 和 codex runtime 的可写目录混在一起，违背 per-runtime 隔离意图。

### 1.4 配置生效有盲区
- interactive session：`allowedRootsProvider()` 实时读，已即时生效。
- batch 任务：spawn 时 `--settings` 一次性注入，**冻结至任务结束**（`task-runner.ts:461`）。
- 传播靠 15s 心跳轮询，无 WS push，"立即生效"实际有 ~15s 延迟。

## 2. 设计目标

把 Daemon Runtime 升级为**平台唯一可信的 Filesystem Policy Engine**：
- 所有 Tool 层写入口经统一 `PolicyEngine` 校验，agent 无法通过切换 Tool 绕过。
- 按 runtime 隔离（`Map<runtime_id, RuntimePolicy>`），各 runtime（=各 agent 种类/provider）独立策略。
- 配置热更新：WS push `POLICY_UPDATE` sub-second 生效 + 心跳兜底。
- 路径规范化防绕过（`..`/symlink/junction/UNC）。
- 全量 audit（ALLOW+DENY）回传 backend，前端审计页供平台用户查看。
- 统一中文错误提示。

## 3. 非目标

- **不做 OS 级进程沙箱**（D-001）：Python/Node 脚本内部 `open()`/`fs.write` 不硬拦，靠 prompt 约束 + audit 追溯。OS 沙箱（Seatbelt/AppArmor/sandbox-exec）作为后续独立变更。
- **不防 8.3 短名绕过**（D-005）：需 Windows 原生 API（`GetLongPathName`），Node 无内置，后续独立变更。
- **不改 backend `DaemonRuntime` 模型**（D-002）：allowed_roots 已 per-runtime，无需新增 Agent 级别字段（项目无独立 Agent 实体）。
- **不杀在跑 batch 任务**（D-003）：前端改 allowed_roots 后，正在跑的 batch 保持旧配置至跑完，不中断。
- **不限制读**：canRead 默认全允许，仅预留接口。
- **不动 `tool_gateway.tool_policy.allowed_paths`**：它是 per-workspace 工具策略（不同概念），本次不收敛它，仅收敛 daemon 侧三套写权限。

## 4. 拆分判断

单一内聚的权限引擎重构，非批量重复任务。涉及 daemon（主）+ backend（配置源/热更新协议/audit 落库）+ frontend（审计页），同属一个架构变更，任务数可控（~10 个），无需拆分多变更、不走批量模式。

## 5. 总体方案（方案 A：daemon 内统一 PolicyEngine）

```
┌──────────────── daemon 进程 ────────────────────────────────┐
│  Tool 入口层                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │interactive│ │batch     │ │file-rpc  │ │shell命令 │         │
│  │canUseTool │ │spawn注入 │ │list_dir  │ │解析器    │         │
│  └─────┬────┘ └─────┬────┘ └─────┬────┘ └─────┬────┘         │
│        └──────────┬─┴──────────┴──────────┘                  │
│                   ▼                                           │
│          ┌─────────────────┐                                  │
│          │  PolicyEngine   │  ← daemon 内唯一权限中心          │
│          │ canWrite/canRead│                                  │
│          └────────┬────────┘                                  │
│     ┌─────────────┼─────────────┐                              │
│     ▼             ▼             ▼                              │
│  path-utils   PolicyCache    AuditSink                        │
│  规范化        Map<rid,RP>    批量回传                         │
└──────────────────┬──────────────────────────────────────────┘
                   │ WS push POLICY_UPDATE + audit 批量上报
                   ▼
┌──────────── backend ────────────┐
│ DaemonRuntime.allowed_roots(不改)│
│ PolicyAuditLog 表(新增)          │
│ ws_hub.send_policy_update(新增)  │
│ /daemon/audit/batch(新增)        │
│ /workspaces/.../audit(新增)      │
└──────────────────────────────────┘
```

### 5.1 daemon 侧 — Policy 模块（新增 `sillyhub-daemon/src/policy/`）

#### 5.1.1 `policy/path-utils.ts` — 路径规范化纯函数
- `normalizePath(raw)`: strip 引号 → git bash `/x/`→`X:/` → `pathResolve` 折叠 `..`。
- `resolveRealPath(p)`: 存在则 `fs.realpathSync.native` 解析 symlink/junction；不存在则 realpath 父目录 + 拼文件名；Windows 大小写归一；**拒 UNC**（`\\server\share` 开头直接 deny）。
- `isPathUnderAnyRoot(target, roots)`: 边界敏感前缀比较（沿用 `write-guard.ts:44` 现有逻辑，含 ql-20260702-007 盘符根修复）。

#### 5.1.2 `policy/runtime-policy.ts` — PolicyCache + RuntimePolicy
```typescript
interface RuntimePolicy {
  allowedRoots: string[];  // 已规范化（realpath + 大小写归一）
  version: number;          // 单调递增，用于 WS push 去重
}
class PolicyCache {
  private map = new Map<string /*runtime_id*/, RuntimePolicy>();
  get(rid: string): RuntimePolicy | undefined;
  set(rid: string, roots: string[]): void;   // 规范化后存
  reload(rid: string, roots: string[]): void; // = set
  reloadAll(): void;                           // 从心跳全量刷
}
```
**替代 `daemon.ts:1682` 并集逻辑**——不再并集，每 runtime 独立存。

#### 5.1.3 `policy/filesystem-policy.ts` — PolicyEngine 核心
```typescript
interface PolicyDecision {
  allowed: boolean;
  reason: string;           // deny 时的中文理由
  normalizedPath: string;
}
class PolicyEngine {
  constructor(private cache: PolicyCache, private auditSink: AuditSink) {}
  canRead(runtimeId: string, path: string): PolicyDecision;        // 默认全 allow
  canWrite(runtimeId: string, path: string): PolicyDecision;
  canCreate(runtimeId: string, path: string): PolicyDecision;      // = canWrite
  canDelete(runtimeId: string, path: string): PolicyDecision;      // = canWrite
  canRename(runtimeId: string, oldPath: string, newPath: string): PolicyDecision; // 两者皆需 allow
}
```
内部流程：`path-utils.resolveRealPath` → `cache.get(rid)` → `isPathUnderAnyRoot` → 产出 decision → `auditSink.record(event)`。

#### 5.1.4 `policy/shell-paths.ts` — Shell 命令写路径提取器
- **Bash**（迁入 + 保留现有 `extractBashWritePaths`）：`>/>>/cp/mv/install/tee/mkdir/touch`。
- **PowerShell**（新增）：`Set-Content/Add-Content/Out-File/New-Item(-ItemType File)/Copy-Item/Move-Item/Rename-Item/Remove-Item`，取 `-Path`/`-Destination`/`-Target` 参数或位置参数。
- **CMD**（新增）：`copy/move/mkdir/echo >/type >/del`。
- 正则解析（尽力而为；不可解析的复杂命令 `eval`/变量展开，靠 D-001 audit 追溯兜底）。
- 返回 `string[]` 写路径，交 PolicyEngine 逐条 `canWrite`。

#### 5.1.5 `policy/audit-sink.ts` — Audit 批量上报
```typescript
interface AuditEvent {
  decision: 'ALLOW' | 'DENY';
  runtimeId: string;
  provider: string;   // agent 种类
  tool: string;       // Write/Edit/Bash/PowerShell/CMD/list_dir/...
  path: string;       // 规范化后
  reason: string;     // deny 理由
  ts: number;
}
class AuditSink {
  private buffer: AuditEvent[] = [];
  constructor(private client: HubClient, private opts: { maxSize: number; flushIntervalMs: number }) {}
  record(e: AuditEvent): void;        // 入 buffer，满或定时 flush
  flush(): Promise<void>;              // POST /daemon/audit/batch
}
```
- 攒批：maxSize（如 100 条）或 flushIntervalMs（如 5s）触发 flush。
- 限流：失败重试指数退避，连续失败降级到本地文件 `~/.sillyhub/daemon/audit-failed.jsonl` 防 OOM。
- **batch spawn 注入的 allowed_roots 也走 audit**：batch 任务结束时把 CC 自身报的 permission deny 日志解析后补录（best-effort）。

### 5.2 daemon 侧 — 各 Tool 接入点改造

| 接入点 | 现状 | 改造 |
|---|---|---|
| interactive canUseTool（`session-manager.ts:822`） | `allowedRootsProvider()` 全局并集 + `write-guard.ts` | 改调 `PolicyEngine.canWrite(session.runtimeId, path)`；write-guard.ts 逻辑迁入 PolicyEngine，文件删除 |
| batch spawn Claude（`task-runner.ts:454` + `stream-json.ts:307` + `permission-rules.ts`） | 全局 `config.allowed_roots` 快照生成 CC `--settings` | 改用 `PolicyCache.get(task.runtimeId)` 快照生成；permission-rules.ts 改调 PolicyEngine 生成 rules |
| **batch spawn Codex**（`json-rpc.ts:128` + `task-runner.ts`） | **无注入**，batch 路径 `APPROVAL_RESPONSES`（`json-rpc.ts:49`）自动 `accept` 跳过审批 | **新增**：batch 路径接入 Codex 带内审批协议（`item/fileChange/requestApproval` / `item/commandExecution/requestApproval`），不再自动 accept，改由 PolicyEngine 决策 accept/decline（decline 时附中文理由）；命令类审批走 shell-paths 提取写路径后校验 |
| file-rpc list_dir（`daemon.ts:1878` / `file-rpc.ts`） | `assertWithinAllowedRoots` 读全局 config | 改调 `PolicyEngine.canRead(rpc.runtimeId, path)` |
| Shell 命令（Bash/PowerShell/CMD tool 调用） | 仅 Bash 正则 | 统一走 `shell-paths.ts` 提取 + `PolicyEngine.canWrite` |

**runtimeId 透传**：interactive session 创建时已知 `runtimeId`（session 归属 runtime）；batch lease payload 含 `runtime_id`（`types.ts` LeaseCtx）；file-rpc RPC 携带发起 runtime 的 id。现有数据流已含 runtime_id，无需新增透传链路。

### 5.3 热更新链路（D-003 + D-004）

```
前端 PATCH /runtimes/{id}/allowed-roots
  → backend 更新 DaemonRuntime.allowed_roots (DB)
  → ws_hub.send_policy_update(rid, roots)   ← 新增 WS push
  → daemon ws-client 收 POLICY_UPDATE
  → PolicyCache.set(rid, roots)             ← sub-second 生效
  → interactive: 下次 tool 调用实时读 → 立即生效
  → batch(在跑): --settings 冻结, 跑完为止
  → batch(新起): spawn 时读 PolicyCache 最新值
心跳 15s 兜底（防 WS 断线丢消息，全量 reloadAll）
```

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/policy/path-utils.ts` | 路径规范化（normalize+realpath+大小写+拒UNC） |
| 新增 | `sillyhub-daemon/src/policy/runtime-policy.ts` | RuntimePolicy + PolicyCache（Map<rid,RP>） |
| 新增 | `sillyhub-daemon/src/policy/filesystem-policy.ts` | PolicyEngine 核心（canWrite/canRead 等） |
| 新增 | `sillyhub-daemon/src/policy/shell-paths.ts` | Shell 命令写路径提取（Bash+PowerShell+CMD） |
| 新增 | `sillyhub-daemon/src/policy/audit-sink.ts` | Audit 批量上报 + 限流 + 失败落盘 |
| 修改 | `sillyhub-daemon/src/interactive/session-manager.ts` | `_wrapWithWriteGuard` 改调 PolicyEngine（带 runtimeId） |
| 删除 | `sillyhub-daemon/src/interactive/write-guard.ts` | 逻辑迁入 policy/，删除 |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | batch spawn 改用 PolicyCache.get(rid) 快照 |
| 修改 | `sillyhub-daemon/src/adapters/stream-json.ts` | buildArgs 改调 PolicyEngine 生成 CC settings |
| 修改 | `sillyhub-daemon/src/adapters/json-rpc.ts` | buildArgs 新增 allowedRoots 参数（Codex batch 沙箱） |
| 修改 | `sillyhub-daemon/src/permission-rules.ts` | 改调 PolicyEngine 生成 rules |
| 修改 | `sillyhub-daemon/src/daemon.ts` | `_syncAllowedRoots` 改写 PolicyCache（去并集）；新增 POLICY_UPDATE 消息处理；构造 PolicyEngine 注入各接入点 |
| 修改 | `sillyhub-daemon/src/ws-client.ts` | 监听 POLICY_UPDATE 消息 |
| 修改 | `sillyhub-daemon/src/file-rpc.ts`（或 daemon.ts list_dir） | 改调 PolicyEngine.canRead |
| 修改 | `sillyhub-daemon/src/cli.ts` | 构造 PolicyEngine/AuditSink/PolicyCache 并注入 Daemon |
| 新增 | `sillyhub-daemon/src/policy/__tests__/*.test.ts` | path-utils/shell-paths/PolicyEngine/PolicyCache 单测 |
| 修改 | `backend/app/modules/daemon/protocol.py` | 新增 POLICY_UPDATE 消息类型 + payload |
| 修改 | `backend/app/modules/daemon/ws_hub.py` | 新增 `send_policy_update(rid, roots)` |
| 修改 | `backend/app/modules/daemon/router.py` | PATCH allowed-roots 端点改完 DB 后触发 ws_hub push |
| 新增 | `backend/app/modules/daemon/audit/` | PolicyAuditLog model + service + router |
| 新增 | `backend/app/modules/daemon/audit/model.py` | PolicyAuditLog 表 |
| 新增 | `backend/migrations/versions/20260702*_policy_audit_log.py` | 建表迁移 |
| 修改 | `backend/app/modules/daemon/router.py` | 新增 `POST /daemon/audit/batch` + `GET /workspaces/{wid}/runtimes/{rid}/audit` |
| 新增 | `frontend/src/app/(dashboard)/runtimes/[id]/audit/page.tsx` | 审计页 |
| 新增 | `frontend/src/lib/daemon-audit.ts` | 审计 API client |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | runtime 卡片加「审计日志」入口 |
| 新增 | `prototype-policy-audit.html` | 审计页线框原型（已生成） |

## 7. 接口定义

### 7.1 daemon PolicyEngine（见 5.1.3）
### 7.2 WS 协议新增消息
```python
# backend protocol.py
class PolicyUpdatePayload(BaseModel):
    runtime_id: str
    allowed_roots: list[str]
    version: int
# 消息类型: daemon:policy_update
```
### 7.3 backend 新增端点
| 端点 | 方法 | 说明 |
|---|---|---|
| `POST /daemon/audit/batch` | POST | daemon 批量上报 AuditEvent[]（claim_token 鉴权） |
| `GET /workspaces/{wid}/runtimes/{rid}/policy-audit` | GET | 前端查审计记录（分页 + 筛选 decision/provider/tool/path/time） |
### 7.4 PolicyAuditLog 表
```python
class PolicyAuditLog(BaseModel):
    id: int | None = Field(primary_key=True)
    runtime_id: str = Field(foreign_key="daemon_runtimes.id", index=True)
    workspace_id: int | None = Field(index=True)  # 从 runtime 反查，便于按 workspace 筛
    decision: str  # "ALLOW" | "DENY"
    provider: str  # "claude" | "codex" | ...
    tool: str
    path: str
    reason: str
    created_at: datetime = Field(default_factory=...)
    # 索引: (runtime_id, created_at desc), (decision)
```

## 7.5 生命周期契约表

本次涉及关键词：session / lease / daemon / heartbeat / lifecycle（policy 热更新与 runtime 生命周期绑定）。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| policy_update (WS push) | backend | daemon | runtime_id, allowed_roots, version | PolicyCache[rid] 更新，version 递增 |
| heartbeat (含 allowed_roots) | daemon | backend | runtime_id, status | backend 响应带 allowed_roots（兜底同步） |
| audit_batch | daemon | backend | runtime_id, events[]{decision,provider,tool,path,reason,ts} | 落 PolicyAuditLog |
| canUseTool (interactive) | CC/Codex SDK | daemon PolicyEngine | runtime_id, toolName, toolInput | ALLOW→执行 / DENY→返回中文错误 |
| batch spawn | daemon TaskRunner | CC/Codex 子进程 | runtime_id, allowed_roots(快照) | 子进程 --settings 注入，冻结至任务结束 |
| batch task end | daemon | backend | leaseId, claimToken, agentRunId | running → completed（在跑 batch 的旧 policy 随之失效） |

**必需字段与 DTO 对应**：
- `runtime_id`：已存在于 LeaseCtx（`types.ts:231`）、AgentSession（`model.py:390`）、heartbeat 协议。
- `allowed_roots`：已存在于 `DaemonRuntime.allowed_roots`、heartbeat response、`PolicyUpdatePayload`（新增）。
- `version`：`RuntimePolicy.version`（新增）+ `PolicyUpdatePayload.version`。
- audit events 字段：`AuditEvent`（daemon TS）↔ `PolicyAuditLog`（backend model）字段一一对应。

## 8. 数据模型

- **不改** `DaemonRuntime.allowed_roots`（已 per-runtime JSONB）。
- **新增** `PolicyAuditLog` 表（见 7.4）+ 迁移。
- **新增** daemon 侧 `RuntimePolicy` / `PolicyCache`（内存，不持久化，靠 backend + 心跳重建）。

## 9. 兼容策略（brownfield）

- **未配置 allowed_roots 的 runtime**：沿用默认 `["~/.sillyhub"]`，PolicyCache 未命中时 fallback homedir 兜底（沿用 `daemon.ts:1703` 现有兜底）。
- **旧 daemon 连新 backend**：backend 心跳响应仍带 allowed_roots（不变），新增 POLICY_UPDATE 消息旧 daemon 不监听→忽略（向后兼容，靠心跳兜底）。
- **新 daemon 连旧 backend**：无 POLICY_UPDATE 消息→心跳兜底生效，行为等同现状。
- **PolicyAuditLog 表新增**：不影响现有表，迁移独立。
- **write-guard.ts 删除**：其逻辑迁入 PolicyEngine，所有调用点（仅 `session-manager.ts`）同步改调 PolicyEngine，无外部依赖。
- **回退路径**：若 PolicyEngine 出问题，可通过 daemon config 开关 `policy_engine_enabled`（新增，默认 true）回退到旧 write-guard 逻辑（保留一个版本再删）。⚠️ 自审存疑：是否真需要这个开关，YAGNI 判断留 execute 阶段。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | Python/Node 脚本内部 `open()`/`fs.write` 无法拦截，agent 可绕过写越界 | P0 | D-001 已知接受：prompt 约束 + audit 追溯（脚本内操作不进 audit，但 agent 行为可从产物回溯）；文档明确该限制 |
| R-02 | Shell 命令正则解析天花板（`eval`/变量展开/反引号）漏检写路径 | P1 | 尽力而为覆盖显式命令 + D-001 audit 兜底；复杂命令 deny-by-default 可配置（后续演进） |
| R-03 | `fs.realpathSync.native` 跨平台行为差异（Windows junction/UNC） | P1 | path-utils 单测覆盖 Windows junction/symlink/UNC/不存在路径；Windows CI 验证 |
| R-04 | realpath 对不存在路径失败（agent 创建新文件） | P1 | fallback realpath 父目录 + 拼文件名；父目录也不存在→逐级向上 realpath 最近存在祖先 |
| R-05 | audit 全量回传冲击 backend DB/网络 | P1 | 批量上报（100条/5s）+ 限流 + 失败落盘 + PolicyAuditLog 定期清理任务（保留 30 天） |
| R-06 | Codex batch 无 `--settings` 等价注入（OpenAI 产品，非 Anthropic CC） | P1 | **已解**：复用 Codex 带内审批协议——batch 路径不再用 `APPROVAL_RESPONSES` 自动 accept（`json-rpc.ts:49`），改为接入 `item/fileChange/requestApproval` / `item/commandExecution/requestApproval` server request，由 PolicyEngine 决策 accept/decline。execute 阶段验证 Codex app-server 审批消息字段 + decline 响应格式 |
| R-07 | WS push 丢消息（daemon 重连窗口期改配置） | P2 | 心跳 15s 兜底全量 reloadAll；POLICY_UPDATE 带 version，daemon 收旧 version 忽略 |
| R-08 | PolicyEngine 性能（每次写校验 realpath IO） | P2 | realpath 结果按 path 缓存（Map<path, normalized>，LRU）；写校验非热路径，可接受 |
| R-09 | 移除并集后 homedir 兜底语义变化 | P1 | D-007 已定：严格按 admin 配置，不偷偷加 homedir；新 runtime 默认 `[homedir]`（沿用现有默认），admin 修改后严格按配置；迁移期通知 admin 显式配全，否则可能 DENY（回归风险已知接受） |
| R-10 | canRead 若记 audit 会刷爆 PolicyAuditLog（list_dir 高频） | P1 | D-008 已定：canRead 不记 audit，仅 canWrite/canCreate/canDelete/canRename 记录；audit 量大幅降低，审计页定位为「写行为审计」 |

## 11. 决策追踪

| 决策 ID | 内容 | 覆盖章节 | 状态 |
|---|---|---|---|
| D-001@v1 | 务实方案（非 OS 沙箱），脚本内部靠 prompt+audit | §3 非目标、R-01、R-02 | accepted |
| D-002@v1 | 按 runtime 隔离，Map<runtime_id,RuntimePolicy>，daemon 不取并集 | §5.1.2、§5.2、R-09 | accepted |
| D-003@v1 | batch 跑完再生效，不杀在跑任务 | §5.3、生命周期表 batch spawn/end | accepted |
| D-004@v1 | WS push POLICY_UPDATE sub-second + 心跳兜底 | §5.3、§7.2、R-07 | accepted |
| D-005@v1 | 路径规范化含 realpath，防 ../symlink/junction/UNC，8.3 不做 | §5.1.1、R-03、R-04 | accepted |
| D-006@v1 | audit 全量 ALLOW+DENY 回传 backend 落 PolicyAuditLog + 前端审计页 | §5.1.5、§7.3、§7.4、R-05 | accepted |
| D-007@v1 | homedir 兜底=严格按 admin 配置，不偷偷加 homedir | §3、R-09、验收 #1 | accepted |
| D-008@v1 | canRead 不记 audit，仅写类决策记 | §5.1.5、R-10 | accepted |

**剩余风险**：R-01（脚本内部不拦，D-001 接受）。R-06 已解（Codex batch 复用带内审批协议接入 PolicyEngine）。

## 12. 自审

- **需求覆盖**：✅ Goal 文档 10 节功能要求全部覆盖（统一 Policy/实时生效/可读预留/可写严控/全 Tool 接入/Shell 限制/路径规范化/Cache/错误提示/日志）。验收标准里 Python `open()` 降级为 prompt+audit（D-001 已与用户对齐）。
- **Grill 覆盖**：✅ 6 个 D-xxx@vN 全部在 §11 追踪，design 各章节引用。
- **约束一致性**：✅ 与 ARCHITECTURE.md 三层架构一致；daemon 仍宿主机本地运行；不改 DaemonRuntime 模型对齐 2026-06-29 变更。
- **真实性**：✅ 表名/字段名/文件路径来自真实代码（model.py:89、daemon.ts:1682、write-guard.ts:44 等）或标注"新增"。
- **YAGNI**：✅ 不做 OS 沙箱、不做 8.3、不动 tool_policy、不杀在跑 batch。⚠️ 自审存疑：`policy_engine_enabled` 回退开关是否必要（§9），留 execute 判断。
- **验收标准**：✅ 具体可测试（见 §13）。
- **非目标清晰**：✅ §3 明确 6 项不做。
- **兼容策略**：✅ §9 新旧 daemon/backend 互连兼容 + 回退路径。
- **风险识别**：✅ R-01..R-09，含 P0/P1/P2 分级与对策。
- **生命周期契约表**：✅ §7.5 含 6 个事件，必需字段映射到 DTO。

## 13. 验收标准

1. **runtime 隔离**：claude runtime 配 `D:\Projects`，codex runtime 配 `E:\Workspace`；claude session 写 `E:\Workspace` 被拒（不看 codex 的 roots），codex session 写 `D:\Projects` 被拒。
2. **热更新**：前端改 allowed_roots 后，interactive session 下次 tool 调用立即生效（sub-second，无需重启 daemon/agent）。
3. **batch 跑完再生效**：在跑 batch 任务保持旧配置至跑完，不中断；新起 batch 用新配置。
4. **Write Tool**：未授权目录写 → 拒绝 + 统一中文错误提示。
5. **Bash**：`echo test > E:\a.txt`（E:\ 未授权）→ 拒绝。
6. **PowerShell**：`Set-Content E:\a.txt` → 拒绝。
7. **CMD**：`mkdir E:\abc` → 拒绝。
8. **Copy/Move/Delete**：`Copy-Item`/`Move-Item`/`Remove-Item` 未授权目录 → 拒绝。
9. **Codex batch 沙箱**：Codex batch 任务接入带内审批协议，写越界时 PolicyEngine decline（依赖 execute 验证 Codex 审批消息字段格式；若审批协议无法覆盖某些写，剩余部分靠 audit 记录 + 文档标注）。
10. **Python `open("E:\\a.txt","w")`**：降级——不硬拦，靠 prompt 约束 + audit 可追溯（文档明确）。
11. **路径规范化**：symlink/junction 指向越界目录 → 拒绝；`..` 穿越 → 拒绝；UNC 路径 → 拒绝。
12. **audit**：前端审计页可查某 runtime 的 ALLOW/DENY 记录，支持按 decision/provider/tool/path/时间筛选 + 分页。
13. **list_dir**：file-rpc 改调 PolicyEngine.canRead，行为不变（读自由）。
14. **兼容**：旧 daemon 连新 backend 靠心跳同步生效（无 POLICY_UPDATE 也能工作）。
