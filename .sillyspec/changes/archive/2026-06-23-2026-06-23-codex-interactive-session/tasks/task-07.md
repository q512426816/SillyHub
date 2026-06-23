---
author: qinyi
created_at: 2026-06-24 00:13:45
id: task-07
title: backend 放开 Codex reopen 并补齐 session/permission 回归测试
priority: P0
estimated_hours: 3
depends_on: [task-02]
blocks: [task-08, task-10]
requirement_ids: [FR-06, FR-08, FR-09]
decision_ids: [D-003@v1, D-006@v1, D-007@v1, D-008@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_session_service.py
  - backend/app/modules/daemon/tests/test_session_permissions.py
---

# task-07: backend 放开 Codex reopen 并补齐 session/permission 回归测试

## 修改文件

| 文件 | 类型 | 改动概述 |
| --- | --- | --- |
| `backend/app/modules/daemon/session/service.py` | 修改 | `reopen_session()` provider gate 从 `!= "claude"` 改为 `not in {"claude","codex"}`；`DaemonSessionResumeUnsupported` 类 docstring + raise 文案改为 only claude/codex；reopen lease metadata 已含 session_id/agent_session_id/provider/claim_token（核对 codex 透传）。 |
| `backend/app/modules/daemon/tests/test_session_service.py` | 修改 | （若无 Codex reopen 用例则补；优先复用 `test_session_reopen.py`，见下） |
| `backend/app/modules/daemon/tests/test_session_permissions.py` | 修改 | 新增 Codex provider 的 permission/dialog 策略回归（happy allow/deny、manual_disabled、session_not_active、timeout fail-closed），断言 provider-neutral 行为不因 codex 回退。 |

> 说明：现有 `test_session_reopen.py`（不在 allowed_paths 内，但与 service.py 同属 daemon session 测试）已有 `test_reopen_codex_provider_409_resume_unsupported`，它断言 Codex reopen 返回 409。本任务**翻转该用例**为"可 reopen 200"，但该文件不在本任务 allowed_paths。处理方式：本任务在 `test_session_service.py` 内新增独立 Codex reopen 用例（正向 + lease metadata 断言），并在交接 task-08 前提醒后续任务/verify 阶段同步修正 `test_session_reopen.py` 的旧反向用例（避免与新行为冲突）。如 verify 阶段发现该文件必须同改，按"测试回归修正"纳入，不计入产品代码变更面。

## 覆盖来源

| 来源 | 章节 | 对应改动 |
| --- | --- | --- |
| design §5.6 | Backend reopen 放开 Codex | provider gate 改 `{"claude","codex"}`；文案改 only claude/codex；lease metadata 保留四字段 |
| design §4.1 文件清单 | service.py / test_session_service.py / test_session_permissions.py | 三文件改动点定位 |
| requirements FR-06 | Codex 支持 reopen 与 daemon recovery | Codex ended/failed 有 agent_session_id(threadId) 可 reopen，缺 threadId 不得伪造 |
| requirements FR-08 | Codex 普通 approval 策略与 Claude 一致 | permission 回归：manual_approval/ask_user_only 下 codex 行为同 claude |
| requirements FR-09 | Codex 用户输入请求复用 dialog 卡片 | dialog 回归：dialog_kind/payload 透传 provider-neutral |
| D-003@v1 | 复用 backend session 控制面 | reopen 复用 AgentSession/DaemonTaskLease，不新增 Codex 专属表 |
| D-006@v1 | permission/dialog 策略一致性 | codex permission/dialog 走与 claude 相同的 DaemonPermissionService 路径 |
| D-007@v1 | Codex reopen/recovery thread id | agent_session_id 即 Codex threadId，reopen 时作为 resume key 原样保留 |
| D-008@v1 | provider-neutral permission/dialog hook | 断言 handle_permission_request/respond 不依赖 provider==claude |

## 实现要求

依据 design §5.6，本任务对 `service.py` 的改动必须精确到以下点：

1. **provider gate 放开**（service.py ~line 1282）：
   - 旧：`if session.provider != "claude":`
   - 新：`if session.provider not in {"claude", "codex"}:`
   - raise 的 `DaemonSessionResumeUnsupported` 消息由 `does not support resume (only claude)` 改为 `does not support resume (only claude/codex)`。
2. **异常类文案**（service.py line 74-82 `DaemonSessionResumeUnsupported`）：
   - docstring 由 "provider != claude ... codex/other providers cannot be reopened" 改为 "provider not in {claude, codex}; other providers cannot be reopened"。
   - code/http_status 保持 `HTTP_409_DAEMON_SESSION_RESUME_UNSUPPORTED` / 409 不变。
3. **reopen lease metadata 核对**（service.py ~line 1338-1344）：
   - 现有 metadata_ 已包含 `session_id`、`agent_session_id`、`provider`、`claim_token`、`reopened_from_status`。**无需新增字段**，但要确认 Codex session 进入此分支时 `session.provider` 透传为 `"codex"`、`agent_session_id` 透传为 Codex threadId。本任务不改 metadata 结构（D-003@v1：复用控制面）。
4. **测试覆盖**（design §5.6 第 4 点）：
   - Codex ended session 可 reopen → 200 + `status="reconnecting"` + 新 interactive lease + 旧 completed lease 不动；
   - 非支持 provider（如 `"gemini"` 或其它）仍抛 `DaemonSessionResumeUnsupported`（409 `RESUME_UNSUPPORTED`）；
   - Claude reopen 既有用例不变（`test_session_reopen.py::TestReopenSession` 已覆盖，本任务不动）；
   - permission/dialog 策略回归：codex session 下 `handle_permission_request` / `respond_permission` 行为与 claude 一致（happy allow/deny、manual_disabled、timeout fail-closed）。
5. **接口签名不变**：`reopen_session(session_id, user_id) -> SessionReopenResponse` 保持原样；`SessionReopenResponse` 结构不变。

## 接口定义

### `reopen_session` 改动点

| 元素 | 改动 |
| --- | --- |
| 签名 | 不变 |
| provider gate | `!= "claude"` → `not in {"claude","codex"}` |
| 异常类 docstring | 文案改 only claude/codex |
| raise message | `(only claude)` → `(only claude/codex)` |
| lease metadata | 不变（已含四字段） |
| WS resume_payload.provider | 已读 `session.provider`，codex 自动透传 |

### reopen lease metadata 字段（核对，非新增）

```python
metadata_ = {
    "session_id": str(session.id),
    "agent_session_id": session.agent_session_id,  # Codex: threadId
    "provider": session.provider,                  # "codex"
    "claim_token": new_token,                      # secrets.token_hex(32)
    "reopened_from_status": session.status,        # ended/failed
}
```

### 测试断言点

- Codex reopen：HTTP 200；`status=="reconnecting"`；新 lease `kind=="interactive"`、`status=="pending"`、`metadata_.provider=="codex"`、`metadata_.claim_token` 为 64 位 hex 且 ≠ 旧 token；旧 lease 仍 `completed`。
- unsupported provider：HTTP 409，`code` 含 `RESUME_UNSUPPORTED`。
- permission（codex）：`handle_permission_request` 发布 `permission_request` SSE 并 arm timer；`respond_permission` allow/deny 发 WS、cancel timer、发布 `permission_resolved`；manual_disabled 抛 `DaemonPermissionManualDisabled`；timeout fail-closed 发 deny。

## 边界处理

1. **unsupported provider 仍拦截**：provider 为 `claude`/`codex` 以外任意值（含 `"gemini"`、空串、未知名）时，第一个 pre-flight 检查即抛 `DaemonSessionResumeUnsupported`，404/状态/offline 检查不再触发（顺序 load-bearing，与 task-05 §边界一致）。新增用例覆盖非 claude/codex provider。
2. **Codex session 缺 agent_session_id（threadId）**：provider gate 放过后，第二个检查 `if not session.agent_session_id` 抛 `DaemonSessionNoAgentSession`（D-007@v1：不得伪造 thread）。Codex ended 但 threadId 为 NULL 时仍 409 `NO_AGENT_SESSION`，session 不被 mutate。新增用例覆盖 codex + agent_session_id=None。
3. **Claude 行为完全不变**：Claude reopen 既有 6 个用例（`test_session_reopen.py::TestReopenSession` + `TestReopenSessionTransition` + `TestReopenConfirmLinkage`）全部通过，gate 改动对 claude 等价（`"claude" not in {"claude","codex"}` == `"claude" != "claude"` == False）。
4. **并发 reopen（FOR UPDATE）**：`_get_owned_session_for_update` 行锁串行化；第二次 reopen 落地时 `status` 已是 `reconnecting` ∈ `ACTIVE_SESSION_STATUSES`，命中 `DaemonSessionNotActive`。本任务不改锁逻辑，但 Codex 用例需覆盖"codex active session reopen → 409 NOT_ACTIVE"以确认状态机一致。
5. **offline runtime**：Codex session 的 runtime 未连接 WS 时，provider gate 放过后命中 `DaemonOffline`（409 `OFFLINE`）。新增用例覆盖 codex + offline。
6. **WS resume best-effort**：codex reopen 的 `daemon:session_resume` WS 失败不回滚本地 `reconnecting`（与 claude 一致）。本任务不改该分支；permission 测试中 hub mock 失败应 fail-closed（deny/cancel），不自动 accept（D-006@v1）。
7. **permission manual_approval=False**：codex session `manual_approval=false` 时 `handle_permission_request` 静默丢弃、不发布 SSE、不 arm timer（与 claude 用例 `test_manual_false_drops_without_publishing` 对齐）。新增 codex 变体。

## 非目标

- 不改 `AgentSession` / `AgentRun` / `DaemonTaskLease` 表结构与控制面语义（D-003@v1）。
- 不新增 Codex 专属表、专属 lease kind、专属 permission service。
- 不改 frontend（task-05/07 负责）；不改 daemon `restoreAndReconnect`（task-08 负责）。
- 不改 `SessionReopenResponse` schema、不改 router 层。
- 不删除/重构 `test_session_reopen.py`（如需翻转旧反向用例，由 verify 阶段或 task-08 统一处理；本任务在 `test_session_service.py` 内独立加正向用例）。
- 不实现 Codex driver、不改 `submit_messages` flat message 契约。

## 参考

- 现有 Claude reopen 实现：`backend/app/modules/daemon/session/service.py` `reopen_session()`（line 1247-1404），含 pre-flight 顺序、新 lease 构造、claim_token 轮换、best-effort WS、`SessionReopenResponse` 返回。
- Claude reopen 测试范式：`backend/app/modules/daemon/tests/test_session_reopen.py`（`_make_session(provider=...)` helper、column projection 绕过 identity-map、monkeypatch `hub.is_connected` / `send_session_control`）。
- Claude permission 测试范式：`backend/app/modules/daemon/tests/test_session_permissions.py`（`_create_session(manual_approval=...)`、`mocked_redis` fixture、`_make_request_payload` / `_make_dialog_payload`、timer cancel 清理）。
- design §5.6、§6.1（事件×状态转换矩阵 reopen 行）、§6.2（旧 lease completed 保留）。
- requirements FR-06/FR-08/FR-09。

## TDD 步骤

1. **先写失败测试**（`test_session_service.py` 新增 `TestReopenCodexSession`）：
   - `test_reopen_ended_codex_session_returns_reconnecting`：ended codex + threadId → 期望 200，但当前 gate 抛 409 → **红**。
   - `test_reopen_codex_creates_new_lease_preserves_threadid`：断言新 lease `metadata_.provider=="codex"`、`agent_session_id==threadId`、旧 lease 仍 completed → 当前因 gate 拦截跑不到 → **红**。
   - `test_reopen_unsupported_provider_still_409`：provider="gemini" → 期望 409 RESUME_UNSUPPORTED → 当前也 409（文案旧），断言文案改后通过 → 用于锁文案。
2. **改 service.py**：provider gate → `not in {"claude","codex"}`；异常 docstring + raise 文案改 only claude/codex。
3. **跑 backend 测试**：`cd backend && uv run pytest app/modules/daemon/tests/test_session_service.py app/modules/daemon/tests/test_session_permissions.py -q` → 新增 codex 用例转**绿**。
4. **Claude 回归**：`uv run pytest app/modules/daemon/tests/test_session_reopen.py -q` 全绿（gate 改动对 claude 等价）。
5. **permission 回归**：在 `test_session_permissions.py` 新增 `TestCodexPermissionParity`（parametrize 或独立类），复用 `_create_session` 但 `provider="codex"`，覆盖 happy/manual_false/timeout。
6. **lint/type**：`cd backend && uv run ruff format app/modules/daemon/session/service.py app/modules/daemon/tests/test_session_service.py app/modules/daemon/tests/test_session_permissions.py` 再 `uv run ruff check ...`；`uv run mypy app/modules/daemon/session/service.py`（确保无新增类型错误）。
7. **API 实测**（依据 MEMORY：后端改完必实测）：docker rebuild backend 后 `curl` POST `/api/daemon/sessions/{id}/reopen` 一个 ended codex session，确认 200 + reconnecting（若本机无在线 codex runtime，至少跑通 pytest + 用 monkeypatch 覆盖 offline 分支）。

## 验收标准

| ID | 验收项 | 对应 FR/决策 | 验证方式 |
| --- | --- | --- | --- |
| AC-01 | `reopen_session` 对 `provider="codex"` 不再抛 RESUME_UNSUPPORTED | FR-06, D-003, D-007 | pytest：codex ended+threadId → 200 |
| AC-02 | Codex reopen 后 session.status=="reconnecting"，agent_session_id(threadId) 原样保留 | FR-06, D-007 | pytest：column projection 断言 |
| AC-03 | Codex reopen 创建新 interactive pending lease，claim_token 64 位 hex 且 ≠ 旧 token；旧 completed lease 不动 | D-003, design §6.2 | pytest：lease metadata 断言 |
| AC-04 | 新 lease metadata 含 session_id/agent_session_id/provider/claim_token 四字段，provider=="codex" | D-003, D-007 | pytest：metadata_ 字段断言 |
| AC-05 | provider 非 {claude,codex} 仍抛 DaemonSessionResumeUnsupported(409)，文案含 claude/codex | FR-06 边界 | pytest：gemini provider → 409 |
| AC-06 | Codex + agent_session_id=None → 409 NO_AGENT_SESSION，session 不 mutate | FR-06, D-007 | pytest：codex null threadId |
| AC-07 | Codex active session reopen → 409 NOT_ACTIVE（状态机一致） | FR-06 边界 | pytest |
| AC-08 | Codex + offline runtime → 409 OFFLINE | FR-06 边界 | pytest：monkeypatch is_connected False |
| AC-09 | Claude reopen 既有用例全部通过（无回归） | FR-10, D-003 | pytest test_session_reopen.py |
| AC-10 | Codex session permission allow/deny 与 claude 同路径（WS + SSE + timer） | FR-08, D-006, D-008 | pytest：codex permission parity |
| AC-11 | Codex session manual_approval=false 时 permission request 静默丢弃 | FR-08 | pytest：codex manual_false |
| AC-12 | Codex permission timeout → fail-closed deny（不自动 accept） | FR-08, D-006 | pytest：fake-clock timeout |
| AC-13 | ruff format/check + mypy 通过；backend pytest 全绿 | 非功能 | CLI |
| AC-14 | 后端改完已实测（pytest 至少覆盖 offline 分支，有在线 runtime 则 curl 实测 reopen） | MEMORY 硬性 | CLI/curl |
