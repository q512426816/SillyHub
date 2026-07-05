---
author: qinyi
created_at: 2026-07-02 11:01:00
change: 2026-07-02-change-detail-file-tree-editor
task_id: task-14
title: edit-kind outbox 入队 + pending 合并 + 离线续传单测
priority: P0
depends_on: [task-05, task-08]
wave: W6
requirement_ids: [FR-06]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/change/tests/test_files_router.py
---

# task-14 — edit-kind outbox 入队 + pending 合并 + 离线续传单测

## 目标
为 task-05 `ChangeService.write_file` 的 daemon-client 分流（建/合并 `kind="edit"` pending 行，不 await）补单测，锁定 D-002 同 change_key+path 合并 + D-001 离线续传（pending 不被 60s await 翻 failed、不被 gc 回收）两条红线。

## 依据
- design.md §5 Phase2（daemon-client 双写：镜像直写 + outbox 队列回写）、§7.5 生命周期契约表（enqueue pending→claimed→done；resync 不钩 complete）、§11 D-001→Phase2/§7.5、D-002→Phase2。
- decisions.md：D-001@v1（不调用 `_await_change_write_receipt`，超时不翻 failed）+ D-002@v1（写前 SELECT 同 change_key+path pending 行→UPDATE content，未命中才 INSERT）。
- `backend/app/modules/change_writer/proxy.py:168-264`（`proxy_create_change` 入队范式 + 255 行 `_await_change_write_receipt` 60s，**仅 create 路径用，本任务断言 edit 路径不走**）。
- `backend/app/modules/daemon/model.py:288-365`（`DaemonChangeWrite`：change_key/files JSON/status/claimed_at；task-02 加 `kind` 字段）。
- `backend/app/modules/daemon/change_write_router.py:88-114`（`_gc_expired_change_writes` 只清 `status=="claimed" AND claimed_at<cutoff`，pending 行天然不被 gc）+ 162-311（claim/complete 端点范式）。
- 范式：`backend/app/modules/daemon/tests/test_change_write_router.py`（直接调 service/端点 async 函数 + `_create_change_write` 造行 + SimpleNamespace mock user）。

## 测试用例（追加到 test_files_router.py，或独立 test_write_file.py）
**enqueue（D-001 入队契约）**：daemon-client 工作区 `POST /files/content` → 返 `{status:"pending", task_id}`；查 DB 断言 `DaemonChangeWrite` 一行 `kind=="edit"`、`status=="pending"`、`files==[{path, content, doc_type:"edit"}]`、`claim_token is None`。
**合并（D-002 last-write-wins）**：同 `change_key`+`path` 连续两次 `write_file`（content 先 "v1" 后 "v2"）→ 断言 `daemon_change_writes` 行数 **不变**（仍 1 行）、该行 `files[0].content=="v2"`、`created_at` 被刷新；不同 `path` → 行数 +1（不误合并）。
**离线续传（D-001 红线）**：write_file 后断言 pending 行不因「时间流逝 / runtime status=offline / 心跳过期」被翻 failed——`_await_change_write_receipt` 根本不被调用（mock 它断言 `not called`，或断言响应在 ms 级返回非阻塞）；调一次 `_gc_expired_change_writes(session)` 后行仍 pending（gc 仅扫 claimed+超时，pending 免疫）。
**claim→complete 流程（复用 change_write_router 端点）**：edit-kind pending 行 → `claim_change_write` 翻 `claimed` + 出 token → `complete_change_write(ok=True)` 翻 `done`（验证 daemon 回写闭环通）。
**对照红线**：另造一条 `proxy_create_change` 风格（`kind="create"`）行不参与本测断言，仅作隔离；强调 edit 与 create 两路不串。

## 约束（红线）
- D-001 红线：**不改 `_await_change_write_receipt` 60s 逻辑**（proxy.py:128-165，仅 proxy_create_change 用）；edit 路径走独立入队，根本不 await。
- D-002 last-write-wins：合并按 `(change_key, path, status="pending")` 命中 UPDATE，断言行数不变 + content 最新。
- pending 行不被 gc：`_gc_expired_change_writes` 只翻 `status=="claimed" AND claimed_at<now-60s`（router:99-101），pending 免疫——写一例显式断言。
- SQLite in-memory（conftest 已就绪），async auto 模式免 `@pytest.mark.asyncio`，ruff 行宽 100，mypy `# type: ignore[code]` 后禁中文。
- mock `_await_change_write_receipt` 时用 monkeypatch/`vi`-style，勿真睡 60s。

## 验收标准
- `cd backend && python -m pytest app/modules/change/tests/test_files_router.py -k "write or pending or outbox or merge" -v` 全绿。
- `cd backend && python -m pytest app/modules/change/tests/ -q` 零回归（含 task-13 用例 + test_router.py）。
- `ruff check` + `mypy` 对该文件无新增告警。

## 风险
- task-05 的 `write_file` 合并 SELECT 若按 `runtime_id` 也参与键（防跨 runtime 误合并），测试需覆盖「同 change_key+path 不同 runtime」分支——按 task-05 真实实现适配，design 未硬性要求 runtime 入键。
- task-02 若尚未给 model 加 `kind` 列，本测试需等 task-02 合入后跑通（依赖链已声明）；过渡期可临时 `DaemonChangeWrite(..., kind="edit")` 显式传值绕过默认。
