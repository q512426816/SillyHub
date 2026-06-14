---
author: qinyi
created_at: 2026-06-14T17:52:18
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-03
title: dispatch_to_daemon 扩字段 + lease.metadata 持久化上下文参数
priority: P0
depends_on: [task-01]
blocks: [task-02, task-05]
allowed_paths:
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/daemon/service.py
---

# task-03: dispatch_to_daemon 扩字段 + lease.metadata 持久化上下文参数

> 对应 plan 全局验收 2；风险 R-stage（stage/scan 上下文参数未持久化，端点无法重建）。
> 对应 design §Phase 2（111）、§7.2 接口定义（257-272）、§6 文件变更清单（224/226）。
> **依赖 task-01**：task-01 删 SERVER 路径后，三处 dispatch 入口的 else SERVER fallback 分支已删，本任务在「仅 DAEMON 路径」上扩字段。
> **被 task-02 依赖**：task-02 端点从 lease.metadata 读 stage/scan 临时参数，本任务必须先持久化这些参数。

## 修改文件

- `backend/app/modules/agent/placement.py` — `dispatch_to_daemon`(124) 签名扩 keyword-only 参数 `repo_url`/`branch`/`allowed_paths`/`tool_config`/`timeout_seconds`；`metadata` dict(154-160) 扩字段写入
- `backend/app/modules/agent/service.py` — 三处 `dispatch_to_daemon` 调用点（start_run:315、start_stage_dispatch:846、start_scan_dispatch:1313）补传字段：
  - stage run 的 `prompt`/`step_prompt`/`stage`/`read_only`（当前 service.py 内联构建 AgentSpecBundle:1024-1040 时使用，本任务改为同时写入 lease.metadata）
  - scan run 的 `root_path`/`spec_root`/`runtime_root`
  - 通用字段 `repo_url`/`branch`/`allowed_paths`/`tool_config`/`timeout_seconds`
- `backend/app/modules/daemon/service.py` — `_build_claim_payload`(304-360) 补充透传：从 lease.metadata 读 `repo_url`/`branch`/`allowed_paths`/`tool_config`/`timeout_seconds` 并填入 payload

## 实现要求

1. **`dispatch_to_daemon` 签名扩展**（placement.py:124-132，新增 5 个 keyword-only 参数，design §7.2 第 257-272 行）：
   ```python
   async def dispatch_to_daemon(
       self,
       agent_run_id: uuid.UUID,
       user_id: uuid.UUID,
       *,
       provider: str | None = None,
       prompt: str | None = None,
       resume_session_id: str | None = None,
       repo_url: str | None = None,            # 新增
       branch: str | None = None,              # 新增
       allowed_paths: list[str] | None = None, # 新增
       tool_config: dict | None = None,        # 新增
       timeout_seconds: int | None = None,     # 新增
       # stage run 专用
       step_prompt: str | None = None,         # 新增
       stage: str | None = None,               # 新增
       read_only: bool | None = None,          # 新增
       # scan run 专用
       root_path: str | None = None,           # 新增
       spec_root: str | None = None,           # 新增
       runtime_root: str | None = None,        # 新增
   ) -> uuid.UUID | None: ...
   ```
   **全部 keyword-only（`*` 后）+ 默认 None**，保持向后兼容（task-01 的旧签名 2 参数调用仍可用，task-02 端点无需传全部）。

2. **lease.metadata 写入扩字段**（placement.py:154-160）：
   ```python
   metadata = {}
   # 通用字段（design §7.2）
   if prompt: metadata["prompt"] = prompt
   if provider: metadata["provider"] = provider
   if resume_session_id: metadata["resume_session_id"] = resume_session_id
   if repo_url: metadata["repo_url"] = repo_url
   if branch: metadata["branch"] = branch
   if allowed_paths: metadata["allowed_paths"] = allowed_paths
   if tool_config: metadata["tool_config"] = tool_config
   if timeout_seconds is not None: metadata["timeout_seconds"] = timeout_seconds
   # stage run 专用（R-stage 应对）
   if step_prompt: metadata["step_prompt"] = step_prompt
   if stage: metadata["stage"] = stage
   if read_only is not None: metadata["read_only"] = read_only
   # scan run 专用（R-stage 应对）
   if root_path: metadata["root_path"] = root_path
   if spec_root: metadata["spec_root"] = spec_root
   if runtime_root: metadata["runtime_root"] = runtime_root
   ```
   **CLAUDE.md 不入 metadata**（design §Phase 2 第 111 行明确，可达数十 KB，由端点 fetch）。

3. **start_run 调用点补传**（service.py:315）：
   ```python
   lease_id_daemon = await placement.dispatch_to_daemon(
       run.id, user_id,
       provider=provider,
       prompt=prompt_text,           # 从 start_run 入参或 bundle 提取
       resume_session_id=resume_session_id,
       repo_url=repo_url,            # 从 workspace.git_repo_url 取
       branch=branch,
       allowed_paths=allowed_paths,
       tool_config=tool_config,
       timeout_seconds=timeout_seconds,
   )
   ```
   > **需 execute 时确认**：`start_run` 入参是否已含 repo_url/branch/allowed_paths/tool_config；若无则从 `workspace` 表 / AgentRun 字段取（service.py:248 build_spec_bundle 调用范式可参考）。

4. **start_stage_dispatch 调用点补传**（service.py:846）：当前是 `await placement.dispatch_to_daemon(run.id, user_id)`（2 参数），扩为：
   ```python
   lease_id_daemon = await placement.dispatch_to_daemon(
       run.id, user_id,
       prompt=prompt,                # stage 入参
       step_prompt=step_prompt,      # stage 入参
       stage=stage,                  # stage 入参
       read_only=read_only,          # stage 入参
       repo_url=repo_url,            # 从 workspace 取
       branch=branch,
       allowed_paths=allowed_paths,
       tool_config=tool_config,
   )
   ```
   > **需 execute 时确认**：`start_stage_dispatch`(722) 入参签名，确认 prompt/step_prompt/stage/read_only 是已存在参数。

5. **start_scan_dispatch 调用点补传**（service.py:1313）：当前是 `await placement.dispatch_to_daemon(run.id, user_id)`（2 参数），扩为：
   ```python
   lease_id_daemon = await placement.dispatch_to_daemon(
       run.id, user_id,
       root_path=root_path,          # scan 入参
       spec_root=spec_root,          # scan 入参
       runtime_root=runtime_root,    # scan 入参
       repo_url=repo_url,
       branch=branch,
       allowed_paths=allowed_paths,
       tool_config=tool_config,
   )
   ```
   > **需 execute 时确认**：`start_scan_dispatch`(1228) 入参签名，确认 root_path/spec_root/runtime_root 是已存在参数。

6. **`_build_claim_payload` 透传**（daemon/service.py:304-360）：在既有 lease_meta 读取段（344-351）后补：
   ```python
   # 既有（保留）：
   if lease_meta.get("prompt"): payload["prompt"] = lease_meta["prompt"]
   if lease_meta.get("provider"): payload["provider"] = lease_meta["provider"]
   if lease_meta.get("resume_session_id"): payload["resume_session_id"] = lease_meta["resume_session_id"]
   # 新增（本任务）：
   if lease_meta.get("repo_url"): payload["repo_url"] = lease_meta["repo_url"]
   if lease_meta.get("branch"): payload["branch"] = lease_meta["branch"]
   if lease_meta.get("allowed_paths"): payload["allowed_paths"] = lease_meta["allowed_paths"]
   if lease_meta.get("tool_config"): payload["tool_config"] = lease_meta["tool_config"]
   if lease_meta.get("timeout_seconds") is not None: payload["timeout_seconds"] = lease_meta["timeout_seconds"]
   # stage/scan 专用字段不透传到 claim payload（daemon 通过 execution-context 端点取，
   # 避免重复；但若 task-05 daemon 仍读 claim payload，本字段冗余写入也无害，保持向后兼容）
   ```
   **注意**：claim payload 与 lease.metadata 是**两个不同消费点**——claim payload 给 daemon 初始 claim 时（task-05 之前 daemon 主要靠它），lease.metadata 给端点查询（task-02）。本任务**两者都写**，确保 daemon 在 task-05（fetch 端点）落地前后都能拿到 repo_url/branch 等。

7. **`metadata` JSON 序列化**：placement.py:175 `json.dumps(metadata) if metadata else None` 已处理；扩字段后 metadata dict 可能含 list/dict（allowed_paths/tool_config），json.dumps 默认支持；**注意**：tool_config 内若有非 JSON 可序列化对象（如 datetime）需调用方自行转字符串。

8. **`timeout_seconds` 类型**：`int | None`（非 float，避免精度问题），默认 None（不写入 metadata，daemon 用自身 config 默认值，design B2 第 177 行）。

## 接口定义

### dispatch_to_daemon 完整签名（placement.py:124）

```python
async def dispatch_to_daemon(
    self,
    agent_run_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    # 通用字段（design §7.2）
    provider: str | None = None,
    prompt: str | None = None,
    resume_session_id: str | None = None,
    repo_url: str | None = None,
    branch: str | None = None,
    allowed_paths: list[str] | None = None,
    tool_config: dict | None = None,
    timeout_seconds: int | None = None,
    # stage run 专用（R-stage）
    step_prompt: str | None = None,
    stage: str | None = None,
    read_only: bool | None = None,
    # scan run 专用（R-stage）
    root_path: str | None = None,
    spec_root: str | None = None,
    runtime_root: str | None = None,
) -> uuid.UUID | None:
    """Dispatch an AgentRun to the user's daemon.

    所有上下文参数（除 CLAUDE.md）持久化到 daemon_task_leases.metadata JSON 列。
    daemon 通过 _build_claim_payload（初始 claim）和 GET execution-context（fetch）读取。

    Returns lease_id，或 None（无在线 runtime——task-01 后此情况由 decide_backend 抛 NoOnlineDaemonError，
    此处保留 None 兜底防御）。
    """
```

### _build_claim_payload 补充段（daemon/service.py:344 之后）

```python
# Propagate bundle context fields from lease metadata (Phase 2 extension)
if lease_meta.get("repo_url"):
    payload["repo_url"] = lease_meta["repo_url"]
if lease_meta.get("branch"):
    payload["branch"] = lease_meta["branch"]
if lease_meta.get("allowed_paths"):
    payload["allowed_paths"] = lease_meta["allowed_paths"]
if lease_meta.get("tool_config"):
    payload["tool_config"] = lease_meta["tool_config"]  # 覆盖既有默认 {}
if lease_meta.get("timeout_seconds") is not None:
    payload["timeout_seconds"] = lease_meta["timeout_seconds"]
```

## 边界处理

1. **（null/空值）** 所有新增参数默认 None；None 值**不写入** metadata（`if x:` 守卫），保持 metadata 精简；`read_only=False`（显式 false）需特殊处理：用 `if read_only is not None:` 而非 `if read_only:`（否则 false 被吞）。
2. **（兼容性 brownfield）** 既有 `dispatch_to_daemon(agent_run_id, user_id)` 2 参数调用仍可用（task-01 阶段调用方未改完时）；既有 `lease.metadata` 无新字段时 `_build_claim_payload` 与端点都正确返回 None（向后兼容）。本项目数据可清空，不处理存量 lease 补字段。
3. **（异常不静默吞）** `dispatch_to_daemon` 内部 `_get_online_runtime` 返回 None → 返回 None（task-01 后 decide_backend 应已抛 NoOnlineDaemonError，但本函数保留 None 兜底）；DB INSERT 异常向上抛。**不**在扩字段时吞掉 JSON 序列化异常（如 tool_config 含非可序列化对象）→ 显式抛 TypeError。
4. **（参数不可变）** `allowed_paths` 入参 list 与 `tool_config` 入参 dict **不 mutate**；写入 metadata 时用原对象引用（json.dumps 不修改入参）；调用方传入后可继续使用。
5. **（歧义/冲突）** stage run 传了 `root_path` 或 scan run 传了 `stage` → 不报错，全部写入 metadata（端点 task-02 通过 `_determine_run_type` 优先级判定 run 类型，metadata 字段冲突时优先 metadata 显式标记）；调用方需保证语义一致。
6. **（payload 字段覆盖）** `_build_claim_payload` 既有 `payload["tool_config"] = {}`(311) 是默认值，本任务 `if lease_meta.get("tool_config"): payload["tool_config"] = lease_meta["tool_config"]` 在默认值之后**覆盖**；若 metadata 无 tool_config 则保留默认 `{}`。
7. **（CLAUDE.md 不入 metadata）** design §Phase 2 第 111 行明确，CLAUDE.md 可达数十 KB，避免 JSON 列膨胀；本任务**不**在 dispatch_to_daemon 接受 claude_md 参数；端点 task-02 实时渲染。

## 非目标

- **不**改 `decide_backend` 逻辑（task-01 范围）。
- **不**改 execution-context 端点（task-02 范围）。
- **不**改 daemon 侧 fetch（task-05 范围）；本任务只确保后端**写入**正确，daemon 是否读 claim payload vs 端点由 task-05 定。
- **不**改 `start_run`/`start_stage_dispatch`/`start_scan_dispatch` 对外签名（design §9 兼容策略，破坏性切换仅限内部）。
- **不**持久化 CLAUDE.md（design 明确，由端点实时渲染）。
- **不**引入 metadata schema 校验（JSON 列无 schema 变更，design §8 第 296 行明确无表结构变更）。
- **不**改 `AgentRun` 表结构（仅 `daemon_task_leases.metadata` JSON 列内字段扩展）。
- **不**支持 B4 workspace 缓存 / B6 heartbeat 分档等 P2 增强（独立 follow-up change）。

## TDD 步骤

1. **写测试** `backend/app/modules/agent/tests/test_dispatch_metadata.py`（task-11 主体，本任务先写骨架）：
   - `test_dispatch_to_daemon_writes_repo_branch`：调 dispatch_to_daemon(repo_url=..., branch=...) → 查 DB lease.metadata 含 repo_url/branch
   - `test_dispatch_to_daemon_writes_stage_fields`：传 prompt/step_prompt/stage/read_only=False → metadata 含 stage=False（read_only false 不被吞）
   - `test_dispatch_to_daemon_writes_scan_fields`：传 root_path/spec_root/runtime_root → metadata 含三字段
   - `test_dispatch_to_daemon_omits_none_fields`：仅传 prompt → metadata 不含 repo_url/branch（None 不写入）
   - `test_dispatch_to_daemon_backward_compatible_2_args`：`dispatch_to_daemon(run.id, user_id)`（旧签名）→ 不报错，metadata 仅含既有 prompt/provider/resume_session_id（如传入）
   - `test_build_claim_payload_propagates_bundle_fields`：mock lease.metadata(repo_url/branch/allowed_paths/tool_config) → _build_claim_payload 输出含这些字段
2. **确认失败**：`cd backend && uv run pytest app/modules/agent/tests/test_dispatch_metadata.py -q` → 全红（签名未扩）。
3. **写实现**：扩 dispatch_to_daemon 签名 + metadata 写入 + 三处调用点补传 + _build_claim_payload 透传。
4. **确认通过**：重跑测试 → 全绿。
5. **回归**：`cd backend && uv run pytest -q`（扩签名向后兼容，既有调用点不报错）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 单测：调 `dispatch_to_daemon(repo_url="https://...", branch="dev")` → 查 `daemon_task_leases.metadata` JSON | 含 `"repo_url": "https://..."` 与 `"branch": "dev"`（对齐 plan 全局验收 2 通用字段） |
| AC-02 | 单测：调 `dispatch_to_daemon(prompt="P", step_prompt="S", stage="implementation", read_only=False)` → 查 metadata | 含 `"stage": "implementation"` 与 `"read_only": false`（false 显式写入，R-stage 应对） |
| AC-03 | 单测：调 `dispatch_to_daemon(root_path="/r", spec_root="/s", runtime_root="/rt")` → 查 metadata | 含三字段（R-stage 应对） |
| AC-04 | 单测：调 `dispatch_to_daemon(run.id, user_id)`（旧 2 参数签名） | 不报 TypeError，正常返回 lease_id（向后兼容，design §9） |
| AC-05 | 单测：mock lease.metadata（repo_url/branch/allowed_paths/tool_config）→ 调 `_build_claim_payload` | 返回 payload 含 repo_url/branch/allowed_paths/tool_config（对齐 plan 全局验收 2，daemon 初始 claim 可拿到 bundle 字段） |
| AC-06 | `grep -n "repo_url\|branch\|allowed_paths\|tool_config\|step_prompt\|stage\|read_only\|root_path\|spec_root\|runtime_root" backend/app/modules/agent/placement.py` | dispatch_to_daemon 签名（约 124-145 行）含这些 keyword-only 参数 |
| AC-07 | `grep -n "repo_url\|branch\|allowed_paths\|tool_config\|timeout_seconds" backend/app/modules/daemon/service.py` | _build_claim_payload 段（约 352-365 行）含这些字段透传 |
| AC-08 | DB 直查：`SELECT metadata FROM daemon_task_leases WHERE agent_run_id = '<recently_dispatched_run>'` | JSON 含 stage/scan 专用字段（R-stage 闭环验证） |
