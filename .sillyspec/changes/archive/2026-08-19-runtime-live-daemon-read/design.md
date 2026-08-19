---
schema_version: 1
doc_type: design
change_name: 2026-08-19-runtime-live-daemon-read
author: qinyi
created_at: 2026-08-19T06:10:00+00:00
scale: large
status: draft
risk_level: medium
dependencies:
  - 2026-08-18-workspace-file-browser
related_memories:
  - local-daemon-restart-server-flag
  - sillyspec-worktree-node-modules-junction
---

# 运行时状态页面改为直读绑定 Daemon 实时状态

## 1. 背景与问题

当前 `/workspaces/[id]/runtime`（运行时状态）页面通过 5 个 `/api/workspaces/{id}/runtime/*` 端点读取数据：

- `GET /api/workspaces/{id}/runtime`：进度（`sillyspec.db`）
- `GET /api/workspaces/{id}/runtime/user-inputs` / `.../raw`
- `GET /api/workspaces/{id}/runtime/artifacts`
- `GET /api/workspaces/{id}/runtime/artifacts/{filename}`

后端 `RuntimeService` 直接读取平台容器内 `spec_ws.spec_root` 下由 `spec-sync` 推送上来的**快照**。该路径存在以下问题：

1. **数据滞后**：spec 增量同步明确排除 `.runtime/` 目录，本地 `.sillyspec/.runtime/` 的真实状态不会同步到平台；平台侧 `sillyspec.db` 只是历史快照。
2. **与 daemon 状态脱节**：用户真正关心的是本机守护进程正在执行的工作流，而不是平台容器里一份过时的镜像。
3. **已知坑反复**：`daemon-spec-sync-stale-cache-timeout` 等历史坑表明，依赖快照展示运行态会让用户误判执行结果。

目标：把运行时状态页的数据源从「平台侧同步快照」切换为「当前 workspace 绑定的 daemon 实时数据」。

## 2. 设计目标

- **FR-01**：运行时状态三类数据（流水线进度、用户输入记录、步骤产物）全部通过 workspace 当前用户绑定的 daemon 实时读取。
- **FR-02**：进度数据由 daemon 调用 sillyspec CLI 只读 JSON 命令获取，daemon 自身不直接解析 SQLite 格式。
- **FR-03**：复用现有 explorer 模块的绑定解析、WS RPC 转发、错误映射链路，保持鉴权与行为一致性。
- **FR-04**：单一数据源。daemon 离线/超时/读取失败时直接报错，不回退到平台快照。
- **FR-05**：前端页面文案从「本地运行态 / 不作为长期事实源」更新为「守护进程运行态 / 实时工作流状态」。

## 3. 非目标

- **NG-01**：不改 daemon 与 backend 之间的 WS 连接模型，不新增浏览器到 daemon 的直连通道。
- **NG-02**：不把运行时数据写回平台侧进度同步层（platform_sync）；本次只读，不写。
- **NG-03**：不改造 sillyspec.db 的存储格式；只新增只读查询命令。
- **NG-04**：不改变 workspace 成员绑定模型；只消费 `workspace_member_runtimes` 已有绑定行。
- **NG-05**：不删除 `runtime` 模块已有的 schema 定义（`RuntimeProgress`、`StageProgress`、`ArtifactEntry` 等继续复用）。

## 4. 总体方案

### 4.1 链路总览

```text
浏览器
  ↓
frontend /workspaces/[id]/runtime
  ↓ (5 个 /api/workspaces/{id}/runtime/* 端点，URL 不变)
backend RuntimeLiveService
  ↓ MemberBindingResolver.resolve_member_binding_or_none(user_id, workspace_id)
daemon WS RPC (runtime_read_*)
  ↓
sillyhub-daemon RPC handler
  ├─ runtime_read_progress → spawn sillyspec progress dump --json ...
  ├─ runtime_read_user_inputs → readFile(specCacheRoot/.runtime/user-inputs.md)
  ├─ runtime_list_artifacts → listDir(specCacheRoot/.runtime/artifacts)
  └─ runtime_read_artifact → readFile(specCacheRoot/.runtime/artifacts/{filename})
```

### 4.2 方案选择

最终采用「方案 A：backend 代理 RPC」。理由：

- 与 `2026-08-18-workspace-file-browser` 已验证的 explorer 链路同构，绑定解析、鉴权、错误映射全部复用。
- 前端 URL 与 schema 不变，改动最小。
- daemon 侧新增独立 `runtime_*` RPC 命名空间，不污染 `host_fs` 九方法契约。
- sillyspec 只读 JSON 命令作为子进程调用，符合 machine-interface 设计，db 格式演进不锁死 daemon。

D-001@v1：daemon 离线/失败不回退平台快照，直接按 explorer 错误映射报 502/504/422/403/404。  
D-002@v1：进度（sillyspec.db）经 sillyspec CLI 新增只读 JSON 命令读取，daemon 不直接解析 SQLite。  
D-003@v1：三类数据全部改为实时读 daemon。  
D-004@v1：鉴权复用 `MemberBindingResolver` 用户门控绑定解析，只读自己 daemon 数据。  
D-005@v1：daemon 侧新增独立 `runtime_*` RPC 命名空间，不污染 `host_fs` 九方法契约。

## 5. 文件变更清单

### backend

| 文件 | 动作 | 说明 |
|------|------|------|
| `backend/app/modules/runtime/router.py` | 改 | 端点改调 `RuntimeLiveService`，原 `RuntimeService` 容器直读逻辑删除 |
| `backend/app/modules/runtime/service.py` | 改/拆 | 新增 `RuntimeLiveService`；原 `RuntimeService` 删去快照读法（或整体替换） |
| `backend/app/modules/runtime/schema.py` | 可能新增 | 如需要统一 envelope 类型 |
| `backend/app/modules/runtime/tests/test_router.py` | 改 | mock daemon RPC 而非写本地 db |
| `backend/app/modules/runtime/tests/test_live_service.py` | 新增 | `RuntimeLiveService` 错误映射、绑定缺失、RPC 成功路径 |

### sillyhub-daemon

| 文件 | 动作 | 说明 |
|------|------|------|
| `sillyhub-daemon/src/daemon.ts` | 改 | 注册 `runtime_*` RPC handler |
| `sillyhub-daemon/src/runtime-handler.ts` | 新增 | daemon 侧 runtime 读取业务层 |
| `sillyhub-daemon/src/api-types.ts` | 可能改 | gen:types 同步 backend schema |
| `sillyhub-daemon/tests/runtime-handler.test.ts` | 新增 | handler 单元测试（tests/ 目录，复数，对齐仓内测试布局） |

### frontend

| 文件 | 动作 | 说明 |
|------|------|------|
| `frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx` | 改 | 标题/副标题/错误提示文案 |

### 跨仓 sillyspec

| 文件 | 动作 | 说明 |
|------|------|------|
| `sillyspec/src/progress.js` | 改 | `ProgressManager.dump(workspaceId?)` 只读查询 |
| `sillyspec/src/index.js` | 改 | 注册 `sillyspec progress dump --json` 命令 |
| `sillyspec/src/machine-interface.js` | 可能改 | 复用/扩展 envelope 组装 |
| `sillyspec/tests/progress-dump.test.js` | 新增 | 只读 JSON 输出测试 |

## 6. 接口定义

### 6.1 backend → daemon WS RPC

方法名带 `runtime.` 前缀，与 `host_fs.*` 同风格（点号分隔），与 `explorer_*`（下划线）并列但独立命名空间。

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `runtime.read_progress` | `{workspace_id: string}` | `{progress: RuntimeProgress \| null}` | 调用 sillyspec CLI 取进度 |
| `runtime.read_user_inputs` | `{workspace_id: string}` | `{content: string \| null}` | 读 `.runtime/user-inputs.md` |
| `runtime.list_artifacts` | `{workspace_id: string}` | `{artifacts: ArtifactEntry[]}` | 列 `.runtime/artifacts` |
| `runtime.read_artifact` | `{workspace_id: string, filename: string}` | `{content: string \| null}` | 读单个产物；filename 在 daemon 侧做 `..`/绝对路径拒绝 |

**鉴权与 user_id 来源**：backend router 通过 FastAPI `Depends(get_current_principal)` 取当前用户；`RuntimeLiveService` 将 `(workspace_id, user_id)` 传给 `MemberBindingResolver.resolve_member_binding_or_none`。只有用户自己的 binding 行有效，未绑定或 `daemon_id IS NULL` 均按未绑定处理。

### 6.2 daemon → sillyspec CLI

新增命令：

```bash
sillyspec progress dump --spec-dir <specCacheRoot> --json
```

输出机器接口 envelope：

```json
{
  "schema_version": 1,
  "command": "progress dump",
  "ok": true,
  "errors": [],
  "warnings": [],
  "data": {
    "project": "...",
    "current_stage": "...",
    "current_change": "...",
    "stages": { ... },
    "last_active": "2026-08-19T06:10:00Z",
    "user_inputs": "...",
    "artifacts": [{"filename": "...", "size_bytes": 0, "last_modified": "..."}]
  },
  "generated_at": "2026-08-19T06:10:00Z"
}
```

- 只读，不写 db。
- 无活跃变更或数据缺失时 `data` 为 `null`。
- daemon 用 `--spec-dir` 传入 spec 真源目录（`~/.sillyhub/daemon/specs/<workspace_id>/`，与现有 spec-sync 缓存目录一致）；sillyspec CLI 按该目录下的 `.sillyspec-platform.json` 指针解析数据库位置。`--spec-dir` 已含 workspace 信息，不需要额外 `--workspace-id`。

### 6.3 错误映射

映射逻辑复用 explorer 实现，但暴露给 runtime 模块的错误类新建 `Runtime*` 子类，避免 HTTP body 泄漏内部 `Explorer*` 模块名。

| daemon 侧异常 | backend 错误类 | HTTP | 前端展示 |
|---------------|----------------|------|----------|
| 无绑定 | `RuntimeNotBound` | 404 | 「请先完成成员绑定」 |
| daemon 离线 / send 失败 | `RuntimeDaemonOffline` | 502 | 「守护进程离线，请确认 daemon 在线」 |
| RPC 在途断连 | `RuntimeTransferInterrupted` | 502 | 「传输中断，请稍后重试」 |
| 超时 | `RuntimeRpcTimeout` | 504 | 「请求超时」 |
| daemon 返回 `forbidden` | `RuntimeDaemonForbidden` | 403 | 「守护进程拒绝访问」 |
| daemon 返回 `not_found` | `RuntimePathNotFound` | 404 | 「文件或目录不存在」 |
| daemon 返回 `method_not_found` | `RuntimeDaemonTooOld` | 422 | 「守护进程版本过旧，请升级」 |
| 其他 daemon 业务错误 | `RuntimeDaemonRemoteError` | 502 | 「守护进程执行失败」 |

所有错误类继承 `AppError`，字段 `code` 以 `HTTP_` 开头（如 `HTTP_404_RUNTIME_NOT_BOUND`），与 explorer 错误映射表保持一一对应。

## 7. 生命周期契约表

本变更涉及 daemon 与 backend 之间的 RPC 交互，但**不引入新的持久化状态或状态转移**。生命周期事件如下：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|------|--------|--------|----------|----------|
| `runtime.read_progress` RPC | backend RuntimeLiveService | sillyhub-daemon | `workspace_id` | 无持久状态变化；只读 |
| `runtime.read_user_inputs` RPC | backend RuntimeLiveService | sillyhub-daemon | `workspace_id` | 无持久状态变化；只读 |
| `runtime.list_artifacts` RPC | backend RuntimeLiveService | sillyhub-daemon | `workspace_id` | 无持久状态变化；只读 |
| `runtime.read_artifact` RPC | backend RuntimeLiveService | sillyhub-daemon | `workspace_id`, `filename` | 无持久状态变化；只读 |
| sillyspec `progress dump` 子进程 | sillyhub-daemon | sillyspec CLI | `--spec-dir`, `--json` | 只读 sillyspec.db，不写任何状态 |

**结论**：本变更不涉及 session / lease / agent_run 状态机，生命周期契约表仅用于声明 RPC 只读语义（不适用持久生命周期变化）。

## 8. 风险登记

| 编号 | 风险 | 可能性 | 影响 | 缓解措施 |
|------|------|--------|------|----------|
| R-01 | 跨仓 sillyspec 命令发版与 daemon 宿主升级不同步，旧版 sillyspec 不支持 `progress dump` | 中 | daemon 报 method_not_found，用户看到「版本过旧」 | daemon handler 检查 `sillyspec --version` 或捕获 `method_not_found`；错误提示带升级命令 |
| R-02 | sillyspec.db 格式未来变更，dump 命令输出字段变化 | 低 | backend/daemon 解析失败 | dump 命令归 sillyspec 仓管，版本与 db schema 一起演进；backend/daemon 通过 api-types 同步 |
| R-03 | daemon 离线时页面完全不可用（用户已接受不回退快照） | 中 | 功能不可用但语义诚实 | 错误提示明确说明需启动 daemon，避免用户误以为平台 bug |
| R-04 | 大产物文件经 WS RPC 文本传输超时 | 中 | 读产物 504 | 单产物限制 1MB，超时 30s；超限时返回 413/504 并提示「产物过大，请用文件浏览器下载」 |
| R-05 | 多 workspace 成员绑定但 daemon_id 不同，resolve 到非预期 daemon | 低 | 读到错误数据 | `resolve_daemon_instance_for_workspace` 取第一条 `daemon_id IS NOT NULL` 行；与 explorer 同逻辑，已知可接受 |
| R-06 | backend 删除原容器直读逻辑后，平台侧无 daemon 绑定的 workspace 无法展示任何 runtime 数据 | 中 | 与旧行为变化 | 这些 workspace 原本也读的是空/过时快照；新行为报错更明确 |

## 9. 部署与兼容

- **backend**：纯后端逻辑改动，滚动部署即可。
- **sillyhub-daemon**：新增 handler 需要重新 build 并分发；不破坏旧 daemon 的现有行为（旧 daemon 未注册 `runtime.*`，backend 会收到 `method_not_found`，映射为 422 引导升级）。
- **sillyspec CLI**：需要发新版并更新 `MIN_SILLYSPEC_VERSION_FOR_INIT` 等门控（如适用）。由于 `progress dump` 是全新只读命令，旧版不存在时不会影响其他功能。
- **frontend**：文案改动，跟随 backend 一起发布。

## 10. 验收标准

- `GET /api/workspaces/{id}/runtime` 在有绑定 daemon 时返回实时进度；无绑定时 404。
- daemon 离线时返回 502 并带中文引导。
- 旧版 daemon 未注册 `runtime.*` 时返回 422「守护进程版本过旧」。
- 页面标题/副标题不再含「本地运行态 / 不作为长期事实源」。
- backend runtime 模块测试不再依赖本地文件系统写 `sillyspec.db` 快照，改为 mock daemon RPC。
- sillyspec `progress dump --json` 输出符合 machine-interface envelope schema。

## 11. 自审

- ✅ 背景、目标、非目标、总体方案、文件变更清单、接口定义、风险登记、验收标准齐全。
- ✅ frontmatter 含 `scale: large`（跨 backend/daemon/frontend/跨仓 sillyspec）。
- ✅ 涉及 daemon/lifecycle 关键词，已提供生命周期契约表并声明只读语义。
- ✅ 引用了 D-001~D-005 当前版本决策。
- ✅ 错误映射明确新建 `Runtime*` 错误子类，不复用 `Explorer*` 类名。
- ✅ RPC 方法名统一为 `runtime.*` 点号风格；filename 路径穿越防护、user_id 来源、大产物 timeout 均已补充。
