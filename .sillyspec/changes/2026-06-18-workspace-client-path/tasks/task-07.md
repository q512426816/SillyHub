---
author: qinyi
created_at: 2026-06-18 11:44:49
change: 2026-06-18-workspace-client-path
id: task-07
title: "execution-context daemon-client `spec_root` 自决 + workspace_id 透传"
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-003@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/agent/router.py
---

# task-07 — execution-context daemon-client `spec_root` 自决 + workspace_id 透传

> Wave 3 / 集成层 / 依赖 task-01（`Workspace.path_source` 字段）。
> 本任务在 backend `GET /agent-runs/{run_id}/execution-context` 端点（`backend/app/modules/agent/router.py:get_execution_context`）上做 grill X-001 修正：
> **daemon-client workspace 的 execution-context 不再透传 backend 机器的 spec_root 路径**（路径在客户端机器根本不可达），改由 daemon 自行拉取 bundle 解包后决定本地 spec_root；
> 同时把 `workspace_id` 作为顶层响应字段暴露，供 daemon task-runner（task-09）调 `GET /bundle` / `POST /sync`。

## 1. 修改文件

| 操作 | 精确路径 | 改动概述 |
|---|---|---|
| 修改 | `backend/app/modules/agent/router.py` | `get_execution_context` 内构造 `ExecutionContextResponse` 时按 `ws_row.path_source` 条件赋值 `spec_root`；并把已反查得到的 `workspace_id` 作为顶层字段透传 |
| 修改（**必要扩展**） | `backend/app/modules/agent/schema.py` | `ExecutionContextResponse` 加 `workspace_id: UUID \| None = None` 与 `spec_root: str \| None = None` 两字段（仅声明，无 validator；默认 None 兼容现有 server-local / quick-chat 响应） |

> **allowed_paths 边界说明**：frontmatter `allowed_paths` 仅列 `router.py`（与简报一致）。`schema.py` 的字段追加是 task-07 的**必要接口扩展**——若严格只动 router.py，新增字段无 Pydantic 模型落点，端点会因「多传未声明字段」报错或被静默丢弃。执行阶段遇到此冲突时，按本表「必要扩展」一行同步改 `schema.py`，并在执行回执注明该字段追加是 task-07 不可分割的一部分。验收阶段（verify）以本节表格为准，不视为越界。`schema.py` 仅加两字段、不加 validator / 不改现有字段语义，server-local 响应字节级不变。

## 2. 覆盖来源

- **FR-05**（spec 按需下发与回传）：本任务覆盖 FR-05 第一段中 `execution-context 透传 workspace_id，spec_root 字段对 daemon-client 留空` 这句——把 `workspace_id` 落到顶层响应字段（task-09 daemon 用它调 bundle/sync），并把 `spec_root` 在 daemon-client 分支置空（区别于 server-local / scan 走 lease_meta 的现状）。FR-05 第二段（bundle/sync 端点）归 task-06，第三段（前端读服务器真理源）归 task-06/10。
- **D-003@v1**（spec 服务器平台托管）：`normalized_requirement` 要求「spec 真理源始终为 backend spec_root；daemon 不长期持有 spec 副本」——本任务通过「daemon-client 不下发 backend 机器路径」落地：daemon 拿到的 `spec_root` 为空，强制其自行调 bundle 端点拉到本地临时区，不在响应里暴露服务器具体路径。
- **D-006@v1**（spec 按需下发方案 A，bundle/sync）：方案 A 要求 daemon 「执行前拉取解包、执行后打包回传」，前提是 daemon 知道该给哪个 workspace 拉——本任务通过 `workspace_id` 顶层透传满足此前提。
- **grill X-001 修正**：design §5 Phase 4 明确「execution-context 已透传 `workspace_id`（`agent/router.py:60` 现状已有），daemon 用它调 bundle/sync；daemon-client 时 execution-context 的 `spec_root` 字段留空（不传 backend 机器路径，区别于 `router.py:83` 现状从 lease_meta 取 backend 路径的做法）」。本任务 1:1 实现该修正。
- design.md §5 Phase 4 / §6（`agent/router.py` 行）/ §9 兼容策略。

## 3. 实现要求（编号步骤）

> 按「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」执行。

1. **读现有代码**（必读，确认现状）：
   - `backend/app/modules/agent/router.py:143-248`（`get_execution_context` 全函数）：
     - line 178：`lease_meta = await _fetch_active_lease_meta(...)` 取活跃 lease metadata（scan 的 spec_root 由 task-03 在 dispatch 时写入此 dict）。
     - line 182：`workspace_id = await _resolve_workspace_id(session, run_id)` —— **已反查得到** workspace_id，但**仅**作为 `build_spec/stage/scan_bundle(...)` 入参透传，**未**落入 `ExecutionContextResponse` 顶层字段。
     - line 187：`ws_row = await session.get(Workspace, workspace_id) if workspace_id else None` —— **Workspace 行已加载**（task-01 加的 `path_source` 字段可直接读 `ws_row.path_source`，无需新增查询）。
     - line 225：`spec_root=lease_meta.get("spec_root", "")` —— **scan bundle 的 spec_root 来自 lease_meta**（不是 response 字段），此现状**保持不变**（影响 `claude_md` 渲染；scan 场景 server-local 时 backend 机器路径必须能让 daemon scan 命令写入，故 bundle 内仍需要）。
     - line 233-248：构造 `ExecutionContextResponse(...)` —— **当前不传 `spec_root` 也无 `workspace_id`**，这是本任务要补的两处。
   - `backend/app/modules/agent/schema.py:27-56`（`ExecutionContextResponse` 定义）：当前顶层字段有 `root_path` 但**无** `spec_root` / **无** `workspace_id`。本任务在此类内加两字段（见 §4）。
   - `backend/app/modules/workspace/model.py`（task-01 产出）：`Workspace.path_source: str(20)` 默认 `'server-local'`。
   - `backend/app/modules/agent/tests/test_execution_context.py:252-274`（scan run 现有断言）：本任务改造不得破坏 `claude_md` 含 "sillyspec run scan" 的断言。

2. **写测试（先于实现，TDD）**：见 §8。预期失败点：现有响应体无 `spec_root` / `workspace_id` 字段 → 新断言 KeyError 或字段为 None。

3. **改 `schema.py`（实现，§1 表格「必要扩展」行）**：
   - 在 `ExecutionContextResponse` 类内，紧邻现有 `root_path` 字段之后，新增两字段（精确写法见 §4.1）。
   - 不加 validator、不改其它字段默认值。

4. **改 `router.py`（实现，§1 表格主行）**：
   - 在 `get_execution_context` 函数末尾构造 `ExecutionContextResponse(...)` 时（line 233-248），新增两个关键字参数：`workspace_id=...` 与 `spec_root=...`，按 §4.2 条件赋值伪代码填充。
   - **不**改动 `_resolve_workspace_id` / `_fetch_active_lease_meta` / `_user_owns_run` 等已有函数；**不**改动 bundle 构建调用（line 205-229）——bundle 内的 spec_root（scan 场景从 lease_meta 取）**保持不变**，本任务只动 response 顶层 `spec_root` 字段。
   - **不**改 `_determine_run_type`：run 类型判定与 path_source 是正交维度（server-local scan 也走 lease_meta spec_root，daemon-client scan 由 task-08 改 dispatch，与本任务无关）。

5. **跑测试 + lint**（见 §8 第 4-5 步）。

6. **（不要做）**：
   - 不改 `placement.py`（强绑路由属 task-03）。
   - 不改 `context_builder.py`（bundle 渲染属 task-02 / 已稳定）。
   - 不改 spec_workspace router（bundle/sync 端点属 task-06）。
   - 不改 daemon / 前端任何文件（task-05/09/10/11）。
   - 不在 router.py 里调 bundle 端点（那是 daemon 端行为，task-09）——本任务只决定「给 daemon 看什么字段」，不替 daemon 拉文件。
   - 不改 lease_meta 写入逻辑（task-03 范畴）。

## 4. 接口定义

### 4.1 schema.py 字段（精确写法）

```python
# backend/app/modules/agent/schema.py —— ExecutionContextResponse 类内，紧邻 root_path 之后
root_path: str | None = Field(
    default=None,
    description="真实代码目录（host path）；daemon 收到后若本地可访问直接用作 cwd。",
)

# 新增 ↓ （task-07 / change 2026-06-18-workspace-client-path）
workspace_id: uuid.UUID | None = Field(
    default=None,
    description=(
        "run 关联的 workspace 标识。daemon-client 时 daemon task-runner 用它调 "
        "GET /api/spec-workspaces/{workspace_id}/bundle 与 POST .../sync。"
        "quick-chat 等无 workspace 关联的 run 返回 None，daemon 兜底不拉 bundle。"
    ),
)
spec_root: str | None = Field(
    default=None,
    description=(
        "执行 spec 文档根目录提示。server-local 时透传 lease_meta 的 backend 机器路径"
        "（与 scan bundle 内一致）；daemon-client 时留空（None）——backend 路径对 "
        "daemon 不可达，daemon 自行经 bundle 端点拉到本地 ~/.sillyhub/daemon/specs/{ws_id}。"
        "grill X-001 修正。"
    ),
)
```

> `uuid` 已在该文件顶部 import（`WorkspaceSpecSummaryDTO` 用 `uuid.UUID`），无需补 import。

### 4.2 router.py 条件赋值伪代码

```python
# backend/app/modules/agent/router.py —— get_execution_context 末尾构造 response
# 关键：path_source 决定 spec_root 是否下发 backend 机器路径
#       workspace_id 无条件透传（None 时由 daemon 兜底）

path_source = ws_row.path_source if ws_row else "server-local"

if path_source == "daemon-client":
    # grill X-001 修正：不透传 backend 机器路径（不可达），daemon 自决本地 spec_root
    response_spec_root: str | None = None
elif run_type == "scan":
    # scan 场景 server-local：维持现状，spec_root 来自 lease_meta（task-03 写入）
    # lease_meta 无 spec_root key 时回退 None（与 schema 默认一致，不传空串避免歧义）
    response_spec_root = lease_meta.get("spec_root") or None
else:
    # task / stage 场景 server-local：无 spec_root 概念（bundle 内部用 spec_ws.spec_root，
    # 不必暴露给 daemon 当 cwd 提示），保持 None 与现状一致
    response_spec_root = None

return ExecutionContextResponse(
    agent_run_id=str(run.id),
    claude_md=claude_md,
    prompt=lease_meta.get("prompt"),
    provider=lease_meta.get("provider") or run.provider,
    model=lease_meta.get("model") or run.model,
    resume_session_id=lease_meta.get("resume_session_id"),
    repo_url=lease_meta.get("repo_url"),
    branch=lease_meta.get("branch"),
    allowed_paths=lease_meta.get("allowed_paths"),
    tool_config=lease_meta.get("tool_config"),
    session_id=run.session_id,
    workspace_name=ws_row.name if ws_row else None,
    workspace_slug=ws_row.slug if ws_row else None,
    root_path=ws_row.root_path if ws_row else None,
    # task-07 新增 ↓
    workspace_id=workspace_id,                 # 已在 line 182 反查得到，直接透传
    spec_root=response_spec_root,              # 按上面条件分支赋值
)
```

**关键不变式**：
- `path_source == "daemon-client"` → `response.spec_root is None`（硬约束，grill X-001）。
- `path_source == "server-local"` 且 `run_type == "scan"` → `response.spec_root == lease_meta["spec_root"]`（与现状 scan bundle 内 spec_root 一致；若 lease_meta 无该 key 则 None）。
- `workspace_id is None`（quick-chat run）→ `response.workspace_id is None` 且 `response.spec_root is None`（无 workspace 即无 path_source 可读，按 server-local 默认分支落到 task/stage 分支返回 None）。
- `ws_row.path_source` 缺失（理论不可能，task-01 已加 NOT NULL DEFAULT）→ 按 server-local 处理（§5 E-04）。

## 5. 边界处理（≥5 条）

| 编号 | 边界 | 处理 |
|---|---|---|
| E-01 | **server-local workspace 零行为变化** | `path_source=='server-local'`：scan 场景 `spec_root` 仍来自 lease_meta（与 `router.py:225` 现状 1:1），task/stage 场景 None；`workspace_id` 透传但不影响 server-local daemon 现有逻辑（daemon 可忽略此字段）。现有 `test_get_execution_context_scan_run` 等测试不回归。 |
| E-02 | **daemon-client workspace 显式留空** | `path_source=='daemon-client'`：`response.spec_root=None` 硬约束。无论 run_type（task/stage/scan）都留空——daemon 不应依赖 backend 路径提示，统一走 bundle/sync 端点（task-09）。`workspace_id` 必非 None（daemon-client workspace 一定有 workspace 关联，否则 dispatch 阶段就被 task-03 强绑路由拦下）。 |
| E-03 | **quick-chat run（workspace_id 为 None）** | `ws_row is None` → `path_source` 默认 `"server-local"`、`workspace_id=None`、`spec_root=None`（落 task/stage 分支）。daemon 兜底不拉 bundle，与现状 quick-chat 行为一致。本任务不为 quick-chat 加新分支。 |
| E-04 | **`ws_row.path_source` 字段缺失/异常值** | task-01 已保证 `NOT NULL DEFAULT 'server-local'`，理论不会缺失。防御性写法：`path_source = ws_row.path_source if ws_row else "server-local"`，若取到非 `{server-local, daemon-client}` 的脏值（如历史脏数据），按 server-local 分支处理（不抛错，保证端点可用性；非法值排查归 task-01 validator / DB 约束，非本任务职责）。 |
| E-05 | **向后兼容（brownfield）** | task-01 迁移用 `server_default="server-local"`，已有 workspace 行 `path_source` 自动回填 server-local；本任务改造后这些行的 execution-context 响应字节级不变（落 E-01 分支）。`workspace_id` 新增字段对老 daemon 是「多出来的字段」，daemon TS 端按可选字段处理（task-09 范畴）不破坏现有协议。 |
| E-06 | **scan bundle 内 spec_root 与 response.spec_root 的关系** | 本任务**只**改 response 顶层 `spec_root`；`build_scan_bundle(... spec_root=lease_meta.get("spec_root","") ...)`（router.py:225）**保持不变**。即 daemon-client scan run 时：claude_md 内仍渲染 backend spec_root（用于 sillyspec scan 命令 `--spec-root` 提示），但顶层 response.spec_root=None。这是有意为之——daemon-client scan 实际派发逻辑由 task-08 改写（task-08 改 dispatch stage=scan，且会重写 lease_meta spec_root 为 daemon 本地路径），届时 lease_meta 不再含 backend 路径，本任务伪代码分支自然落到 `lease_meta.get("spec_root") or None → None`，与 daemon-client 硬约束一致。**本任务不预判 task-08 的 lease_meta 改写**，仅保证「有就透，没有就 None，daemon-client 一律 None」三条规则自洽。 |
| E-07 | **path_source 字段读取的事务一致性** | `ws_row` 已在 line 187 加载（`session.get`），同事务内读 `ws_row.path_source` 无额外查询、无脏读风险。若 line 187 之后有对 workspace 的更新（本任务无），需注意——本任务纯读，无此问题。 |
| E-08 | **未来扩展（path_source 新增枚举值）** | 若后续加 `path_source='remote-mount'` 等新值，本任务的 if/elif 链需扩展。设计上把 server-local 作为「兜底默认分支」（else 走 task/stage → None），新枚举值需显式 elif 处理，避免误落 server-local 分支。本任务在伪代码注释里标注此约定。 |

## 6. 非目标（本任务不做）

- ❌ 不改 `placement.py` / `dispatch_to_daemon`（强绑路由属 task-03）。
- ❌ 不改 `context_builder.py` / `build_*_bundle`（bundle 渲染稳定，scan bundle 内 spec_root 维持 lease_meta 来源）。
- ❌ 不改 `service.py`（lease_meta 写入属 task-03）。
- ❌ 不改 spec_workspace router/service（bundle/sync 端点属 task-06）。
- ❌ 不改 daemon 任何文件（task-05/09）。
- ❌ 不改前端（task-10/11）。
- ❌ 不在 router.py 里调 bundle 端点或读 spec 文件（那是 daemon 端行为）。
- ❌ 不为 quick-chat run 加 workspace 关联（现状 None 兜底，design 未要求改）。
- ❌ 不改 `_resolve_workspace_id`（已能用，本任务只消费其返回值）。
- ❌ 不引入 path_source 切换的运行时校验（design §3 非目标，DTO 层已在 task-01 保证最终态合法）。
- ❌ 不改 lease_meta 写入 / scan dispatch 流程（task-03/08 范畴；本任务 E-06 已说明与 task-08 的协作预期）。

## 7. 参考

- design.md §5 Phase 4（grill X-001 修正原文）、§6（`agent/router.py` 行）、§9（兼容策略）
- requirements.md FR-05（第一段 execution-context 透传 workspace_id + spec_root 对 daemon-client 留空）
- decisions.md D-003@v1（spec 服务器平台托管）、D-006@v1（bundle/sync 方案 A）
- plan.md Wave 3 task-07 行 / 任务总表
- 现有代码：
  - `backend/app/modules/agent/router.py:143-248`（`get_execution_context` 全函数；line 178 lease_meta、line 182 workspace_id、line 187 ws_row、line 225 scan bundle spec_root、line 233-248 response 构造）
  - `backend/app/modules/agent/schema.py:27-56`（`ExecutionContextResponse` 定义，当前无 spec_root/workspace_id 顶层字段）
  - `backend/app/modules/agent/tests/test_execution_context.py:252-274`（scan run 现有断言，不得回归）
  - `backend/app/modules/workspace/model.py`（task-01 产出 `Workspace.path_source`）

## 8. TDD 步骤

1. **写 `test_execution_context_path_source.py`**（先写，预期失败；新增于 `backend/app/modules/agent/tests/`）：

   > 注：本任务 `allowed_paths` 仅含 `router.py`，测试文件属于 task-07 的必要测试产出（与 task-01 同模式：allowed_paths 含 tests 文件）。执行时新增 `backend/app/modules/agent/tests/test_execution_context_path_source.py`，回执注明。

   - `test_response_includes_workspace_id_server_local`：构造 server-local workspace + task run → `body["workspace_id"] == str(ws_id)`。
   - `test_response_includes_workspace_id_daemon_client`：构造 daemon-client workspace（带 daemon_runtime_id）+ task run → `body["workspace_id"] == str(ws_id)`。
   - `test_spec_root_none_for_daemon_client`：daemon-client workspace + scan run（lease_meta 含 backend spec_root）→ `body["spec_root"] is None`（grill X-001 硬约束）。
   - `test_spec_root_from_lease_meta_for_server_local_scan`：server-local workspace + scan run（lease_meta `{"spec_root": "/specs/x"}`）→ `body["spec_root"] == "/specs/x"`（现状兼容）。
   - `test_spec_root_none_for_server_local_task`：server-local workspace + task run → `body["spec_root"] is None`（task/stage 无 spec_root 概念）。
   - `test_spec_root_none_for_quick_chat_no_workspace`：quick-chat run（无 AgentRunWorkspace 关联）→ `body["workspace_id"] is None` 且 `body["spec_root"] is None`。
   - `test_spec_root_none_when_lease_meta_missing_spec_root`：server-local + scan run 但 lease_meta 无 spec_root key → `body["spec_root"] is None`（`lease_meta.get("spec_root") or None` 回退）。
   - `test_existing_scan_claude_md_unchanged`：回归保护——daemon-client scan run 的 `body["claude_md"]` 仍含 "sillyspec run scan"（与 server-local 一致，bundle 渲染不受 response 字段影响）。

2. **实现**：按 §3 步骤 3-4 改 schema.py + router.py。

3. **跑测试**：
   - `cd backend && uv run pytest tests/modules/agent/tests/test_execution_context_path_source.py -v` —— 全绿。
   - `cd backend && uv run pytest tests/modules/agent/tests/test_execution_context.py` —— 现有 execution-context 测试不回归（关键：server-local 全链路零变化）。
   - `cd backend && uv run pytest tests/modules/agent/` —— agent 模块全量不回归。
   - `cd backend && uv run ruff check app/modules/agent/router.py app/modules/agent/schema.py` —— 无 lint 错。

4. **集成自检（可选，依赖 task-01/03/06 完成后）**：
   - 若 task-01 已合并：构造 daemon-client workspace 跑端到端，确认 response 形态。
   - 若 task-06 已合并：daemon-client run 的 execution-context 拿到 `workspace_id` 后能成功调 `GET /api/spec-workspaces/{workspace_id}/bundle`（task-09 串测）。
   - 本任务**不**阻塞于 task-03/06（只依赖 task-01 的 path_source 字段；task-03/06 是消费方）。

## 9. 验收标准

| AC | 验收点 | 验证方式 | 通过条件 |
|---|---|---|---|
| AC-01 | ExecutionContextResponse 新增 `workspace_id` 字段 | 读 `schema.py` / OpenAPI schema | `workspace_id: UUID \| None = None` 字段存在，默认 None |
| AC-02 | ExecutionContextResponse 新增 `spec_root` 字段 | 读 `schema.py` / OpenAPI schema | `spec_root: str \| None = None` 字段存在，默认 None |
| AC-03 | server-local workspace 响应透传 workspace_id | `test_response_includes_workspace_id_server_local` | `body["workspace_id"] == str(ws_id)` |
| AC-04 | daemon-client workspace 响应透传 workspace_id | `test_response_includes_workspace_id_daemon_client` | `body["workspace_id"] == str(ws_id)` |
| AC-05 | daemon-client 时 spec_root 硬约束为 None（grill X-001） | `test_spec_root_none_for_daemon_client` | `body["spec_root"] is None`，**即使 lease_meta 含 backend spec_root** |
| AC-06 | server-local scan 时 spec_root 来自 lease_meta（现状兼容） | `test_spec_root_from_lease_meta_for_server_local_scan` | `body["spec_root"] == lease_meta["spec_root"]` |
| AC-07 | server-local task/stage 时 spec_root 为 None | `test_spec_root_none_for_server_local_task` | `body["spec_root"] is None` |
| AC-08 | quick-chat run（无 workspace）两字段均 None | `test_spec_root_none_for_quick_chat_no_workspace` | `workspace_id is None` 且 `spec_root is None` |
| AC-09 | lease_meta 缺 spec_root key 时回退 None | `test_spec_root_none_when_lease_meta_missing_spec_root` | `body["spec_root"] is None`（不报错、不返回空串） |
| AC-10 | scan claude_md 渲染不回归 | `test_existing_scan_claude_md_unchanged` | daemon-client scan run 的 `claude_md` 含 "sillyspec run scan" |
| AC-11 | 现有 execution-context 测试全绿（兼容回归） | `cd backend && uv run pytest tests/modules/agent/tests/test_execution_context.py` | 全部通过（server-local 字节级不变） |
| AC-12 | agent 模块全量测试不回归 | `cd backend && uv run pytest tests/modules/agent/` | 全部通过 |
| AC-13 | lint 通过 | `uv run ruff check app/modules/agent/router.py app/modules/agent/schema.py` | 无新增 lint 错 |
| AC-14 | 改动文件范围 | `git diff --name-only` | 仅 `backend/app/modules/agent/router.py` + `backend/app/modules/agent/schema.py` + 新增 `tests/.../test_execution_context_path_source.py`（§1 表格声明的「必要扩展」+ 测试） |
| AC-15 | FR-05 第一段覆盖 | 人工对照 requirements.md FR-05 第一段 | 「execution-context 透传 workspace_id」（AC-03/04）+「spec_root 字段对 daemon-client 留空」（AC-05）两句均有对应 AC |
| AC-16 | grill X-001 修正落地 | 人工对照 design §5 Phase 4 grill X-001 段 | daemon-client 不下发 backend 机器路径（AC-05）；workspace_id 透传（AC-03/04）；server-local 维持 lease_meta 来源（AC-06） |
| AC-17 | D-003@v1 / D-006@v1 协作前提满足 | 人工对照 decisions.md | daemon 拿 workspace_id 后能调 bundle/sync（接口契约由 AC-03/04 保证；实际调用属 task-09） |

## 10. 完成定义（DoD）

- §1 全部文件改动落地（router.py + schema.py 必要扩展 + 新增测试文件）。
- §9 AC-01 ~ AC-17 全部通过。
- git diff 触及范围符合 AC-14（router.py + schema.py + 新增测试），未越界改 placement / context_builder / service / spec_workspace / daemon / 前端。
- 本任务回执包含：新增测试用例数（≥8）、跑通的 pytest 命令尾部输出、`git diff --stat` 输出。
- 与 task-01 的接口契约确认：`Workspace.path_source` 字段名、默认值、可读取性（`ws_row.path_source`）与 task-01 产出一致；若有偏差立即在执行回执标注并回头修正 task-01（不允许本任务内 workaround）。
