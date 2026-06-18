---
author: qinyi
created_at: 2026-06-18T11:25:09
change: 2026-06-18-workspace-client-path
status: draft
---

# Design — Workspace 支持 daemon 客户端路径

## 1. 背景

当前 SillyHub 的 Workspace 只有一个路径字段 `root_path`，必须是 **backend 进程能直接访问的本地绝对路径**（生产靠 Docker `/host-projects` 挂载宿主机）。创建 workspace 时后端在进程内 `shutil.copytree(root_path/.sillyspec)` 完成扫描与 spec 复制（`backend/app/modules/workspace/service.py:999-1052` `_ensure_spec_workspace`）。

这意味着只能接入「与 backend 同机（或路径共享）」的项目。用户希望：**通过 daemon 客户端接入「daemon 所在客户端机器上」的项目**——而 backend 根本读不到客户端机器的文件系统。

由此引发三处连锁改造（调研确认）：
- **扫描**：backend 不能再直接读 `root_path`，改由 daemon 在客户端执行。
- **agent 执行**：`dispatch_to_daemon` 现按 `_get_online_runtime(user_id)` 选「user 名下任一在线 runtime」（`backend/app/modules/agent/placement.py:174`），多 daemon 时会路由到「没有该代码的机器」。
- **目录选择**：daemon 当前**无任何对外文件 RPC**（`sillyhub-daemon/src/protocol.ts` 仅 register/heartbeat/task_available/lease_*），前端无法浏览客户端目录。

## 2. 设计目标

- 新增 `path_source=daemon-client` 类型 workspace，`root_path` 指向 daemon 客户端机器路径。
- workspace 与特定 daemon runtime 强绑定，agent run 精准路由。
- 前端可通过 daemon 实时浏览客户端目录并选定 `root_path`。
- spec 文档真理源始终在服务器（平台托管），daemon 执行 agent 时按需借阅到本地临时区、执行后回传。

## 3. 非目标（明确不做）

- ❌ 不改 server-local workspace 的现有行为（含其多 daemon 路由隐患，见 R-05）。
- ❌ 不引入 daemon↔backend 双向 spec 同步引擎（现有 `import_from_repo`/`sync` 仍是 stub，YAGNI）。
- ❌ 不支持 path_source 切换（创建后不可改 daemon-client↔server-local）。
- ❌ 不支持 workspace 绑定多个 daemon（D-001 单绑定）。
- ❌ 不做 spec 回传的细粒度 diff/冲突合并（项目未上线，整树覆盖即可）。

## 4. 拆分判断

涉及 5 个功能面（数据模型 / daemon 文件 RPC / 创建流程 / agent 路由+spec 下发 / 扫描执行），但**强耦合形成递进依赖链**（文件 RPC 是基础，路由/下发依赖数据模型）。拆成多变更会引入变更间串行依赖，管理成本高于收益。作为**单一变更，plan 阶段分 Wave** 管理。非批量模式（非「模板×数据」）。

## 5. 总体方案（分 Phase）

### Phase 1 — 数据模型（backend）
`workspaces` 表新增两列，现有数据零行为变化。

### Phase 2 — daemon 文件 RPC 通道（daemon + backend）
新增 WS RPC 消息（`RPC` / `RPC_RESULT`，带 `rpc_id` 关联）。backend 暴露 `POST /api/daemon/runtimes/{id}/list-dir`，经 WS 把请求转发给目标 daemon，等 `RPC_RESULT` 回传。daemon 侧 `list_dir` 做 `readdir+stat`，并按 `allowed_roots` 白名单校验。

### Phase 3 — 创建流程（frontend + backend）
前端表单加「路径来源」单选；选 daemon-client 时：下拉在线 daemon → 树形浏览（调 list_dir）→ 选定 `root_path`。后端创建 daemon-client workspace 时**跳过本地 copytree 扫描**。

### Phase 4 — agent run 路由 + spec 按需下发（backend placement + daemon task-runner）
- 路由（D-001）：daemon-client workspace 用 `workspace.daemon_runtime_id` 选 runtime，覆盖 user 级选择；离线即抛错。
- 下发：backend `GET /api/spec-workspaces/{ws_id}/bundle` 打包服务器 `spec_root` 为 tar 流；daemon **自行**解到本地 `~/.sillyhub/daemon/specs/{ws_id}`（路径由 daemon 决定，backend 不传具体路径）。execution-context 已透传 `workspace_id`（`agent/router.py:60` 现状已有），daemon 用它调 bundle/sync；daemon-client 时 execution-context 的 `spec_root` 字段留空（不传 backend 机器路径，区别于 `router.py:83` 现状从 lease_meta 取 backend 路径的做法）。
- 回传：agent 执行后 daemon `POST /api/spec-workspaces/{ws_id}/sync`（整树 tar）→ backend 覆盖服务器 `spec_root` + 重 parse `scan_docs`。

### Phase 5 — 扫描执行（spec_workspace bootstrap）
daemon-client workspace 的 `scan/bootstrap/reparse` 经 lease 派给**绑定 daemon** 执行（`sillyspec init/scan` 在 daemon 端，`spec_root`=本地临时区），产出经 Phase 4 的 sync 回传 backend。具体：`workspace/router.py` 的 `scan`/`scan-generate` 端点判断 path_source，daemon-client 时调 `dispatch_to_daemon`（`stage=scan`）派给绑定 daemon，而非 backend 本地 `WorkspaceScanner`。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/workspace/model.py` | `Workspace` 加 `path_source: str(20)`(默认 server-local)、`daemon_runtime_id: UUID?`（FK daemon_runtimes） |
| 修改 | `backend/app/modules/workspace/schema.py` | `WorkspaceCreate/Update/Read` 加字段；validator：path_source=daemon-client 时 daemon_runtime_id 必填 |
| 修改 | `backend/app/modules/workspace/service.py` | `create`：daemon-client 跳过 `_ensure_spec_workspace` 本地 copytree（仅 server-local 走） |
| 修改 | `backend/app/modules/workspace/router.py` | `scan`/`scan-generate` 端点：daemon-client 时改走 dispatch scan lease（派给绑定 daemon），不执行 backend 本地 `WorkspaceScanner` |
| 修改 | `backend/app/modules/agent/placement.py` | `dispatch_to_daemon`：daemon-client 按 `workspace.daemon_runtime_id` 选 runtime（离线抛 `NoOnlineDaemonError` 携 runtime 标识） |
| 修改 | `backend/app/modules/agent/router.py` | `get_execution_context`：daemon-client 时 `spec_root` 返回 daemon 本地临时区路径 |
| 修改 | `backend/app/modules/daemon/router.py` | 新增 `POST /runtimes/{id}/list-dir`；WS 入口处理 `RPC_RESULT` |
| 修改 | `backend/app/modules/daemon/service.py`（WS hub） | WS RPC 请求/响应 correlation（rpc_id 映射 pending future） |
| 修改 | `backend/app/modules/spec_workspace/router.py` | 新增 `GET /{ws_id}/bundle`、`POST /{ws_id}/sync` |
| 修改 | `backend/app/modules/spec_workspace/service.py` | 新增 `build_bundle(ws_id)->tar`、`apply_sync(ws_id, tar)`（覆盖 spec_root + reparse scan_docs） |
| 新增 | `backend/migrations/versions/2026xxxx_add_workspace_path_source.py` | 加两列迁移 |
| 修改 | `frontend/src/lib/workspaces.ts` | `Workspace`/`CreateWorkspaceInput` 加 path_source、daemon_runtime_id；新增 `listDir(runtimeId,path)` |
| 修改 | `frontend/src/components/workspace-scan-dialog.tsx` | 加路径来源单选 + daemon-client 分支（选 daemon + 浏览） |
| 新增 | `frontend/src/components/daemon-dir-browser.tsx` | 树形目录浏览组件（懒加载子节点） |
| 新增/修改 | `frontend/src/lib/daemon.ts` | `listOnlineRuntimes()`、`listDir()` api client |
| 修改 | `sillyhub-daemon/src/config.ts` | `DaemonConfig` 加 `allowed_roots: string[]`（默认 `[homedir]`） |
| 修改 | `sillyhub-daemon/src/protocol.ts` | 加 `RPC` / `RPC_RESULT` 消息常量 + type |
| 修改 | `sillyhub-daemon/src/ws-client.ts` | 收 `RPC` → 调 handler → 发 `RPC_RESULT` |
| 新增 | `sillyhub-daemon/src/file-rpc.ts` | `list_dir(path)`：allowed_roots 校验 + readdir+stat |
| 修改 | `sillyhub-daemon/src/daemon.ts` | 注册 RPC handler（list_dir） |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | 执行前拉 bundle 解包；执行后整树打包 sync 回传 |
| 修改 | `sillyhub-daemon/src/hub-client.ts` | `getSpecBundle(ws_id)`、`postSpecSync(ws_id, tar)` |

## 7. 接口定义

### 7.1 WS RPC 协议（新增消息）
```ts
// backend -> daemon
{ "type": "RPC", "rpc_id": "<uuid>", "method": "list_dir", "params": { "path": "/Users/qinyi/IdeaProjects" } }
// daemon -> backend
{ "type": "RPC_RESULT", "rpc_id": "<uuid>", "result": { "entries": [{ "name": "multi-agent-platform", "type": "dir" }] } }
// 或
{ "type": "RPC_RESULT", "rpc_id": "<uuid>", "error": { "code": "forbidden", "message": "path outside allowed_roots" } }
```

### 7.2 REST 端点（新增）
```python
# backend: 目录浏览转发
POST /api/daemon/runtimes/{runtime_id}/list-dir
  body: { "path": str }
  -> 200 { "entries": [{ "name": str, "type": "dir"|"file" }] }
  -> 403 (越界 allowed_roots) / 504 (daemon 离线或 RPC 超时)

# backend: spec bundle 下发
GET /api/workspaces/{workspace_id}/spec-workspace/bundle
  -> 200 application/x-tar  (服务器 spec_root 打包，排除 .runtime)

# backend: spec 回传
POST /api/workspaces/{workspace_id}/spec-workspace/sync
  body: application/x-tar (daemon 执行后 spec 临时区整树)
  -> 200 { "ok": true, "reparsed": int }
```

### 7.3 数据结构
```python
# Workspace 新增字段（model.py）
path_source: str = Field(max_length=20, default="server-local")   # server-local | daemon-client
daemon_runtime_id: UUID | None = Field(default=None, foreign_key="daemon_runtimes.id")
```
```ts
// sillyhub-daemon config.ts
interface DaemonConfig { /* 现有字段... */ allowed_roots: string[]; }  // 默认 [os.homedir()]
```

## 8. 数据模型

`workspaces` 表加两列（迁移 `2026xxxx_add_workspace_path_source.py`）：
| 列 | 类型 | 约束 |
|---|---|---|
| `path_source` | VARCHAR(20) | NOT NULL DEFAULT 'server-local' |
| `daemon_runtime_id` | UUID | NULL，FK → daemon_runtimes.id |

应用层约束：`path_source='daemon-client'` 时 `daemon_runtime_id` NOT NULL（schema validator 强制）。

## 9. 兼容策略（brownfield）

- **未配置新功能行为不变**：现有 workspace `path_source` 默认 `server-local`、`daemon_runtime_id=NULL`，创建/扫描/dispatch 全链路与现状一致。
- **`_ensure_spec_workspace` 本地 copytree**：仅 `path_source=server-local` 执行；daemon-client 跳过（backend 读不到）。
- **dispatch 路由回退**：`path_source=server-local` 维持现有 `_get_online_runtime(user_id)`（假设 daemon 与 backend 路径共享，现状前提）；仅 daemon-client 强制按 `daemon_runtime_id`。
- **不改的 API/表**：现有 `/workspaces` CRUD 签名只增字段不改语义；spec_workspaces 表结构不变。
- 项目未上线，数据可清空（CLAUDE.md 规则7），迁移以加列为主。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | WS RPC 超时 / daemon 在浏览中途离线 | P1 | backend 对每个 rpc_id 设超时（如 10s）→ 504；前端提示重试 |
| R-02 | spec bundle 过大（docs 整树）影响下发性能 | P1 | tar 流式传输；排除 `.runtime`/缓存；大 workspace 监控体积 |
| R-03 | spec 回传整树覆盖的并发写 | P2 | 项目未上线、单 workspace 串行执行，可接受；后续按需加版本号 |
| R-04 | daemon 未配 allowed_roots 导致无法浏览 | P1 | config 默认 `[homedir]`；首次 list_dir 失败时前端提示配置位置 |
| R-05 | server-local + 多 daemon 现有路由隐患（代码只在同机可达） | P2 | 本次非目标，记录待后续；daemon-client 已用强绑规避 |
| R-06 | daemon-client workspace 绑定的 daemon 被删除 | P2 | 删除 daemon 时校验是否有 workspace 绑定，阻止或级联提示 |

## 11. 决策追踪

详见 `decisions.md`。当前版本决策：
- **D-001@v1**（workspace 强绑单个 daemon + 离线 fail）→ 覆盖于 §5 Phase 4 / §6 placement.py / FR-route
- **D-002@v1**（list_dir allowed_roots 白名单）→ 覆盖于 §5 Phase 2 / §6 file-rpc.ts / FR-dir-boundary
- **D-003@v1**（spec 服务器平台托管）→ 覆盖于 §2 / §5 Phase 4 / §9
- **D-004@v1**（新增 path_source + daemon_runtime_id 绑定）→ 覆盖于 §5 Phase 1 / §8
- **D-005@v1**（daemon 新增 list_dir RPC）→ 覆盖于 §5 Phase 2/3 / §7
- **D-006@v1**（spec 按需下发方案A，bundle/sync）→ 覆盖于 §5 Phase 4 / §7.2

无未解决决策；R-05 为已知遗留（本次非目标）。

## 12. 自审

| 检查项 | 结果 |
|---|---|
| 需求覆盖 | ✅ 覆盖 step6 全部确认需求（daemon-client 路径/服务器托管/树形浏览） |
| Grill 覆盖 | ✅ D-001~D-006 全部在 §5/§6/§11 引用 |
| 约束一致性 | ✅ 符合 ARCHITECTURE.md 模块化分层（router/service/model）、scan 文档约定 |
| 真实性 | ✅ 表名 `workspaces`/`daemon_runtimes`、字段 `root_path`、函数 `_ensure_spec_workspace`/`dispatch_to_daemon`/`_get_online_runtime` 均来自真实代码（placement.py:174 / service.py:999）；新增项已标注 |
| YAGNI | ✅ 砍掉同步引擎、多 daemon 绑定、path_source 切换、diff 合并（§3） |
| 验收标准 | ⚠️ 自审存疑：本 design 尚未列 FR-xxx 验收点，将在 requirements.md/tasks.md 细化（FR-model/FR-route/FR-dir-boundary/FR-bundle-sync 已在 §11 占位） |
| 非目标清晰 | ✅ §3 明确 5 项不做 |
| 兼容策略 | ✅ §9 给出回退路径 |
| 风险识别 | ✅ R-01~R-06 含对策 |

**自审结论**：通过（验收标准细化留 requirements.md，已标注）。
