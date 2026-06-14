---
author: qinyi
created_at: 2026-06-14T10:40:45+08:00
---

# 模块影响分析 — daemon Python → Node.js 重写

> 变更：`2026-06-13-daemon-nodejs-rewrite`
> 范围：`sillyhub-daemon/` 子项目整体重写（72 files changed, +9663 / −10783）
> 分析依据：`design.md` §6 文件变更清单 + 当前 `_module-map.yaml`（Python 版 15 模块）+ Node 版 `src/` 真实导出符号 + `git diff 717fa24..8229b42`
> 结论：**所有 15 个 Python 模块全部重写为 TypeScript**，目录 `backends/` 改名为 `adapters/` 并完成抽象深化，**新增 3 个模块**（index / types / ws-client），根 `README.md` 同步更新。

---

## 1. 影响总览

| 维度 | Python 版 | Node.js 版 |
|------|-----------|------------|
| 语言 | Python 3.12（asyncio） | TypeScript（Node ≥ 20，ESM） |
| 源码根 | `sillyhub-daemon/sillyhub_daemon/` | `sillyhub-daemon/src/` |
| 协议解析目录 | `backends/`（执行+解析合一） | `adapters/`（纯解析，执行下沉 TaskRunner） |
| 抽象基类 | `AgentBackend(ABC)` | `ProtocolAdapter` 接口 |
| 工厂 | `get_backend()` / `get_protocol()` | `getBackend()` |
| 通信 | `client.py`（HubClient）+ WS 内联 daemon | `hub-client.ts` + 独立 `ws-client.ts` |
| 依赖 | 第三方较多 | 仅 `ws` + `commander`（devDep: typescript/vitest） |
| 测试 | pytest（17 文件） | vitest（22 文件，536 用例） |

Python 源码 `sillyhub_daemon/**`、`pyproject.toml`、`tests/test_*.py` **已全部删除**（git diff 确认）。

---

## 2. 模块影响矩阵

### 2.1 路径 + 导出符号变化（重写，模块 id 保持）

| 模块 id | Python 路径 | Node.js 路径 | 导出符号变化 | depends_on 变化 | needs_review |
|---------|-------------|--------------|--------------|-----------------|--------------|
| `cli` | `sillyhub_daemon/__main__.py` | `src/cli.ts` | Click subcommands → commander `createProgram`；新增 `getPidFile`/`getLogFile`/`readPid`/`isProcessAlive`/`stopAction` | config（保留） | false |
| `config` | `sillyhub_daemon/config.py` | `src/config.ts` | `DaemonConfig` 保留；新增 `DEFAULT_CONFIG_DIR`/`DEFAULT_CONFIG_PATH`/`DEFAULT_CONFIG` | 无 | false |
| `protocol` | `sillyhub_daemon/protocol.py` | `src/protocol.ts` | `MSG_TASK_AVAILABLE` 等扁平常量 → `MSG`/`LEASE_STATE` 对象 + `MsgType`/`LeaseState` 类型 + `WS_PATH`/`REST_PREFIX` | 无 | false |
| `client` | `sillyhub_daemon/client.py` | `src/hub-client.ts`（**文件改名**） | `HubClient` 保留；新增 `HubHttpError` + `RegisterBody`/`ClaimLeaseBody`/`StartLeaseBody`/`LeaseHeartbeatBody`/`SubmitMessagesBody`/`CompleteLeaseBody`/`HeartbeatBody` 接口 | 无 | false |
| `credential` | `sillyhub_daemon/credential.py` | `src/credential.ts` | `CredentialManager` 保留；新增 `DEFAULT_CREDENTIALS_PATH` | 无 | false |
| `workspace` | `sillyhub_daemon/workspace.py` | `src/workspace.ts` | `WorkspaceManager`/`parseShortstat` 保留；`_on_rmtree_error`（私有）→ 内联；新增 `GitError`/`WorkspaceResult` | 无 | false |
| `version` | `sillyhub_daemon/version.py` | `src/version.ts` | `parse_semver`/`format_semver`/`check_min_version` → `parseSemver`/`formatSemver`/`checkMinVersion`；新增 `SemVerTuple`/`MIN_VERSIONS` | 无 | false |
| `agent-detector` | `sillyhub_daemon/agent_detector.py` | `src/agent-detector.ts` | `AgentDetector`/`DetectedAgent` 保留；`AgentDef`→`AgentProviderSpec`，`AgentInfo` 移除；新增 `PROVIDER_SPECS`/`ProviderName`/`AgentProtocol` | version（保留） | false |
| `task-runner` | `sillyhub_daemon/task_runner.py` | `src/task-runner.ts` | `TaskRunner` 保留；新增 `TaskStatus`/`RunnerHubClient`/`RunnerWorkspaceManager`/`RunnerCredentialManager`/`TaskRunnerResult`；子进程执行收敛至此（方案B） | `backends`→`adapters`，client→hub-client（保留） | false |
| `daemon` | `sillyhub_daemon/daemon.py` | `src/daemon.ts` | `Daemon` 保留；新增 `DaemonOptions`；WS 逻辑下沉 ws-client | **+ws-client** | false |

### 2.2 目录改名 + 抽象深化（`backends/` → `adapters/`）

| 模块 id | Python 路径 | Node.js 路径 | 变化要点 | needs_review |
|---------|-------------|--------------|----------|--------------|
| `backends` | `sillyhub_daemon/backends/__init__.py` | `src/adapters/index.ts` + `src/adapters/protocol-adapter.ts` | **职责拆分**：`AgentBackend`（执行+解析）→ `ProtocolAdapter`（纯 `parse`）接口（protocol-adapter.ts）；`PROTOCOL_PROVIDERS`/`getBackend` 工厂（index.ts）。`AgentEvent` IR 移至 `types.ts`。方案B 核心深化点。 | false |
| `backend-stream-json` | `sillyhub_daemon/backends/stream_json.py` | `src/adapters/stream-json.ts` | `StreamJsonBackend` → stream-json adapter（claude/gemini/cursor） | false |
| `backend-json-rpc` | `sillyhub_daemon/backends/json_rpc.py` | `src/adapters/json-rpc.ts` | `JsonRpcBackend` → json-rpc adapter（codex/hermes/kimi/kiro） | false |
| `backend-jsonl` | `sillyhub_daemon/backends/jsonl.py` | `src/adapters/jsonl.ts` | `JsonlBackend` → jsonl adapter（copilot） | false |
| `backend-ndjson` | `sillyhub_daemon/backends/ndjson.py` | `src/adapters/ndjson.ts` | `NdjsonBackend` → ndjson adapter（opencode/openclaw/pi） | false |
| `backend-text` | `sillyhub_daemon/backends/text.py` | `src/adapters/text.ts` | `TextBackend` → text adapter（antigravity） | false |

### 2.3 新增模块

| 模块 id | Node.js 路径 | 定位 | 关键导出 |
|---------|--------------|------|----------|
| `index` | `src/index.ts` | 入口聚合（re-export） | — |
| `types` | `src/types.ts` | 统一中间表示 IR（AgentEvent/TaskResult/DaemonMessage/Lease payload） | `AgentEvent`/`AgentEventType`/`TaskResult`/`BackendTaskResult`/`DaemonMessage`/`LeasePayload` |
| `ws-client` | `src/ws-client.ts` | WebSocket 客户端（5s 重连 + HTTP 轮询兜底），从 daemon.py 拆出 | `WsClient`/`WsState`/`RECONNECT_INTERVAL_MS`/`CONNECT_TIMEOUT_MS`/`WsClientCallbacks`/`WsClientOptions` |

### 2.4 非代码文档

| 目标 | 变化 |
|------|------|
| `README.md`（仓库根） | 第 129 行 daemon 描述更新为「本地守护进程包（Node.js）」 |

---

## 3. 依赖关系变化（depends_on / used_by）

- `daemon`：新增 `depends_on: [ws-client]`（WS 逻辑独立）；`used_by: [cli]` 不变。
- `task-runner`：`depends_on` 中 `backends` 改为 `adapters`，`client` 改为 `hub-client`（模块 id 实际不变，仅 paths 变）。
- `backends`：原 `used_by: [task-runner, backend-*]` → Node 版拆为 `protocol-adapter`（接口，被各 adapter 实现）+ `adapters/index`（工厂，被 task-runner 调用）。
- 新增 `types`：被 `adapters/*`、`task-runner`、`daemon`、`hub-client` 引用（IR 层）。
- 新增 `ws-client`：`used_by: [daemon]`。

> 注：模块 **id 全部保持不变**（cli/config/protocol/client/.../backend-*）。本次只更新 `paths`、`main_symbols`、`depends_on`/`used_by`，并新增 index/types/ws-client 三条目，不改 id，避免反向引用断裂。

---

## 4. 未匹配文件

无。所有 Node.js `src/*.ts` 与 `src/adapters/*.ts` 均映射到已知或新增模块；Python 源码已删除，无孤儿文件。

---

## 5. 数据模型影响

**无数据库表变更**（daemon 不直接操作 DB，design.md N-05）。本地文件存储格式保持不变：
- `~/.sillyhub/daemon/config.json`（DaemonConfig）
- `~/.sillyhub/daemon/credentials.json`（0600）
- `~/.sillyhub/daemon/daemon.pid` / `daemon.log`

---

## 6. 更新结果

> step 3（sync-module-docs）已执行，全部同步完成。用户已确认写入。

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml`（全部 15 模块） | paths 全量迁移 `*.py`→`src/*.ts`（backends→adapters）；main_symbols 更新为 Node 导出；daemon depends_on +ws-client | ✅ 已同步 |
| `_module-map.yaml: index / types / ws-client` | 新增 3 个模块条目 | ✅ 已同步 |
| `_module-map.yaml` 头部 | generated_at→2026-06-14；source_commit→8229b42；last_change 标注本次变更 | ✅ 已同步 |
| `modules/cli.md` | Click→commander；符号 createProgram/stopAction/getPidFile/readPid/isProcessAlive；node bin；G-02 子命令不变 | ✅ 已同步 |
| `modules/config.md` | DaemonConfig 保留；新增 DEFAULT_CONFIG_*；uuid4→crypto.randomUUID | ✅ 已同步 |
| `modules/protocol.md` | 扁平常量→MSG/LEASE_STATE 对象 + 类型 + WS_PATH/REST_PREFIX；消息值不变 | ✅ 已同步 |
| `modules/client.md` | client.py→hub-client.ts；httpx→fetch；新增 HubHttpError + 7 Body 接口；REST 路径不变 | ✅ 已同步 |
| `modules/credential.md` | CredentialManager 保留；os.environ→process.env；0600/格式不变 | ✅ 已同步 |
| `modules/workspace.md` | WorkspaceManager/parseShortstat 保留；新增 GitError/WorkspaceResult；asyncio→child_process.spawn | ✅ 已同步 |
| `modules/version.md` | snake_case→camelCase；新增 SemVerTuple/MIN_VERSIONS | ✅ 已同步 |
| `modules/agent-detector.md` | AgentDef→AgentProviderSpec；AGENT_DEFS→PROVIDER_SPECS；shutil.which→which | ✅ 已同步 |
| `modules/task-runner.md` | 方案B深化：子进程执行下沉到此；getBackend 返回实例；新增 Runner* 接口 | ✅ 已同步 |
| `modules/daemon.md` | asyncio→setInterval/AbortController；WS 下沉 ws-client；depends_on +ws-client | ✅ 已同步 |
| `modules/backends.md` | backends/→adapters/；AgentBackend(ABC)→ProtocolAdapter 接口（纯 parse）；importlib→ESM import() | ✅ 已同步 |
| `modules/backend-stream-json.md` | StreamJsonBackend→StreamJsonAdapter；control_request via onControl | ✅ 已同步 |
| `modules/backend-json-rpc.md` | JsonRpcBackend→JsonRpcAdapter；传输层下沉 TaskRunner | ✅ 已同步 |
| `modules/backend-jsonl.md` | JsonlBackend→JsonlAdapter | ✅ 已同步 |
| `modules/backend-ndjson.md` | NdjsonBackend→NdjsonAdapter | ✅ 已同步 |
| `modules/backend-text.md` | TextBackend→TextAdapter | ✅ 已同步 |
| `modules/index.md`（新增） | 入口聚合 re-export | ✅ 已新建 |
| `modules/types.md`（新增） | 统一 IR；AgentEvent.type 值域 text/tool_use/tool_result/error/complete | ✅ 已新建 |
| `modules/ws-client.md`（新增） | WsClient/WsState/回调；5s 重连 + HTTP 轮询兜底；URL 推导 http→ws | ✅ 已新建 |

> `README.md`（仓库根）第 129 行 daemon 描述已在 execute 阶段更新为 Node.js，归档核验确认无需重复修改。
> 所有卡片 `<!-- MANUAL_NOTES_* -->` 标记保留，原区段为空。G-02 对外契约（REST 路径 / WS 消息值 / lease 状态机 / CLI 命令名 / config.json·credentials.json 格式）在卡片中保持原样。
