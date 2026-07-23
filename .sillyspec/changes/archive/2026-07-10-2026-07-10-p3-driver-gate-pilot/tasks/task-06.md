---
id: task-06
title: dispatch.py 新增 _run_gate_via_delegate（含 Z1 启动探测 gate 子命令）+ _read_gate_result（解析 gate JSON）
title_zh: gate 执行与结果解析（含 Z1 探测）
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-1, FR-11]
decision_ids: []
allowed_paths:
  - backend/app/modules/change/dispatch.py
provides:
  - contract: gate execution helpers
    fields: [exit_code, errors, raw_envelope]
expects_from:
  task-01:
    - contract: HostFsDelegate.run_command
      needs: [command, args, cwd, timeout]
---

## 目标

在 `dispatch.py` 新增两个 gate 执行辅助函数：`_run_gate_via_delegate`（构造 sillyspec gate 命令经 HostFsDelegate.run_command 在 daemon 侧执行，含 Z1 子命令存在性探测）与 `_read_gate_result`（解析 gate JSON 输出为 `{exit_code, errors, raw_envelope}`）。供 task-07 的 `_run_gate_decision_task` 调用。design §5.6（Z1）/ §7（接口）。

## 实证 raw_envelope 结构（已在本机 npm link 版实测）

`sillyspec gate verify --change <name> --json` 输出 JSON（stdout），实测两种 case 结构一致：

```json
{
  "schema_version": 1,
  "command": "gate",
  "change": "<changeName>",
  "ok": <true|false>,
  "errors": ["<错误描述>", ...],
  "warnings": [],
  "generated_at": "<ISO8601Z>",
  "stage": "verify"
}
```

进程 exit code：`ok=true`→exit 0；`ok=false`→exit 1（verify-test 失败类）；变更不存在/子命令缺失→exit 2。**解析以 `ok` 与 `errors` 为准**（exit code 透传进程码作辅助）。

## 实现要点

1. **`_run_gate_via_delegate(session, workspace, change_name, spec_root, stage)`**（async）：
   - 构造 `command="sillyspec"`，`args=["gate", stage, "--change", change_name, "--json"]`（`stage` 枚举参数化，verify/execute/brainstorm/plan/archive…，design §5.4 gate 当前仅 verify，保留参数化前瞻 P4 execute）。
   - **Z1 探测（先行）**：用 `HostFsDelegate(session, ws_rpc).run_command(command="sillyspec", args=["gate", "--help"], cwd=spec_root, timeout=30)` 探测子命令存在性——若 RPC 抛错（子命令缺失 / sillyspec 未发版旧版无 gate）或 stdout 不含 `gate <stage>`，**直接返回 `{"exit_code": 2, "errors": ["sillyspec gate 子命令缺失，需 npm publish 发版"], "raw_envelope": {}}`**（诊断非 fallback，design §5.6；fail-loud）。
   - **正式执行**：`HostFsDelegate(session, ws_rpc).run_command(command=command, args=args, cwd=spec_root, timeout=720)`（12min，design §7 timeout；run_command 走 task-01 白名单+RPC 分支）。
   - 取 `result["stdout"]` 交 `_read_gate_result` 解析；RPC 异常（daemon 断线/超时）→ catch 后返回 `{"exit_code": 2, "errors": [f"gate 执行异常: {exc}"], "raw_envelope": {}}`（fail-loud，交 task-07 置 gate_status=failed）。
   - `session`/`workspace`：复用调用方（task-07 gate_session）传入；`ws_rpc` 从 workspace 解析（参照 dispatch.py 现有 HostFsDelegate 实例化方式，若需 runtime placement 用 queries.resolve_daemon_instance_for_workspace）。

2. **`_read_gate_result(raw_stdout: str) -> dict`**（纯函数）：
   - `json.loads(raw_stdout)` → envelope；解析失败 → `{"exit_code": 2, "errors": ["gate JSON 解析失败"], "raw_envelope": {}}`。
   - exit_code 映射：`envelope["ok"] is True`→0；`ok is False`→1；**字段缺失/类型异常**→2（防御）。
   - errors 取 `envelope.get("errors", []) or []`（保证 list[str]）。
   - 返回 `{"exit_code": int, "errors": list[str], "raw_envelope": envelope}`（raw_envelope 落 AgentRun.gate_result 完整审计，design §2/§8）。

3. **Z1 是诊断非 fallback**（design §5.6 强调）：子命令缺失明确 exit 2 阻断，**绝不退回 `read_verify_result`**（那会退回声明态，违背 gate 客观核验目标）。

## 验收标准

- [ ] `_read_gate_result` 正确解析实测 envelope（ok=true→exit 0；ok=false→exit 1；errors 透传；raw_envelope 保留完整 dict）
- [ ] JSON 解析失败 / 字段缺失 → exit 2（防御）
- [ ] Z1 缺失分支：探测失败返回 exit 2 + errors=["sillyspec gate 子命令缺失，需 npm publish 发版"]
- [ ] command/args 走 task-01 `HostFsDelegate.run_command`（不自己起子进程，backend 容器够不到源代码）
- [ ] 正式执行 RPC 异常被 catch → exit 2（fail-loud，不抛崩 gate 任务，交 task-07 处理）
- [ ] stage 参数化（当前传 "verify"，不硬编码字符串散落）
- [ ] 实证 raw_envelope 结构记录于本卡（上方已记）

## verify

```bash
cd backend && uv run pytest -k gate_via_delegate && sillyspec gate verify --change 2026-07-10-p3-driver-gate-pilot --json && uv run mypy app
```

## 约束

- 不重写 `read_verify_result`（:769）：task-08 负责 auto_dispatch:221-222 调用点切到 gate；本任务只加新函数，不动旧函数（零回归，brownfield）。
- gate 失败 fail-loud：exit 2 阻断，不降级不 fallback 声明态（design §9 verify stage 强制 gate）。
- sillyspec 未发版时 Z1 阻断：部署前置 npm publish（R4）；本机 npm link 测试环境例外。
- Windows/Linux/macOS 兼容：本任务不起子进程（run_command 在 daemon handler 执行，task-02），cwd 用 spec_root 跨平台路径。
- 提供给 task-07 的契约固定：返回 dict 三键 `exit_code:int, errors:list[str], raw_envelope:dict`，task-07 据此存 AgentRun.gate_result + 决策。
