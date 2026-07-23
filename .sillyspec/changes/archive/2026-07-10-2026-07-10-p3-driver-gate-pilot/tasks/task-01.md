---
id: task-01
title: HostFsDelegate 加第 9 方法 run_command + send_rpc 协议加 timeout 参数 + 命令白名单安全层
title_zh: HostFsDelegate 第 9 方法 run_command 与 send_rpc timeout
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: []
blocks: [task-06, task-07]
requirement_ids: [FR-8]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/host_fs/delegate.py
provides:
  - contract: HostFsDelegate.run_command
    fields: [command, args, cwd, timeout, env, exit_code, stdout, stderr, duration_ms]
  - contract: HostFsWsRpc.send_rpc
    fields: [method, workspace_id, daemon_id, args, timeout]
expects_from: {}
---

## 目标

在 `delegate.py` 加第 9 个公共方法 `run_command`（破锁死契约 :13-15，design §5.3 授权），供 gate 任务在 daemon 侧跑 `sillyspec gate verify`。配套给 `_WsRpcLike.send_rpc` Protocol 加 `timeout` 参数（M5 向下兼容），并新增命令白名单安全层拒任意命令（R3）。

## 实现要点

1. **更新模块 docstring（:3, :13-15）**：「Eight methods」→「nine methods」；锁死契约注释保留但在 run_command 段注明「design §5.3 / P3-driver-gate-pilot 授权破例」。
2. **加第 9 方法 `run_command`**（建议放 `read_local_yaml` 之后、`_via_rpc` 之前）：
   ```python
   async def run_command(
       self, workspace, *, command: str, args: list[str], cwd: str,
       timeout: float, env: dict | None = None,
   ) -> dict:
       # 返回 {exit_code, stdout, stderr, duration_ms}
   ```
3. **命令白名单安全层（新，入口校验）**：run_command 第一步校验 `command == "sillyspec"` 且 `args` 匹配 gate 模板 —— 头部为 `["gate", "verify", "--change", <changeName>, "--json"]`（允许尾部追加 stage 枚举等参数）；违例 `raise HostFsDelegateError("command not whitelisted", details={...})`。拒任意命令注入（R3）。
4. **daemon-client 分支**：走 `_via_rpc`（**不走 `_via_rpc_or_degrade`**——gate 失败要 fail-loud 不能降级），`args={command, args, cwd, timeout, env}`，并把 `timeout` 透传给 `rpc.send_rpc(timeout=timeout)`。
5. **server-local 分支**：`raise HostFsDelegateError("run_command requires daemon-client path source (gate must run where source code lives)")`——容器够不到源代码（design §5.3）。
6. **`_WsRpcLike.send_rpc` Protocol（:117-125）加 `timeout`**：签名加 `timeout: float | None = None`（默认 None 走现有 30s，run_command 传 12min；M5 向下兼容，现有 8 方法调用不传 timeout 行为不变）。
7. **`_via_rpc`（:657）加 `timeout` 参数透传**：`_via_rpc(self, *, method, workspace, args, timeout=None)` → `rpc.send_rpc(..., timeout=timeout)`；现有 8 方法调用 `_via_rpc` 不传 timeout 沿用默认。

## 验收标准

- [ ] 白名单拒绝非 gate 命令（如 `command="rm"` / `command="sillyspec"` 但 `args=["db","reset"]`）→ `raise HostFsDelegateError`
- [ ] 合法 gate 模板（`sillyspec gate verify --change foo --json`）通过校验进入 RPC 分支
- [ ] `_WsRpcLike.send_rpc` 签名含 `timeout: float | None = None`，mypy 通过
- [ ] daemon-client 分支调 `_via_rpc`（非 `_via_rpc_or_degrade`），timeout 透传到 `send_rpc`
- [ ] server-local 分支 `raise HostFsDelegateError`
- [ ] 现有 8 方法（stat/read_file/list_dir/git_apply/git_rev_parse/pollution_archive/read_package_json/read_local_yaml）零回归——不传 timeout，行为不变
- [ ] run_command 返回 dict 含 `exit_code, stdout, stderr, duration_ms` 四键（RPC 结果原样透传，daemon handler 在 task-02 实现）

## verify

```bash
cd backend && uv run pytest -k run_command && uv run ruff check app/modules/daemon/host_fs/delegate.py && uv run mypy app
```

## 约束

- brownfield：加第 9 方法不影响现有 8 方法调用方（stat 等 5 处 `_via_rpc_or_degrade` + git_apply dedupe 全不动）
- gate 失败 fail-loud 不降级（区别 git_apply 的 D-006 warn-and-degrade）：run_command 走 `_via_rpc`，RPC 异常直接抛给 gate 任务，gate 任务 catch 后置 `gate_status=failed + exit 2`（task-07）
- Windows/Linux/macOS 兼容：run_command 本地分支不执行任何子进程（只 raise），实际 execFile 在 daemon handler（task-02）
- 锁死契约破例范围：仅 run_command 一个新方法，不触动现有 8 方法签名
