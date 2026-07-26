# 代码约定(Conventions)

---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

> 子项目 **sillyhub-daemon**(本地任务执行守护进程,Node.js 重写版)的代码约定。
> 事实来源:`tsconfig.json`、`package.json` 与 `src/` 实际代码。所有引用均为 `file:line` 证据。
> Lint 仅 `tsc --noEmit`(无 eslint/prettier),约定靠 TS 编译选项与代码评审强制。

## 运行环境基线

- Node ≥ 20,ESM only(`package.json` `"type": "module"`;`tsconfig.json` `module`/`moduleResolution = NodeNext`)。
- TypeScript 5.5.4(`package.json` devDependencies),编译到 `dist/`,`target: ES2022`,`rootDir: ./src`,`outDir: ./dist`。
- `tsconfig.json` 开启 `strict`、`noUncheckedIndexedAccess`、`noImplicitOverride`、`forceConsistentCasingInFileNames`、`verbatimModuleSyntax`、`isolatedModules`(第 7-15 行)——这几项直接决定下方“框架隐形规则”。
- 运行时校验用 zod 4(`dependencies.zod: ^4.4.3`);HTTP/WS 客户端为 `ws`、命令行 `commander`;包管理器固定 `pnpm@9.6.0`。
- `pnpm.overrides` 把 9 个平台的 `@anthropic-ai/claude-agent-sdk-*` 全部重定向到统一的 `@anthropic-ai/claude-agent-sdk@0.3.181`(`package.json` 第 34-44 行),保证跨 Windows/Linux/macOS、x64/arm64、glibc/musl 一致。

## 框架隐形规则

这些规则不写在业务代码里,而是由 `tsconfig.json` / Node ESM / pnpm 工具链强制,踩坑会直接编译或运行报错:

1. **相对路径 import 必须带 `.js` 后缀**(NodeNext ESM 要求,TS 不补全):见 `src/cli.ts:54-63`(`from './config.js'`、`'./hub-client.js'`、`'./task-runner.js'`、`'./resilience/service.js'`)、`src/cmd-shim.ts:21`。源码文件是 `.ts`,但 import 路径必须写 `.js`。
2. **Node 内置模块必须带 `node:` 前缀**:`src/cli.ts:42-45`(`'node:fs'`、`'node:fs/promises'`、`'node:path'`、`'node:os'`)、`src/config.ts:25-29`、`src/agent-detector.ts:28-30`。
3. **纯类型导入必须用 `import type`**(`verbatimModuleSyntax` 强制):`src/daemon.ts:42`(`import type { SDKMessage, SDKResultMessage } …`)、`src/daemon.ts:58/84/87`、`src/cli.ts:62/73/75/86`。值与类型混用时拆成两条 import,或用 `import { X, type Y }` 内联(见 `src/adapters/json-rpc.ts:43` 把 `extractShellWritePaths` 与 `type ShellKind` 合并)。
4. **读 JSON 走 ESM 导入属性 `with { type: 'json' }`**(配合 `resolveJsonModule`):`src/daemon-version.ts:20` `import pkg from '../package.json' with { type: 'json' };`。
5. **`noUncheckedIndexedAccess` 下数组/对象下标返回 `T | undefined`**,访问后必须收窄(判空或给默认值),不可假设键存在;`Map.get` / `Set` / `Record` 访问同理。

## 代码风格

1. **异步优先,错误一律 try/catch 包裹**。全仓 `async` 出现 515 次/35 文件,`try/catch` 250 次/26 文件。catch 形参用短名 `e` / `err` / `syncErr`(如 `src/task-runner.ts:868`、`src/ws-client.ts:222`、`src/workspace.ts:380`),取消息再 `(e as Error).message`(见 `src/credential.ts:118`)。可恢复的非致命副步骤 `console.warn` 后继续、不中断主流程(典型见 `src/task-runner.ts:460/470/482` 的 `spec_bundle_pull_failed` / `link_skills_failed` / `prompt_log_failed`)。
2. **网络/HTTP 错误集中分类,可重试状态码单一来源**。`src/resilience/error-classify.ts:21` 定义 `RETRYABLE_STATUS = new Set<number>([429, 500, 502, 503, 504])`,`src/resilience/error-classify.ts:47` 用 `RETRYABLE_STATUS.has(err.status)` 判定;`HubHttpError` 作为统一异常类型在 `src/resilience/service.ts:22` 与 `src/resilience/error-classify.ts:18` 复用。新增重试逻辑走该分类器,勿在调用点重复散落状态码判断。
3. **zod schema 描述工具入参并带 `.describe()` 文档**。MCP 工具 schema 用 `z.object({ … })`,每个字段 `z.string()` / `z.boolean().optional()` 链式 `.describe('...')` 兼顾校验与对外说明,见 `src/mcp-server.ts:164-170`(spawn_worker 入参)、`src/mcp-server.ts:202-204`(await_worker 入参)。zod schema 全仓集中在此文件(18 处 z.object/string/enum 全部落在 `src/mcp-server.ts`)。
4. **结构化日志:事件名蛇形 + key=value 上下文**。事件名一律小写蛇形,如 `workspace_cloned`(`src/workspace.ts:171`)、`workspace_pulled`(`src/workspace.ts:162`)、`borrow_sandbox_workspace_manager_initialized`(`src/daemon.ts:769`)、`already_running`(`src/daemon.ts:791`)、`spec_version_fresh_skip_pull`(`src/task-runner.ts:441`)。日志器由工厂构造(`createLogger` 于 `src/daemon.ts:129`;cli 层用轻量 logger 走 stderr,见 `src/cli.ts:145-147`),业务点统一走注入的 `this._logger` / `logger`,不临时新建。
5. **密钥与环境变量日志必须先 redact**。`src/spawn-env.ts:16` 注释明文规定“任何 env 相关日志**必须**先经 `redactEnv`,禁止直接 `console.log(buildSpawnEnv(...))`”;`src/spawn-env.ts:11` 提供 `redactEnv` / `redactProviderConfig` 守卫遮蔽疑似密钥 value。输出 diff/凭证时也显式注明“redact 留后端二次处理”(`src/workspace.ts:223`、`src/workspace.ts:234`),不在 daemon 侧泄露明文。
6. **命名约定**:类/接口/类型 PascalCase(`Daemon` / `SessionManager` / `ClaudeSdkDriver`);函数/变量 camelCase(`loadConfig` / `runLease` / `createProgram`);常量 UPPER_SNAKE_CASE(`RETRYABLE_STATUS` / `RECONNECT_INTERVAL_MS`);私有成员 `_` 前缀(`this._logger` / `this._ws` / `this._handleMessage`)。
