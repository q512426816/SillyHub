---
author: qinyi
created_at: 2026-06-26 10:40:32
---

# Design — daemon-client workspace spec 树同步修复

## 1. 背景

daemon-client workspace（`root_path` 在客户端机器、backend 不可直读）当前数据通路断裂。实测 workspace `7cd27eb9`（myaaa，绑定 claude daemon 在线）scan run `453530e9` 已 `completed`，但：

1. `/workspaces/<id>/scan-docs` 空
2. `/workspaces/<id>/knowledge` 空
3. `/workspaces/<id>/runtime` 空
4. `/workspaces/<id>/changes` 新建报错 `daemon-client workspace requires an active lease to write changes`

实测定位三层根因：

**根因 A — spec 树永不回灌**：scan 跑在长生命周期 interactive session（`agent_sessions.14c9e08b`，`status=active, ended_at=NULL`，从未结束）。spec 树回灌（daemon `postSpecSync` → backend `apply_sync`）只在 daemon 的 `onSessionEnd` 触发。session 不 end → 永不回灌。实测 backend 容器 `spec_root=/data/spec-workspaces/7cd27eb9…/` 为空目录、`spec_workspaces.last_synced_at=NULL`、`scan_documents=0`，而 scan 产物确实存在于 daemon 本地盘 `~/.sillyhub/daemon/specs/<wsId>/docs/myaaa/scan/*.md`（7 个）+ `knowledge/*.md`（4 个）。

**根因 B — `.sillyspec` 包裹层契约错位（系统性）**：daemon 本地 spec 布局是**扁平**的——`<specroot>/docs/myaaa/scan/*.md`（无 `.sillyspec` 包裹，7cd27eb9 / 81ce4ebe 两 workspace 一致）。但 backend 读取层期望带包裹：`scan_docs/parser.py:105` `docs_dir = sillyspec_root / ".sillyspec" / "docs"`；`runtime/service.py:50` `SpecPathResolver(spec_root).runtime_dir()`（= `spec_root/.sillyspec/.runtime`）；`spec_workspace/validator.py` `root / ".sillyspec" / "projects"`。backend 日志报 `HTTP_400_WORKSPACE_NOT_SILLYSPEC: No _module-map.yaml found at .../.sillyspec/docs/myaaa/modules/_module-map.yaml`。backend 的 `build_bundle`/`apply_sync`（spec_workspace/service.py:245/288）把 spec_root 当**扁平容器**（daemon 推什么顶层就落什么顶层），与读取层期望矛盾。故即便触发 sync，daemon 把扁平 `docs/` 推过来，parser 找 `.sillyspec/docs/` → `parsed:0`。

**根因 C — daemon-client 写 change 无可用通路**：`change_writer/service.py:338` `_repo_dir_for_workspace` 对 `path_source=daemon-client` 直接抛 `requires an active lease`。该 lease 指 worktree lease，而 `worktree/service.py:79-105` 的 `acquire` 走服务端 `git worktree add`——daemon-client 仓库在客户端机，服务端无仓库，worktree lease 根本不适用。故 changes 报错指向一个对 daemon-client 不工作的机制，UX 上直接裸抛无引导。

**环境**：backend 跑 Docker（`multi-agent-platform-backend-1`，8001→8000），daemon 跑 Windows 宿主（npm 安装版 `node_modules/sillyhub-daemon/dist/cli.js`，BUILD_ID=2515cb3e 当前 HEAD），两者**不共享文件系统**。spec 交换唯一通路是 tar 同步（`2026-06-23-spec-transport-tar-sync` 引入）。

## 2. 设计目标

- **G1**：daemon-client workspace scan run 到终态后，`scan-docs` / `knowledge` **立即可见**（不等 session end）。
- **G2**：`/runtime` 对 daemon-client 可见（RuntimeProgress 反映 sillyspec.db 进度）。
- **G3**：daemon-client 从 UI 新建 change 有可用路径（活跃 session 时通过 daemon 代写），无活跃 daemon 时给出结构化引导而非裸抛。
- **G4**：对齐 daemon↔backend 的 spec_root 布局契约，消除 `.sillyspec` 包裹层歧义。
- **G5**：server-local / repo-native workspace 行为零回归。

## 3. 非目标

- 不改 sillyspec CLI 本身的目录布局逻辑（`--spec-root` 语义不变）。
- 不改 daemon 本地 spec 存储路径（`~/.sillyhub/daemon/specs/<wsId>` 扁平布局保留，不做数据迁移）。
- 不引入 daemon↔backend 文件系统共享（不做 bind mount；继续走 tar 同步）。
- 不改 batch daemon-client（task-runner）路径的 spec 同步语义（本次聚焦 interactive scan + change 读写）。
- 不做 change 写入的完整 git worktree 化（daemon 代写仅落 `.sillyspec/changes/<key>/` 文件，不涉及 git 操作）。

## 4. 拆分判断

A/B/C/runtime 是同一条 daemon-client 数据流读/写两端的不同环节，耦合紧密：A+B 必须捆绑才能让 scan-docs 真正可见（B 修契约但 sync 不触发仍空；A 触发 sync 但契约错位仍 `parsed:0`）。runtime 共用 B 的契约修复 + 额外 `.runtime` 同步策略。C 共用 A 的 postSpecSync 回灌链路。拆成多个变更会割裂 coherent 修复并制造中间态（如只修 A 不修 B，sync 跑了但读不到）。故作为一个变更、分 3 Phase 推进。任务数预估 < 15，无重复模式，不走批量。

## 5. 总体方案

### 5.0 canonical 契约（贯穿全 Phase）

`spec_workspaces.strategy` 决定 spec_root 语义：

| strategy | spec_root 语义 | 布局 | 适用 |
|---|---|---|---|
| `platform-managed` | **即 `.sillyspec` 内容根** | 扁平：`docs/`、`changes/`、`.runtime/`、`projects/`、`knowledge/` 直接在 spec_root 下 | daemon-client / 平台托管 |
| `repo-native` / server-local | workspace 根，`.sillyspec/` 在其下 | 包裹：`<spec_root>/.sillyspec/{docs,…}` | 源码仓库可直读 |

`SpecPathResolver` 增 `platform_managed: bool`（默认 False，向后兼容）。True 时所有路径方法省略 `.sillyspec` 段。

### 5.1 Phase 1 — 契约对齐（B，基础）

- `SpecPathResolver.__init__(workspace_root, *, platform_managed=False)`。`platform_managed=True` 时：`changes_root→root/changes`、`runtime_dir→root/.runtime`、`db_path→root/.runtime/sillyspec.db`、`docs_dir(p)→root/docs/p`、`scan_dir(p)→root/docs/p/scan`、`modules_dir(p)→root/docs/p/modules`。
- 新增工厂 `SpecPathResolver.for_spec_workspace(spec_ws)`：按 `spec_ws.strategy == "platform-managed"` 自动选 mode（查 `spec_workspaces` 行）。
- reader 全量改用工厂构造 resolver：
  - `scan_docs/parser.py` `parse_docs_tree` / `parse_component`（消除 `sillyspec_root / ".sillyspec" / "docs"` 硬编码，改收 resolver 或 `platform_managed` 标志）。
  - `scan_docs/service.py` `reparse`（传 mode）。
  - `runtime/service.py:46-50`（用 `for_spec_workspace`）。
  - `spec_workspace/validator.py`（`root / ".sillyspec" / "projects"` → resolver.projects_dir）。
  - `knowledge/service.py`（Design Grill 发现：`list_knowledge`/`get_knowledge` 用 `Path(workspace.root_path) / ".sillyspec"`，daemon-client 的 root_path 是客户端机源码路径、backend 读不到，且不走 spec_workspaces。需像 `scan_docs/service.py:86` 那样**重定向**：platform-managed 时 `sillyspec_root = spec_ws.spec_root` + mode；repo-local 保持 root_path/`.sillyspec`）。
  - `knowledge/parser.py`（配合 service 改动，按 mode 解析，无 `.sillyspec` 硬编码则仅改调用方）。
  - `agent/post_scan_validator.py`（`source_root / ".sillyspec"` 系列）。
  - `agent/context_builder.py:600/628` prompt：platform-managed 分支指示写 `<specroot>/docs/`（去 `.sillyspec`），与扁平产出一致。
- `layout_migration.py` 逻辑不涉及 platform-managed，保持不变（仅处理 repo-native）。

### 5.2 Phase 2 — sync 时机 + .runtime 可见（A + runtime）

- **A 触发点**（daemon 侧）：把 `spec-sync.ts` 的 `postSpecSync` 调用从 `daemon.ts onSessionEnd` 抽成可复用函数 `syncSpecTreeIfNeeded(specSyncCtx, client)`；在 scan interactive run 到终态回调（run completed/failed，与 `notifyRunResult` 同一收尾点）**额外触发一次**（仅当 `specSyncCtx` 存在，即 scan/stage tar 模式）。quick-chat 等 non-scan interactive 不触发（无 specSyncCtx）。保留 `onSessionEnd` 调用作兜底。
- **幂等**：`apply_sync` 整树覆写（D-006@v1），double-sync（run 终态 + 后续 session end）无害。
- **runtime（D-003）**：daemon→backend `.runtime` 同步需要**两端都改**（Design Grill 发现 apply_sync 接收端改了不够，daemon 打包端也排除）：
  - `build_bundle`（pull，backend→daemon）**继续排除** `.runtime`（backend 的 .runtime 非权威，不污染 daemon）。
  - `apply_sync`（push，daemon→backend）**改为接收** daemon 的 `.runtime/`（daemon 是 daemon-client 唯一 sillyspec 执行方，.runtime 权威）。当前 apply_sync「preserve backend .runtime（备份+恢复）」逻辑改为「接收 tar 内 .runtime，覆盖」（删除 runtime_bak 保留逻辑）。
  - **`spec-sync.ts` `packSpecDir`（spec-sync.ts:144-145）改为不再排除 `.runtime`**（当前与 GET bundle 约定一致地排除，导致 daemon tar 从不带 .runtime，apply_sync 无可收）。pull 路径的 `build_bundle` 仍排除，保持非对称（pull 排除、push 包含）。
  - 配合 Phase 1 `runtime/service.py` mode 适配，`/runtime` 读 `spec_root/.runtime/sillyspec.db` 可见。
- **last_synced_at**：`apply_sync` 成功后 `sync_status=clean, last_synced_at=now()` 落库（修复当前 NULL）。

### 5.3 Phase 3 — daemon 代写 change（C）

**架构约束（Design Grill 核实）**：daemon **不暴露 HTTP server**，backend→daemon 没有推送/RPC 通道；唯一命令通道是 **lease 轮询**（daemon `GET /api/daemon/runtimes/{rid}/pending-leases` → claim → 执行，见 daemon/router.py:1393）。session WS 通道只承载 agent 消息，不能下发任意 RPC。故 change-write 经 lease-polling 机制实现，复用既有基础设施，不新增 daemon server。

- **backend 端点** `POST /api/workspaces/{wid}/changes/proxy-create`（仅 `path_source=daemon-client`）：
  - 入参：`title`, `description?`, `change_type?`, `runtime_id`（绑定的在线 daemon runtime）。
  - 校验：runtime 存在、`status=online`、绑定该 workspace（`workspace.daemon_runtime_id`）。
  - 生成 `change_key`（date+slug+hex），构造 change 包内容（MASTER.md / proposal.md / request.md，复用 `markdown_builder` + frontmatter）。
  - 创建一条 **change-write 任务记录**（新表 `daemon_change_writes` 或复用 `daemon_task_leases` 加 `kind='change-write'`，payload=change_key+files[]{path,content}+workspace_id），状态 `pending`，归属该 runtime。
  - **同步等待** daemon claim+执行回执（daemon 轮询周期内，秒级；可 SSE/轮询 `GET .../change-writes/{id}` 取状态），或返回 `pending` 由前端轮询。
  - daemon 回执成功 → backend 落 `Change` + `ChangeDocument` 行（path 相对 `changes/<key>/MASTER.md`），返回 change。
- **daemon 侧**（task-runner 轻量分支或独立 handler）：
  - 轮询到 `kind='change-write'` 任务 → claim（带 claim_token）→ 在本地 `~/.sillyhub/daemon/specs/<wsId>/changes/<key>/` 写文件 → 回执 `{ok, files[]}` → 触发 `syncSpecTreeIfNeeded`（Phase 2 函数）回灌。
  - **不启动 agent**（与 batch agent-run lease 区分；纯文件写 + sync）。
- **`change_writer/service.py:335-343` 改造**：
  - `create_change` 带 `runtime_id` 且 workspace `daemon-client` → 走 proxy 路径（service 层调 proxy-create 逻辑），不抛错。
  - 无 `runtime_id` / daemon 离线 → 抛**结构化错误** `DaemonClientNoActiveSession`（code `DAEMON_CLIENT_NO_SESSION`, http 400，detail 引导「需要在线 daemon 才能在客户端工作区创建变更」），前端 toast。
- **前端**（`changes` 新建入口）：workspace 为 daemon-client 时调 proxy 端点（带 `runtime_id=workspace.daemon_runtime_id`）；daemon 离线时按钮禁用 + tooltip。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/core/spec_paths.py` | 增 `platform_managed` 参数 + `for_spec_workspace` 工厂；mode 下省略 `.sillyspec` 段 |
| 修改 | `backend/app/modules/scan_docs/parser.py` | `parse_docs_tree`/`parse_component` 去硬编码 `.sillyspec`，按 mode 解析 |
| 修改 | `backend/app/modules/scan_docs/service.py` | `reparse` 传 platform_managed mode |
| 修改 | `backend/app/modules/runtime/service.py` | `get_progress` 用 `for_spec_workspace` 构造 resolver |
| 修改 | `backend/app/modules/spec_workspace/validator.py` | projects 路径走 resolver |
| 修改 | `backend/app/modules/spec_workspace/service.py` | `apply_sync` 接收 `.runtime`（去 preserve-overwrite）+ 落 `last_synced_at` |
| 修改 | `backend/app/modules/knowledge/service.py` | platform-managed 重定向到 spec_ws.spec_root + mode（不再用 root_path） |
| 修改 | `backend/app/modules/knowledge/parser.py` | 配合按 mode 解析（核实硬编码） |
| 修改 | `backend/app/modules/agent/post_scan_validator.py` | `.sillyspec` 路径按 mode（核实 source_root vs spec_root 语义） |
| 修改 | `backend/app/modules/agent/context_builder.py` | platform-managed prompt 分支去 `.sillyspec`（docs/ 直接） |
| 修改 | `backend/app/modules/change_writer/service.py` | daemon-client + runtime_id 走 proxy；无 runtime 抛结构化错误 |
| 新增 | `backend/app/modules/change_writer/proxy.py` | `proxy_create_change`：runtime 校验 + 建 change-write 任务 + 等回执 + 落库 |
| 新增 | `backend/app/modules/daemon/change_write_router.py` | `GET /runtimes/{rid}/pending-change-writes`（daemon 轮询）+ `POST /change-writes/{id}/claim/complete` 回执 |
| 修改 | `backend/app/modules/change_writer/router.py` | 新增 `POST /changes/proxy-create` |
| 修改 | `backend/app/modules/change_writer/schema.py` | `ProxyCreateChangeRequest`（含 runtime_id） |
| 修改 | `sillyhub-daemon/src/spec-sync.ts` | 抽 `syncSpecTreeIfNeeded`；`packSpecDir` 不再排除 `.runtime`（push 路径） |
| 修改 | `sillyhub-daemon/src/daemon.ts` | scan run 终态触发 sync；轮询 change-write 任务分支 |
| 修改 | `sillyhub-daemon/src/task-runner.ts` | `kind=change-write` 轻量分支（claim→本地写→sync，不启 agent） |
| 修改 | `frontend/src/.../changes` 新建入口 | daemon-client 调 proxy 端点（带 runtime_id）+ 无 daemon 禁用引导 |

## 7. 接口定义

```python
# backend/app/core/spec_paths.py
class SpecPathResolver:
    def __init__(self, workspace_root: str | Path, *, platform_managed: bool = False) -> None: ...
    @classmethod
    def for_spec_workspace(cls, spec_ws: "SpecWorkspace") -> "SpecPathResolver":
        return cls(spec_ws.spec_root, platform_managed=(spec_ws.strategy == "platform-managed"))

# backend/app/modules/scan_docs/parser.py
class ScanDocsParser:
    def parse_docs_tree(self, sillyspec_root: Path, *, platform_managed: bool = False) -> ScanDocsResult: ...
    def parse_component(self, sillyspec_root: Path, component_key: str, *, platform_managed: bool = False) -> ScanDocsResult: ...

# backend/app/modules/change_writer/proxy.py
class DaemonClientNoActiveSession(AppError):
    code = "DAEMON_CLIENT_NO_SESSION"; http_status = 400

async def proxy_create_change(
    session: AsyncSession, *, workspace_id: UUID, user_id: UUID,
    runtime_id: UUID, title: str, description: str = "", change_type: str | None = None,
) -> Change: ...
# change-write 任务（新表 daemon_change_writes 或 daemon_task_leases.kind='change-write'）：
#   id, workspace_id, runtime_id, change_key, files (json), status(pending/claimed/done/failed), created_at, completed_at
```

```typescript
// sillyhub-daemon: scan run 终态回调内
await syncSpecTreeIfNeeded(this._interactiveSpecSyncCtx.get(leaseId), this._client);
// task-runner 轮询到 kind='change-write' → claim → 本地写 changes/<key>/ → 回执 → 触发 syncSpecTreeIfNeeded
```

## 7.5 生命周期契约表

涉及 session / lease / agent_run / daemon / lifecycle / complete / end 关键词，必填：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| scan run 终态 sync | daemon | backend | workspaceId（specSyncCtx）, tar(spec tree) | spec_workspaces.last_synced_at ← now |
| session end sync（兜底） | daemon | backend | workspaceId, tar | 同上（幂等覆写） |
| write_change 任务下发 | backend | daemon（轮询） | runtime_id, change_key, files[]{path,content} | daemon_change_writes pending→claimed |
| write_change 回执 | daemon | backend | taskId, ok, files[] | claimed→done；daemon 本地 changes/ 已写 |
| change 回灌 sync | daemon | backend | workspaceId, tar(含 changes/) | Change/ChangeDocument 行落库 |
| create session（既有） | backend | daemon | sessionId, leaseId, claimToken | session active |
| proxy-create（daemon 离线） | frontend | backend | workspaceId, title, runtime_id | 400 DAEMON_CLIENT_NO_SESSION |

## 8. 数据模型

新增轻量表 `daemon_change_writes`（Phase 3 change-write 任务队列，daemon 轮询消费）：
- `id` UUID PK, `workspace_id` FK, `runtime_id` FK, `change_key` str, `files` json, `status` str（pending/claimed/done/failed）, `claim_token` str, `created_at`, `completed_at`, `error` str|null。
- 或复用 `daemon_task_leases` 加 `kind='change-write'`（避免新表，但需核实 lease 表 schema 是否容纳 files payload）。plan 阶段定夺。

其余复用现有 `spec_workspaces`（`strategy`/`spec_root`/`last_synced_at`/`sync_status`）、`scan_documents`、`changes`、`change_documents`、`agent_sessions`、`daemon_task_leases`。

新增错误码：`DAEMON_CLIENT_NO_SESSION`（http 400）。复用 `HTTP_400_WORKSPACE_NOT_SILLYSPEC`（Phase 1 修复后不再误触发）。

## 9. 兼容策略（brownfield）

- **server-local / repo-native 零回归**：`platform_managed` 默认 False，`SpecPathResolver` 现有方法行为不变（`.sillyspec` 包裹保留）。仅 `strategy=platform-managed` 走新 mode。
- **未配置/旧数据**：现有 `spec_workspaces` 行的 `strategy` 字段已区分；platform-managed workspace 的空 spec_root 在 Phase 1+2 后首次 scan 终态即回灌，无需迁移脚本。daemon 本地扁平数据保留不动。
- **回退**：Phase 2 apply_sync 的 `.runtime` 接收若出问题，可临时把 `build_bundle`/`apply_sync` 的 `.runtime` 处理回退到排除语义（runtime 不可见但 scan-docs/knowledge 不受影响）。Phase 3 proxy 端点新增不影响既有 `change_writer.create_change`（无 session_id 走原逻辑）。
- **API 不变**：既有 `GET /scan-docs`、`GET /knowledge`、`GET /runtime`、`POST /changes/create` 签名不变；新增 `POST /changes/proxy-create` 为 additive。

## 10. 测试策略

- **Phase 1**：`SpecPathResolver` platform-managed mode 单测（各路径方法）；各 reader（scan_docs/runtime/validator/knowledge）platform-managed + repo-native 双模式单测；server-local 回归测。
- **Phase 2**：scan run 终态触发 `syncSpecTreeIfNeeded` 的 daemon 单测；`apply_sync` 接收 `.runtime` + 落 `last_synced_at` 的 backend 集成测；double-sync 幂等测。
- **Phase 3**：`proxy_create_change` session 校验 + 下发 + 落库集成测；daemon `write_change` handler 单测；无 session 抛 `DAEMON_CLIENT_NO_SESSION` 测；端到端（真实 workspace `7cd27eb9`，backend Docker + daemon 宿主）联调验收 scan-docs/knowledge/runtime 可见 + changes 可建。
- 兼容 Windows/Linux/macOS（daemon 路径用 `homedir()`，已兼容）。

## 11. 风险登记

- **R1（P1）Phase 1 漏 reader**：硬编码 `.sillyspec` 的 reader 漏改一个 → 该 reader 对 platform-managed 局部失效。缓解：grep 全量清单（见文件变更清单）+ mode 单测覆盖。
- **R2（P2）`.runtime` 双写冲突**：若未来 backend 也跑 sillyspec 写 .runtime，与 daemon 回灌冲突。当前 daemon-client 仅 daemon 执行 sillyspec，无冲突；记为未来约束。
- **R3（P2）post_scan_validator 语义**：`post_scan_validator` 用 `source_root / ".sillyspec"`（源码目录），与 spec_root 不同实体，需核实 mode 是否适用，可能不受 Phase 1 影响（保持源码目录包裹语义）。
- **R4（P1，Design Grill 已化解）backend→daemon 命令通道**：核实确认 daemon 不暴露 HTTP server，无推送通道。Phase 3 改用 lease-polling（daemon 轮询 pending-change-writes）机制，复用既有轮询基础设施（pending-leases 同款），不新增 daemon server。残留风险：change-write 依赖 daemon 轮询周期（秒级延迟）+ claim/complete 回执可靠性，需超时兜底（pending 超时→failed，前端可重试）。
- **R5（P2）scan 终态定义**：「scan run 终态」= agent_run `status in (completed, failed)`；scan failed 时仍回灌（partial output 有价值），由 Phase 2 统一处理。
- **R6（P1，Design Grill 发现）knowledge 读根错**：`knowledge/service.py:31,38` 用 `workspace.root_path/.sillyspec`，daemon-client 下 backend 读不到客户端源码路径。Phase 1 须重定向到 spec_ws.spec_root（已纳入文件清单），否则 knowledge 修复不生效。
- **R7（P1，Design Grill 发现）.runtime 两端排除**：`packSpecDir`（spec-sync.ts:144）与 `build_bundle` 都排除 .runtime，仅改 apply_sync 接收端不够。Phase 2 须同时改 packSpecDir 包含 .runtime（已纳入 §5.2 + 文件清单）。

## 12. 决策覆盖映射

- **D-001@v1**（scope=A+B+C+runtime 全修）→ 覆盖于全 Phase、FR-01~FR-10、task-01~task-19
- **D-002@v1**（scan 终态即回灌，保留 session-end 兜底）→ 覆盖于 §5.2 Phase 2 / task-09,10 / FR-05,07
- **D-003@v1**（.runtime 纳入 push 同步，pull 仍排除）→ 覆盖于 §5.2 / task-11,12 / FR-06
- **D-004@v1**（daemon 代写 change 经 lease-polling）→ 覆盖于 §5.3 Phase 3 / task-14~17 / FR-08,09,10
- **D-005@v1**（SpecPathResolver platform_managed mode，方案 A）→ 覆盖于 §5.0/§5.1 / task-01~08 / FR-01~04

## 13. 自审

- 三层根因（A/B/C）均有实测证据（DB 查询、磁盘文件、backend 日志、源码行号），非推测。
- 文件变更清单覆盖 grep 全量硬编码 `.sillyspec` 的 reader（§6），无遗漏（knowledge/service.py 经 Design Grill 补入）。
- 7.5 生命周期契约表覆盖 session/lease/agent_run/daemon/lifecycle/complete/end 全部关键词；每个事件映射到 task（scan 终态 sync→task-09/10、change-write 下发/回执→task-15/17、proxy-create→task-16）。
- 数据模型新增 `daemon_change_writes` 表已标注；无破坏性 schema 变更。
- 兼容策略明确：`platform_managed` 默认 False，server-local/repo-native 零回归（SC3 守护）。
- Design Grill 发现并修正 3 处结构性问题（命令通道不可行→lease-polling、.runtime 两端、knowledge 读根），全部代码确定，无悬而未决的业务判断。
- 非目标显式列出（§3），防止 scope creep（不改 sillyspec CLI、不 bind mount、不改 batch 路径、不 git worktree 化）。
- 风险 R1-R7 登记完整，含 R3（post_scan_validator 待核实）、R4（通道已化解 + 超时兜底）。
