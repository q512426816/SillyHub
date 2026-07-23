---
id: task-09
title: resolve_work_dir 重构 HostFsDelegate（agent/service.py:265，去散落 if path_source != 'daemon-client'）（覆盖：FR-04）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@V1, D-004@V1]
allowed_paths:
  - backend/app/modules/agent/service.py
provides: []
expects_from:
  task-01:
    - contract: HostFsDelegate
      needs: [stat]
goal: >
  一句话目标
implementation:
  - "步骤1"
  - "步骤2"
acceptance:
  - "验收1"
verify:
  - "cd backend && uv run pytest app/modules/agent/"
constraints:
  - "约束1"
---

## goal

把 `resolve_work_dir`（`backend/app/modules/agent/service.py:235-286`）里 ql-006 的 point-fix 散落 `if path_source != "daemon-client" and not ws_root.exists():`（service.py:265）重构为统一 `HostFsDelegate.stat` 调用，把 path_source 分流内聚到 delegate，消除 backend 容器内裸 `Path.exists()` 宿主路径访问。属 design §5.4 dispatch 5 处统一第 1 处。

## implementation

1. 定位现有 point-fix：`service.py:261-269`（`ws_root = Path(workspace_root)` + 散落 `if path_source != "daemon-client" and not ws_root.exists(): raise AgentRunError(...)`，ql-006 修，注释「daemon-client: root_path 在绑定 daemon 宿主上...跳过校验」）。
2. 在 `resolve_work_dir` 签名加 `delegate: HostFsDelegate | None = None`（与 task-01 提供的 `stat(workspace, path) -> {exists,is_dir,size}` 契约对接），保留 `path_source` 形参（仍透传给 delegate 内部分流 + server-local 分支保留行为）。
3. 把第 265 行散落 if 替换为：调用 `await delegate.stat(workspace, ws_root)` → `{exists}` 不存在时抛同款 `AgentRunError(... details={"workspace_root": workspace_root})`。
   - 行为同 ql-006：server-local（path_source=None/'server-local'）走本地容器 stat，不存在即 raise；daemon-client 走 delegate RPC（daemon 侧宿主 stat），backend 不再裸 `Path.exists()`。
4. 同步 `_get_workspace_root`（如 task 范围内存在同类 path_source 散落 if，搜 `path_source != "daemon-client"` 在本文件内全部出现点一并清掉；本 task 文件内只剩 resolve_work_dir 一处散落 if，task-10 负责第 1330 行 start_scan_dispatch）。
5. 调用方传 delegate：搜 `resolve_work_dir(` 在 agent/service.py 的 caller，从 AgentService 已注入的 daemon 依赖取 HostFsDelegate 实例传入（如本 task 范围内无现成注入点，留 TODO 由 task-01 落地后接线，但 resolve_work_dir 签名先就位）。
6. 去掉第 262-264 行注释里「跳过校验」措辞，改写为「stat 经 HostFsDelegate（path_source 分流：server-local 本地 / daemon-client RPC）」。

## 验收标准

- daemon-client 模式 `resolve_work_dir` 经 HostFsDelegate.stat（行为同 ql-006 已修：root_path 在 daemon 宿主、backend 不裸 stat，零回归）。
- server-local 模式 `resolve_work_dir` 不存在的 workspace_root 仍 raise `AgentRunError`（路径 + details 字段不变）。
- `grep -rn "path_source != ['\"]daemon-client['\"]" backend/app/modules/agent/service.py` 仅 task-10 范围（start_scan_dispatch:1330）残留，本 task 文件 resolve_work_dir 区域无散落 if。
- 仅重构，不改 `resolve_work_dir` 任何分支语义（read_only 拼接 change.path / lease 走 worktree / 无 lease 走 workspace root 三路径完全不变）。

## verify

```
cd backend && uv run pytest app/modules/agent/ -q
```
重点跑 resolve_work_dir / dispatch 相关用例（daemon-client 跳过本地 stat + server-local raise 两条断言）；若现有 fixture 未覆盖 delegate 注入，补一条 delegate stat mock 单测。

## constraints

- 行为同 ql-006 已修（零回归是硬约束，server-local raise 语义 + details 字段不变）。
- 仅重构不改语义；path_source 分流内聚到 delegate（task-01 提供 stat 契约）。
- 本 task 只动 resolve_work_dir（service.py:235-286）+ 本文件内 caller 接线；start_scan_dispatch:1330 归 task-10。
