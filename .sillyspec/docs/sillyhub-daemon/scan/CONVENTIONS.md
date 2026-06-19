---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# sillyhub-daemon · 代码约定

> 基于 src/ 实际源码（TypeScript / ESM）。

## 框架隐形规则

1. **ESM + NodeNext 模块解析**：`package.json` `"type": "module"`，`tsconfig.json` `module/moduleResolution=NodeNext`。所有相对导入**必须带 `.js` 扩展名**（如 `import { Daemon } from './daemon.js'`）—— `verbatimModuleSyntax` 强制。
2. **类型导入用 `import type`**：`verbatimModuleSyntax` 开启后，仅用作类型的导入必须写 `import type { ... }`，否则编译报错。claude-sdk-driver.ts / daemon.ts / ws-client.ts 等普遍采用。
3. **strict + noUncheckedIndexedAccess**：数组/对象下标访问结果类型自动含 `undefined`，强制判空。`config.ts` 的 `normalizeAllowedRoots` 等处可见防御性处理。
4. **不可变常量用 `Object.freeze` + `Readonly`**：`DEFAULT_CONFIG`、`PROTOCOL_PROVIDERS`、`PROVIDER_TO_PROTOCOL` 均冻结；启动期断言（provider 数=12、无重复）在模块加载时执行。
5. **错误用自定义 Error 子类**，集中定义语义化错误：
   - `HubHttpError`（HTTP 非 2xx）、`GitError`（git 失败）、`RpcError`（WS RPC / file-rpc 越界）
   - 交互式会话域：`SessionNotFoundError` / `SessionAlreadyExistsError` / `SessionNotActiveError` / `UnsupportedProviderError` / `SessionQueueClosedError` / `SessionQueueDoubleSubscribeError` / `SessionPersistenceError` / `ClaudeExecutableNotFoundError`
6. **接口优先于具体类做依赖**：`task-runner.ts` 用 `RunnerHubClient` / `RunnerWorkspaceManager` / `RunnerCredentialManager` 鸭子类型接口（避免硬耦合具体类）；`daemon.ts` 用 `RecoveryCoordinator` 接口。
7. **无状态驱动器**：`ClaudeSdkDriver` 故意不持 query 句柄（句柄由 `SessionManager` 持有），便于在 `SessionManagerDeps` 中可替换/测试。
8. **commander program 工厂函数**：`createProgram()` 导出为函数而非顶层单例（commander parse 会修改 program 状态，单例会跨用例污染）。
9. **保护钩子便于测试**：`WsClient._createSocket` 抽为 `protected`，测试可 stub。

## 代码风格

- **命名**：
  - 类/接口/类型：PascalCase（`Daemon` / `DaemonConfig` / `SessionManager`）。
  - 函数/变量：camelCase（`loadConfig` / `getBackend` / `runLease`）。
  - 常量：UPPER_SNAKE_CASE（`DEFAULT_CONFIG` / `PROTOCOL_PROVIDERS / `WS_PATH` / `REST_PREFIX` / `MSG`）。
  - 私有成员：`_` 前缀（`_ws` / `_handleMessage` / `_routeSessionControl`）。
  - 类型联合字面量集中定义后导出（`ProtocolType` / `MsgType` / `LeaseState`）。
- **文件组织**：单文件单主类 + 同域聚合（interactive/ 子目录聚合会话全栈；adapters/ 聚合协议解析）。
- **JSDoc 中文注释**：每个导出符号都配中文 doc 注释，关键设计点引用 task 编号 / spike 结论 / design 节号（如 `task-04 §4.2`、`spike H2`、`D1`、`design §7.1`）。
- **目录结构注释**：用 `// ── 段落标题 ──────` 分隔注释（如 `// ── loadConfig（...）──`）。
- **防御性编程**：no-op 优于抛错（`ClaudeSdkDriver.interrupt` 在 q=null/抛错时返回 false 不冒泡，避免 daemon 主循环崩）；幂等操作（`SessionManager.fail` 可重复调）。
- **安全边界**：`file-rpc.ts` 强制 `allowed_roots` 校验；`task-runner.ts` 防 tar 路径穿越（`tar path traversal blocked` / `tar path escapes target dir`）；`credential.ts` 占位符仅全串匹配不做子串替换。
- **body 字段对齐 backend**：与 backend（Pydantic）通信的 HTTP body 用 snake_case（`runtime_id` / `claim_token` / `agent_run_id`）。
- **import 顺序**：Node 内置（`node:fs` / `node:path`）→ 第三方 → 本地相对路径，类型导入单独 `import type`。

## 历史映射约定（源码残留注释）

源码中大量注释带"对齐 Python `xxx`"的映射说明（如 `config.ts` 的 `等价 Python DEFAULT_CONFIG_DIR / "config.json"`、`hub-client.ts` 的 `对齐 Python httpx.AsyncClient`）。这些是 task-21 Python→TS 重写时留下的对照注释，**不是当前技术栈**，可在后续清理债务时移除（见 CONCERNS.md）。
