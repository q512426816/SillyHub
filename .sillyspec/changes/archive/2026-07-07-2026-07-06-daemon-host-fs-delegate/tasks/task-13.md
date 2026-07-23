---
id: task-13
title: preflight 重构（spec_workspace/bootstrap.py:649）（覆盖：FR-04）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - backend/app/modules/spec_workspace/bootstrap.py
provides: []
expects_from:
  task-01:
    - contract: HostFsDelegate
      needs: [stat, read_file]
goal: >
  preflight 宿主路径访问统一收敛到 HostFsDelegate，daemon-client 模式也走显式 RPC，校验语义不变。
implementation:
  - "定位现有路径：preflight_workspace_code_root（line 649）调 resolve_root_path_for_server，daemon-client 得 None 跳过校验"
  - "改注入 HostFsDelegate：调用方 _execute_bootstrap_agent_run（line 418）传 workspace + code_root + delegate，preflight 签名改 async 收 delegate"
  - "_run_preflight 容器访问替换：code_root.exists/.is_dir → delegate.stat；iterdir+签名探测 → delegate.list_dir+单项 stat；git safe.directory server-local 分支保留"
  - "path_source 分流内聚到 HostFsDelegate（D-004），调用方不再有 path_source != daemon-client 散落 if"
  - "签名/调用点同步：line 418 改 async await preflight_workspace_code_root(workspace, code_root, delegate, path_source=workspace.path_source)"
  - "错误信息保持：所有 f-string 错误文案原样，仅数据来源从 Path 换成 delegate 返回"
acceptance:
  - "daemon-client workspace bootstrap preflight 经 HostFsDelegate RPC 完成校验，backend 容器无宿主路径访问"
  - "grep resolve_root_path_for_server backend/app/modules/spec_workspace/bootstrap.py 无残留"
  - "grep \"path_source != daemon-client\" backend/app/modules/spec_workspace/bootstrap.py 无散落 if"
  - "server-local 模式 preflight 行为零回归（现有 bootstrap 单测全绿，校验文案不变）"
  - "preflight 失败/通过路径仍正确驱动 run.status=failed/preflight_failed 与 done event（line 422-437 行为不变）"
verify:
  - "cd backend && uv run pytest app/modules/spec_workspace/ -q"
constraints:
  - "preflight 校验语义不变（目录存在 / 非空 / 项目签名探测 / git safe.directory），仅数据来源从容器直接访问换 HostFsDelegate"
  - "_run_preflight 内 subprocess git config --global safe.directory 仅 server-local 容器有意义，daemon-client 路径不在 backend 触发，保持 server-local 分支行为不变"
  - "仅重构宿主文件系统访问方式，不改 preflight 触发时机 / AgentRun 状态写法 / Redis done event 路径"
  - "受 task-01 HostFsDelegate 接口（stat / read_file / list_dir）契约约束；task-04 异步容错（30s 超时）对 preflight 同生效"
---

# task-13 蓝图：preflight 重构

## goal

把 `spec_workspace/bootstrap.py` 里 preflight（`preflight_workspace_code_root` line 649 + `_run_preflight` line 673）的宿主路径访问（`Path.exists / .is_dir / .iterdir / 嵌套 signature 探测 / subprocess git config`）统一收敛到 `HostFsDelegate`，去掉入口处依赖 `resolve_root_path_for_server` 返回 None 来"逃过"daemon-client 的隐式分流，让 daemon-client 模式的 preflight 也走 HostFsDelegate 显式 RPC（D-001 全委托范围）。校验语义（目录存在 / 非空 / 项目签名 / git safe.directory）保持不变。

## implementation

1. **定位现有路径**：`preflight_workspace_code_root`（line 649）当前调 `resolve_root_path_for_server(code_root, path_source)`，server-local 得到容器内路径再 `_run_preflight`，daemon-client 得到 None 直接 return None（跳过校验，靠 daemon 侧自检兜底）。
2. **改注入 HostFsDelegate**：调用方 `_execute_bootstrap_agent_run`（line 418 处调用 preflight）传 workspace + code_root + 注入的 delegate；preflight 签名改为 `async def preflight_workspace_code_root(workspace, code_root, delegate, path_source)`，内部不再读 `resolve_root_path_for_server`。
3. **`_run_preflight` 容器访问替换**：
   - `code_root.exists() / .is_dir()` → `delegate.stat(workspace, code_root)`（返回 `{exists, is_dir, size}`）
   - `list(code_root.iterdir())` + 嵌套 `(code_root/sig).exists()` 签名探测 → `delegate.list_dir(workspace, code_root)` + 单项 `delegate.stat`（或 read_file 探测 package.json，按需）
   - `subprocess.run(["git","config","--global","--add","safe.directory", ...])` → 这是 backend 容器内 git 写操作（仅 server-local 有意义），server-local 分支保留；daemon-client 路径下由 daemon host_fs handler 侧自管 safe.directory，本函数不触发
4. **path_source 分流内聚到 HostFsDelegate**：delegate 内部按 path_source 分流（D-004），调用方不再有 `if path_source != 'daemon-client'` 散落 if；preflight 一律调 delegate，server-local 走本地容器分支、daemon-client 走 WS RPC。
5. **签名/调用点同步**：`_execute_bootstrap_agent_run` line 418 改为 `await preflight_workspace_code_root(workspace, code_root, delegate, path_source=workspace.path_source)`（变 async）；preflight_error 写 run_log 路径（line 422-437）保持。
6. **错误信息保持**：所有 f-string 错误文案原样（含 code_root 路径展示，便于排障），仅数据来源从 Path 换成 delegate 返回。

## 验收标准

- daemon-client workspace 的 bootstrap preflight 经 HostFsDelegate RPC 完成校验（不靠 resolver None 兜底跳过），backend 容器无宿主路径访问。
- `grep -rn "resolve_root_path_for_server" backend/app/modules/spec_workspace/bootstrap.py` 无残留（preflight 不再用该分流）。
- `grep -rn "path_source != ['\"]daemon-client['\"]" backend/app/modules/spec_workspace/bootstrap.py` 无散落 if。
- server-local 模式 preflight 行为零回归（现有 bootstrap 单测全绿，校验文案不变）。
- preflight 失败/通过路径仍正确驱动 run.status=failed/preflight_failed 与 done event（line 422-437 行为不变）。

## verify

```
cd backend && uv run pytest app/modules/spec_workspace/ -q
```

补 daemon-client preflight 双路径单测（HostFsDelegate mock stat/list_dir 返回空目录 / 缺签名 / 正常签名 三场景断言错误串与返回）；确认 server-local 现有 preflight 用例零回归。

## constraints

- preflight 校验语义不变（目录存在 / 非空 / 项目签名探测 / git safe.directory），仅数据来源从容器直接访问换 HostFsDelegate。
- `_run_preflight` 内 `subprocess git config --global safe.directory` 仅 server-local 容器有意义，daemon-client 路径不在 backend 触发（由 daemon handler 侧自管），保持 server-local 分支行为不变。
- 仅重构宿主文件系统访问方式，不改 preflight 触发时机 / AgentRun 状态写法 / Redis done event 路径。
- 受 task-01 HostFsDelegate 接口（stat / read_file / list_dir）契约约束；task-04 异步容错（30s 超时）对 preflight 同生效。
