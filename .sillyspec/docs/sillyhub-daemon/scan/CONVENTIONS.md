---
source_commit: ba87eec
updated_at: 2026-06-23T16:28:21Z
created_at: 2026-06-24T00:28:21
author: qinyi
generator: sillyspec-scan
---

# sillyhub-daemon · 代码约定

> 基于 `sillyhub-daemon/src/` 实际源码（ESM TypeScript 5.5 / Node ≥20）。Lint 仅 `tsc --noEmit`（无 eslint）。

## 框架隐形规则

1. **ESM + NodeNext 模块解析**：`package.json` `"type": "module"`，`tsconfig.json` `module/moduleResolution=NodeNext`、`verbatimModuleSyntax:true`。所有相对导入**必须带 `.js` 扩展名**（编译输出为 `.js`）。
   ```ts
   // src/agent-detector.ts
   import { checkMinVersion } from './version.js';
   import { resolveCursorVersionEntry } from './cursor-version.js';
   ```
2. **类型导入强制 `import type`**：`verbatimModuleSyntax` 开启后，仅用作类型的导入必须写 `import type { ... }`，否则编译报错。SDK 类型也走 type-only。
   ```ts
   // src/interactive/types.ts
   import type { Query, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
   ```
3. **strict + noUncheckedIndexedAccess**：数组/对象下标访问结果类型自动含 `undefined`，强制判空；`config.ts` 启动期断言（runtime_id 为空时生成 uuid 落盘）。
4. **不可变常量用 `Object.freeze` + `Readonly`**：`DEFAULT_CONFIG`、`PROTOCOL_PROVIDERS`、`PROVIDER_TO_PROTOCOL` 均冻结。
   ```ts
   // src/config.ts
   export const DEFAULT_CONFIG: Readonly<DaemonConfig> = Object.freeze({ ... });
   // src/adapters/index.ts
   export const PROTOCOL_PROVIDERS: Readonly<Record<ProtocolType, readonly string[]>> = Object.freeze({ ... });
   ```
5. **Claude Agent SDK 调用约定（interactive/ 域）**：`query` 从 `@anthropic-ai/claude-agent-sdk` 命名导入为 `sdkQuery`，调用签名 `query({ prompt: AsyncIterable, options })`（spike H2 实测）。`ClaudeSdkDriver.start` 仅返回 `Query` 句柄，**句柄由 `SessionManager` 持有**（driver 故意无状态，便于替换/测试）。options 仅写非 undefined 字段让 SDK 走默认。
   ```ts
   // src/interactive/claude-sdk-driver.ts
   import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
   // ...
   start(input, opts): Query {
     const realExe = resolveClaudeExecutable(opts.pathToClaudeCodeExecutable);
     const options = { pathToClaudeCodeExecutable: realExe, cwd: opts.cwd, env: opts.env ?? { ...process.env } };
     if (opts.model !== undefined) options.model = opts.model;  // 仅写非 undefined 字段
     return sdkQuery({ prompt: input, options });
   }
   ```
6. **commander program 工厂函数 + 子命令拆 action**：`createProgram()` 导出为函数而非顶层单例（commander parse 会修改 program 状态，单例跨用例污染）；每个子命令 action 拆成独立 `export async function xxxAction(opts)` 便于单测直接调用。
   ```ts
   // src/cli.ts
   export function createProgram(): Command { const program = new Command(); ... return program; }
   export async function startAction(opts: StartOptions): Promise<number> { ... }
   export function stopAction(): number { ... }
   export async function statusAction(): Promise<number> { ... }
   ```
7. **保护钩子便于测试 stub**：底层资源创建抽为 `protected` 方法，测试子类可覆写。
   ```ts
   // src/ws-client.ts
   protected _createSocket(url: string): WebSocket { return new WebSocket(url); }
   protected _buildWsUrl(): string { ... }
   // src/agent-detector.ts
   protected resolveBinPath(spec): string | null { ... }
   protected findOnPath(binName: string): string | null { ... }  // 不引 which 库（design G-05）
   protected detectVersion(...): Promise<string | null> { ... }
   ```
8. **WebSocket 事件统一 `_handle*` 分派**：`ws.on('open'/'message'/'close'/'error')` 全部转发到 `this._handleXxx` 私有方法；close/error 经超时常量（`CLOSE_TIMEOUT_MS`/`CONNECT_TIMEOUT_MS`）保护避免悬挂，固定退避重连（`RECONNECT_INTERVAL_MS = RECONNECT_MAX_INTERVAL_MS = 5_000` 避免无限增长）。
   ```ts
   // src/ws-client.ts
   ws.on('open', () => this._handleOpen());
   ws.on('message', (data: WebSocket.RawData) => this._handleMessage(data));
   ws.on('close', (code, reason) => this._handleClose(code, reason));
   ws.on('error', (err: Error) => this._handleError(err));
   ```
9. **错误用自定义 Error 子类**，集中定义语义化错误（`extends Error`）：
   - 通用：`HubHttpError`（HTTP 非 2xx）、`GitError`（git 失败）、`RpcError`（WS RPC / file-rpc 越界）、`AbortError`（daemon 内部）。
   - interactive 域：`SessionNotFoundError` / `SessionAlreadyExistsError` / `SessionNotActiveError` / `UnsupportedProviderError` / `SessionQueueClosedError` / `SessionQueueDoubleSubscribeError` / `SessionPersistenceError` / `ClaudeExecutableNotFoundError`。
10. **接口优先于具体类做依赖**：`task-runner.ts` 用 `RunnerHubClient` / `RunnerWorkspaceManager` / `RunnerCredentialManager` 鸭子类型接口（避免硬耦合具体类）；`daemon.ts` 用 `RecoveryCoordinator` / `DaemonOptions` / `InteractiveCredentialManager` 接口。
11. **防御性 try/catch（no-op 优于抛错）**：`task-runner.ts` 大量 `try {...} catch (e) {...}` 包裹副步骤（清理/同步/日志），失败不中断主流程；`catch { /* 已关闭 */ }` 吞已知无害错误。

## 代码风格

- **命名**：
  - 类/接口/类型：PascalCase（`Daemon` / `DaemonConfig` / `SessionManager` / `ClaudeSdkDriver`）。
  - 函数/变量：camelCase（`loadConfig` / `getBackend` / `runLease` / `createProgram` / `startAction`）。
  - 常量：UPPER_SNAKE_CASE（`DEFAULT_CONFIG` / `PROTOCOL_PROVIDERS` / `PROVIDER_TO_PROTOCOL` / `MSG` / `WS_PATH` / `REST_PREFIX` / `RECONNECT_INTERVAL_MS` / `PERMISSION_FALLBACK_TIMEOUT_MS` / `CONNECT_TIMEOUT_MS` / `CLOSE_TIMEOUT_MS`）。
  - 私有成员：`_` 前缀（`_ws` / `_handleMessage` / `_routeSessionControl` / `_persistence` / `_recoveryClient` / `_createSocket`）。
  - 类型联合字面量集中定义后导出（`ProtocolType` / `MsgType` / `LeaseState` / `SessionStatus`）。
- **import 顺序**：Node 内置（`node:fs` / `node:path` / `node:os`）→ 第三方（`@anthropic-ai/...` / `commander` / `ws`）→ 本地相对路径（带 `.js`）→ 类型导入单独 `import type`。
- **文件组织**：单文件单主类 + 同域聚合（`interactive/` 子目录聚合会话全栈；`adapters/` 聚合协议解析 + `index.ts` barrel）。
- **JSDoc 中文注释**：每个导出符号配中文 doc 注释，关键设计点引用 task 编号 / spike 结论 / design 节号（如 `task-04 §4.2`、`spike H2`、`G-05`、`R-09`、`design §7.1`）。
- **目录结构注释**：用 `// ── 段落标题 ──────` 分隔（如 `// ── loadConfig（...）──`）。
- **body 字段对齐 backend（snake_case）**：与 backend（Pydantic）通信的 HTTP body / config 字段用 snake_case（`runtime_id` / `claim_token` / `agent_run_id` / `workspace_dir` / `node_id`）；`DaemonConfig` interface 直接用 snake_case 字段。
- **超时/重试参数集中为常量**：`permission-resolver.ts` `PERMISSION_FALLBACK_TIMEOUT_MS`、`ws-client.ts` `RECONNECT_*` / `CONNECT_*` / `CLOSE_*` 系列。
- **process.* 使用**：`process.env` 优先于 config.json（如 `SPEC_ROOT_MAP`、`SESSION_IDLE_TIMEOUT_SEC` 启动脚本注入）；用 `os.homedir()` 而非 `process.env.HOME`（Windows 下后者可能 undefined）；agent event 直接 `process.stdout.write` 绕过 logger（受 log_level 过滤会丢事件流）。
- **安全边界**：`file-rpc.ts` 强制 `allowed_roots` 校验（`assertWithinAllowedRoots`）；`task-runner.ts` 防 tar 路径穿越；`credential.ts` 占位符仅全串匹配不做子串替换（`{{USER_XXX}}`）；token 绝不入日志/Redis/HTTP（R-09）。

## 历史映射约定（源码残留注释）

源码中大量注释带"对齐 Python `xxx`"的映射说明（如 `config.ts` `等价 Python DEFAULT_CONFIG_DIR`、`hub-client.ts` `对齐 Python httpx.AsyncClient`、`config.ts` `对应 Python None`）。这些是 Python→TS 重写时留下的对照注释，**不是当前技术栈**，可在后续清理债务时移除。
