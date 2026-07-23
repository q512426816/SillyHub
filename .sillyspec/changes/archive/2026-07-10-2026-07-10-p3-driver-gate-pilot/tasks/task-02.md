---
id: task-02
title: daemon 侧 host-fs-handler.ts 加 run_command handler（命令白名单 + execFile）+ daemon.ts 注册
title_zh: daemon run_command handler 与注册
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: []
blocks: [task-07]
requirement_ids: [FR-8]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/src/daemon.ts
provides:
  - contract: daemon run_command RPC handler
    fields: [command, args, cwd, timeout, env, exit_code, stdout, stderr, duration_ms]
expects_from:
  task-01:
    - contract: HostFsDelegate.run_command
      needs: [command, args, cwd, timeout, env]
---

# Task-02 — daemon run_command handler 与注册

## 目标
design §5.3 / T2.3+T2.4：daemon 侧 host_fs 加第 9 handler `run_command`，接 backend `HostFsDelegate.run_command`（task-01）经 send_rpc 转发的请求，在宿主跑命令并返回 `{exit_code, stdout, stderr, duration_ms}`，由 `daemon.ts:_registerHostFsRpcHandler` 注册到 per-daemon WS handler 表。

## 实现要点

### 1. host-fs-handler.ts 新增 run_command handler（命令白名单 + execFile）
- 在现有 `HostFsHandler` 类（`host-fs-handler.ts:282`）加方法 `runCommand(params)`，与现有 8 方法同骨架（模块头注释从「八方法」改「九方法」）。
- 入参对齐 design §7 + task-01 契约：`{ command: string, args: string[], cwd: string, timeout: number, env?: Record<string,string> | null }`。
- 返回结构对齐 design §7 / task-01 provides：
  ```ts
  { exit_code: number, stdout: string, stderr: string, duration_ms: number }
  ```
- **命令白名单安全层（R3 / AC-8）**：只允 `command === 'sillyspec'` 且 `args` 匹配 gate 模板（`gate verify --change <changeName> --json [--stage <stage>]`）。判定规则**与 task-01 backend 侧白名单字符级对齐**（task-01 实现时同步双端规则；本任务在 handler 内复制等价判定）。非白名单命令**不执行**，返回 `{ exit_code: <非0，如126>, stdout: '', stderr: 'command not allowed: <command>', duration_ms: <极小> }`（不抛，结构化回传让 backend 记审计；AC-8 覆盖）。
- **execFile 超时**：复用模块内 `runCmd`（`:163`）的 execFile 模式，但 timeout 用入参 `params.timeout`（对齐 M5 的 12min 默认，由 task-01 传入；handler 侧不写死 12min，透传调用方值）。`cwd` 先过 `assertWithinAllowedRoots(params.cwd, this._allowedRoots)`（与现有 8 方法一致，`:298` 防穿越）。
- **超时杀子进程**：execFile `timeout` 触发后 Node 自动 SIGTERM 子进程；超时场景返回 `{ exit_code: 124, stdout, stderr: '<timeout after Nms>', duration_ms }`（不抛）。
- **env 注入**：`env` 非空时合并到 `process.env` 之上传给 execFile（仅追加/覆盖入参键，不清空 PATH）。空/null 走默认环境。
- **duration_ms**：方法入口 `Date.now()` 计时，返回时算差值。
- 类型导出：加 `export interface RunCommandResult { exit_code: number; stdout: string; stderr: string; duration_ms: number; }`（与 backend design §7 三端对齐）。

### 2. daemon.ts `_registerHostFsRpcHandler` 注册（`:2178`）
- 在现有 8 个 `ws.registerRpcHandler('host_fs.<method>', ...)` 之后（`:2235` read_local_yaml 之后）追加：
  ```ts
  ws.registerRpcHandler('host_fs.run_command', async (params) => {
    const command = typeof params.command === 'string' ? params.command : '';
    const args = Array.isArray(params.args) ? params.args.filter((a) => typeof a === 'string') : [];
    const cwd = typeof params.cwd === 'string' ? params.cwd : '';
    const timeout = typeof params.timeout === 'number' && params.timeout > 0 ? params.timeout : 12 * 60 * 1000;
    const env = (params.env && typeof params.env === 'object' && !Array.isArray(params.env))
      ? params.env as Record<string, string> : null;
    return handler.runCommand({ command, args, cwd, timeout, env });
  });
  ```
- 注释段（`:2185`）从「八方法各注册一次」改「九方法」。

## 验收标准（acceptance）
- [ ] 命令白名单拒非 gate 命令（如 `rm`/`ls`/`sillyspec derive`）→ 返回 exit_code 非 0 + stderr 拒绝信息（AC-8）
- [ ] execFile 带 timeout（入参透传，超时杀子进程 + exit_code 124）
- [ ] `host_fs.run_command` 注册后 RPC 可路由（daemon.ts 调用链通）
- [ ] 返回结构对齐 task-01 契约（四字段齐全 + duration_ms 计时正确）
- [ ] cwd 过 `assertWithinAllowedRoots`（穿越防护不破）
- [ ] tsc 严格类型通过（RunCommandResult 导出 + params 类型完备）

## 验证（verify）
```bash
cd sillyhub-daemon && pnpm test && pnpm typecheck
```
新增测试：`run_command` 白名单通过 / 白名单拒绝（AC-8）/ 超时杀子进程 / cwd 越界抛 forbidden / exit_code+stdout+stderr+duration_ms 四字段回传。复用现有 host-fs-handler 测试文件结构。

## 约束（constraints）
- 命令白名单规则与 task-01 backend 侧**双端一致**（同一判定逻辑复制两份，gate 模板 = `sillyspec gate verify --change <name> --json`，可选 `--stage <stage>`）
- execFile 非 shell（防注入，与现有 `runCmd:169` 同模式）；超时必须杀子进程不留孤儿
- ESM 兼容（`.js` import 后缀；无 dynamic require）
- 不引入新 npm 依赖（execFile 来自 `node:child_process` 已在 `:52` import；计时用 `Date.now()`）
- 不影响现有 8 方法（run_command 是纯增量，handler 类不重构）
- 不做 RPC 协议匹配（rpc_id 匹配由 ws-client.ts:_dispatchRpc 负责）；不做 retry/backoff（由 backend 侧决定）
