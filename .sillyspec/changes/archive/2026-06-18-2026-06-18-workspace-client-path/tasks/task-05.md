---
author: qinyi
created_at: 2026-06-18 11:44:49
change: 2026-06-18-workspace-client-path
id: task-05
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-005@v1, D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/src/ws-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/file-rpc.ts
---

# Task-05 — list_dir RPC handler（daemon 端）

## 1. 任务概述

为 `sillyhub-daemon` 实现 **WS RPC 入站处理 + `list_dir` 文件 RPC handler**，构成前端树形目录浏览（FR-03）的 daemon 端闭环。

backend task-04 会经 WS 下行 `daemon:rpc` 消息（method=list_dir），本任务负责：
1. `protocol.ts` 新增 `RPC` / `RPC_RESULT` 消息常量与 type 字面量（与 backend `DAEMON_MSG_RPC`/`DAEMON_MSG_RPC_RESULT` 逐字对齐 design §7.1）。
2. `ws-client.ts` 收到 `daemon:rpc` → 按 `method` 分发到注册的 handler → 发回 `daemon:rpc_result { rpc_id, result | error }`。
3. 新增 `file-rpc.ts`：`listDir(path, allowed_roots)` → `allowed_roots` 白名单校验（D-002，task-02 产出）+ `readdir`/`stat` 返回 `{ entries: [{ name, type }] }`；越界→`forbidden`，不存在→`not_found`。
4. `daemon.ts` 在构造时注入/注册 `list_dir` handler（接到 rpc 调 file-rpc）。

**严格边界**：只做目录列举，**不做文件内容读取**（design §3 非目标；FR-05 spec 走 bundle/sync 而非 RPC 读文件）。`allowed_roots` 由 task-02 提供，本任务只消费。

## 2. 修改文件清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/protocol.ts` | `MSG` 加 `RPC: 'daemon:rpc'`、`RPC_RESULT: 'daemon:rpc_result'`；模块注释补 RPC 协议出处 |
| 修改 | `sillyhub-daemon/src/ws-client.ts` | 新增 RPC handler 注册口（`registerRpcHandler(method, fn)`）+ `onMessage` 内对 `daemon:rpc` 分发 → 异步执行 → `send(RPC_RESULT)`；handler 抛错统一转 `error.code` |
| 新增 | `sillyhub-daemon/src/file-rpc.ts` | `listDir(path, allowed_roots): Promise<ListDirResult>`；allowed_roots 校验（path.resolve + 边界感知 startsWith，防 `..` 穿越）+ readdir/stat + 符号链接/权限错误映射 |
| 修改 | `sillyhub-daemon/src/daemon.ts` | `_wsLoop` 构造 WsClient 后调 `wsClient.registerRpcHandler('list_dir', (params) => listDir(params.path, this._config.allowed_roots))`；`ClientLike`/`WsClientLike` 接口子集补 `registerRpcHandler?`（鸭子类型可选） |

唯一改动文件即上述 4 个（测试文件 `*.test.ts` 同步更新，不在 `allowed_paths` 严格限定内，按项目测试规范管理）。

## 3. 覆盖来源

| 来源 ID | 类型 | 摘要 | 本任务如何落实 |
|---|---|---|---|
| FR-03 | 功能需求 | 前端调 `POST /runtimes/{id}/list-dir {path}` → 返回 `{name,type}[]`；daemon 离线/超时 → 504（504/离线判定在 backend task-04，本任务保证 daemon 端正常回 `RPC_RESULT` 让链路通） | §5 RPC 分发 + list_dir 实现，产出 `{entries:[{name,type}]}` |
| FR-04 | 功能需求 | list_dir 校验 path 必须在某 allowed_root 之下，越界 `error.code=forbidden` | §5.3 `assertWithinAllowedRoots`：path.resolve + 前缀边界比较，越界抛 `RpcError('forbidden')` |
| D-005@v1 | 决策 | daemon 新增 WS RPC（RPC/RPC_RESULT）+ list_dir；前端树形懒加载 | §5.1 协议常量 + §5.2 分发；handler 注册 |
| D-002@v1 | 决策 | list_dir 用 allowed_roots 白名单，越界 forbidden | §5.3 校验函数 + §6 边界 B1 越界 forbidden |
| design §5 Phase 2 | 总体方案 | daemon 侧 list_dir 做 readdir+stat，按 allowed_roots 白名单校验 | §5.3 / §5.4 |
| design §6 | 文件清单 | `protocol.ts` 加 RPC/RPC_RESULT；`ws-client.ts` 收 RPC→调 handler→发 RPC_RESULT；新增 `file-rpc.ts`；`daemon.ts` 注册 handler | §2 / §5 |
| design §7.1 | 接口定义 | WS RPC 协议消息形态（rpc_id / method / params / result / error） | §5.1 类型定义对齐 |
| task-02 | 依赖 | DaemonConfig.allowed_roots: string[]（默认 `[homedir()]`） | §5.3 消费 `config.allowed_roots`，字段名严格对齐 task-02 R-1 |

## 4. 实现要求

### 4.1 高层目标
1. 协议常量与 backend（task-04 + design §7.1）逐字对齐：`daemon:rpc` / `daemon:rpc_result`，rpc_id 用 UUID 字符串（backend 生成、daemon 透传回填，不自己生成）。
2. RPC 分发改在 `ws-client.ts`（消息接收层），handler 实现放在 `file-rpc.ts`（业务层）——保持 ws-client 单一职责（接收/分发/回发），不内嵌 fs 逻辑。
3. handler 是 async；执行中抛错一律转成 `RPC_RESULT.error { code, message }`，**不能让未捕获异常拖崩 WS 连接**（ws-client `_handleMessage` 同步路径里 await 异步 handler 时需 try/catch 包裹）。
4. `list_dir` 输出严格 `{ entries: [{ name: string, type: 'dir' | 'file' }] }`，与 backend schema（task-04）、前端类型（task-11）三端一致；**不返回 size/mtime/权限位**（YAGNI，前端只做树形展示）。
5. 越界判定稳健：`path.resolve(path)` 规范化入参 → 与每个 `allowed_root`（也已是绝对路径，task-02 保证）做「相等 或 以 `root + sep` 开头」判定，杜绝 `/home/user-evil` 误匹配 `/home/user`、杜绝 `..` 穿越。
6. handler 注册时机：daemon `_wsLoop` 构造 WsClient 后立即注册（构造期，非每条消息）；未注册 method 的 RPC → `error.code = 'method_not_found'`。
7. 不做并发限流（list_dir 轻量、前端懒加载串行触发）；不做超时（超时归 backend task-04 R-01 10s 兜底）。

### 4.2 文档同步
- `protocol.ts` MSG 新增项 JSDoc：标注「双向？否——RPC 是 Server→Daemon，RPC_RESULT 是 Daemon→Server」+ design §7.1 出处 + 与 backend `DAEMON_MSG_RPC` 对齐说明。
- `file-rpc.ts` 顶部模块注释：用途（FR-03/FR-04/D-005/D-002）、依赖（config.allowed_roots）、边界清单指针（§6）、明确非目标（不读文件内容）。
- `ws-client.ts` 模块注释补一行：v2 起承担 RPC 分发（仍不内嵌业务）。

## 5. 接口定义（含伪代码）

### 5.1 protocol.ts 新增（与 backend task-04 对齐）

```ts
export const MSG = {
  /* ...现有不变... */

  /**
   * Server → Daemon：远程过程调用请求（FR-03 / D-005@v1）。
   * payload: { rpc_id: string, method: string, params: Record<string, unknown> }
   * rpc_id 由 backend 生成，daemon 在 RPC_RESULT 中原样回填（不自己生成）。
   * 与 backend DAEMON_MSG_RPC = "daemon:rpc" 逐字对齐（design §7.1）。
   */
  RPC: 'daemon:rpc',

  /**
   * Daemon → Server：RPC 结果（成功带 result / 失败带 error）。
   * payload: { rpc_id: string, result?: unknown, error?: { code: string, message: string } }
   * result 与 error 互斥（业务约定：失败时只填 error）。
   * 与 backend DAEMON_MSG_RPC_RESULT = "daemon:rpc_result" 逐字对齐。
   */
  RPC_RESULT: 'daemon:rpc_result',
} as const;
```

> 注：`MsgType` 联合自动包含新字面量（`(typeof MSG)[keyof typeof MSG]`），无需单独改 type。

### 5.2 ws-client.ts RPC 分发（handler 注册 + 收发）

```ts
// ── RPC handler 注册（构造期注入，业务层提供）──────────────────────────────

/** RPC handler 签名：收 params，返回 result（任意可序列化），抛 RpcError 或普通 Error。 */
export type RpcHandler = (
  params: Record<string, unknown>,
) => Promise<unknown> | unknown;

/** WS RPC 错误（带稳定 code，供前端/backend 识别）。 */
export class RpcError extends Error {
  constructor(
    public readonly code: string, // 'forbidden' | 'not_found' | 'method_not_found' | 'internal'
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

// WsClient 内部新增字段：
//   private readonly _rpcHandlers = new Map<string, RpcHandler>();

/**
 * 注册一个 RPC method handler（daemon 在构造 WsClient 后调用）。
 * 同名 method 重复注册：后者覆盖前者 + warn（便于测试覆盖；生产路径只注册一次）。
 */
registerRpcHandler(method: string, handler: RpcHandler): void {
  if (this._rpcHandlers.has(method)) {
    this._handleError(new Error(`rpc handler overwritten: ${method}`));
  }
  this._rpcHandlers.set(method, handler);
}

// ── _handleMessage 扩展：daemon:rpc 分发 ──────────────────────────────────────

private _handleMessage(data: WebSocket.RawData): void {
  /* ...现有 JSON.parse + type 校验不变... */
  // 末尾新增：若是 RPC 消息，异步分发（不阻塞 WS 接收下一条）
  if (msg.type === MSG.RPC) {
    void this._dispatchRpc(msg);
    return;
  }
  this._callbacks.onMessage?.(msg);
}

/**
 * 分发 daemon:rpc：取 handler → 执行 → 回发 daemon:rpc_result。
 * 任何异常（handler 缺失/抛错/返回 reject）都转成 error 回发，绝不向上冒泡到 WS。
 */
private async _dispatchRpc(msg: DaemonMessage): Promise<void> {
  const payload = (msg.payload ?? {}) as {
    rpc_id?: string;
    method?: string;
    params?: Record<string, unknown>;
  };
  const rpcId = typeof payload.rpc_id === 'string' ? payload.rpc_id : '';
  const method = typeof payload.method === 'string' ? payload.method : '';
  const params = payload.params ?? {};

  if (!rpcId) {
    this._handleError(new Error('rpc missing rpc_id, dropping'));
    return; // 无法回填 rpc_id，直接丢弃（backend 那侧 future 会超时 → 504）
  }

  const handler = this._rpcHandlers.get(method);
  if (!handler) {
    this._sendRpcResult(rpcId, undefined, {
      code: 'method_not_found',
      message: `unknown rpc method: ${method}`,
    });
    return;
  }

  try {
    const result = await handler(params);
    this._sendRpcResult(rpcId, result, undefined);
  } catch (e) {
    const code = e instanceof RpcError ? e.code : 'internal';
    const message = e instanceof Error ? e.message : String(e);
    this._sendRpcResult(rpcId, undefined, { code, message });
  }
}

/** 回发 RPC_RESULT（互斥：error 非空时不写 result）。 */
private _sendRpcResult(
  rpcId: string,
  result: unknown,
  error?: { code: string; message: string },
): void {
  const out: DaemonMessage = {
    type: MSG.RPC_RESULT,
    payload: error ? { rpc_id: rpcId, error } : { rpc_id: rpcId, result },
  };
  this.send(out); // send 内部已处理未连接时丢弃 + warn
}
```

> WsClient 现有 `send(msg)` 已可直接发送任意 DaemonMessage（`ws-client.ts:217-228`），无需扩展。`RpcError`/`RpcHandler` 类型 export 供 file-rpc/daemon 引用。

### 5.3 file-rpc.ts 核心（穿越防护 + readdir/stat）

```ts
/**
 * list_dir RPC 实现（FR-03 / FR-04 / D-002 / D-005）。
 *
 * @module file-rpc
 */
import { readdir, stat, lstat } from 'node:fs/promises';
import { resolve as pathResolve, sep } from 'node:path';
import { RpcError } from './ws-client.js';

/** 单条目录项。type 严格 'dir' | 'file'（不暴露 symlink/block 等细分，前端 YAGNI）。 */
export interface DirEntry {
  name: string;
  type: 'dir' | 'file';
}

/** list_dir 成功返回结构（与 backend schema / 前端类型三端对齐）。 */
export interface ListDirResult {
  entries: DirEntry[];
}

/**
 * 列举 path 下的一级子项。
 *
 * @param path          客户端要浏览的目录（任意形态：相对/绝对/含 ..）。
 * @param allowed_roots 白名单根目录（task-02 保证：绝对路径、去重、非空）。
 * @returns { entries: [...] }；目录为空 → entries: []。
 * @throws RpcError('forbidden')  path 落在所有 allowed_root 之外。
 * @throws RpcError('not_found')  path 不存在或不是目录。
 * @throws RpcError('internal')   权限不足 / 其他 fs 错误。
 */
export async function listDir(
  path: string,
  allowed_roots: string[],
): Promise<ListDirResult> {
  // 1. 白名单校验（D-002）
  assertWithinAllowedRoots(path, allowed_roots);

  // 2. 目标必须存在且是目录（用 lstat 判定本体，避免 symlink 误穿透）
  //    注：白名单校验在 resolve 后做，已折叠 ..；此处 lstat 判定的是「目标节点本体」。
  let info;
  try {
    info = await lstat(pathResolve(path));
  } catch (e) {
    throw toRpcError(e, 'listDir.lstat');
  }
  if (!info.isDirectory()) {
    // 文件/符号链接/special → not_found（前端期望只列目录）
    throw new RpcError('not_found', `path is not a directory: ${path}`);
  }

  // 3. readdir（不带 withFileTypes，统一再 stat 每项以正确识别 symlink 目标类型）
  let names: string[];
  try {
    names = await readdir(pathResolve(path));
  } catch (e) {
    throw toRpcError(e, 'listDir.readdir');
  }

  // 4. 逐项 stat（follow symlink：把 symlink-to-dir 归类为 dir，符合树形浏览直觉）
  const entries: DirEntry[] = [];
  for (const name of names) {
    const childAbs = pathResolve(path, name);
    try {
      const s = await stat(childAbs); // stat 跟随 symlink
      entries.push({ name, type: s.isDirectory() ? 'dir' : 'file' });
    } catch (e) {
      // 单项 stat 失败（权限/损坏 symlink）→ 按 file 兜底并 warn（不中断整个列举）
      // 边界 B5：单项失败不应让整个 list_dir 失败
      entries.push({ name, type: 'file' });
    }
  }

  // 5. 稳定排序：先 dir 后 file，同类按 name 字符序（前端展示友好；YAGNI：不做 i18n 排序）
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return { entries };
}

/**
 * 校验 path 落在某 allowed_root 之下（含等于 root 本身）。
 * 防 .. 穿越：先 resolve 折叠，再做「相等 / 以 root+sep 开头」边界敏感比较。
 *
 * @throws RpcError('forbidden')
 */
export function assertWithinAllowedRoots(
  path: string,
  allowed_roots: string[],
): void {
  if (typeof path !== 'string' || path.length === 0) {
    throw new RpcError('forbidden', 'path is empty');
  }
  if (!Array.isArray(allowed_roots) || allowed_roots.length === 0) {
    // task-02 保证非空（默认 [homedir()]），此处兜底防御
    throw new RpcError('forbidden', 'no allowed_roots configured');
  }
  const resolved = pathResolve(path);
  const isWin = sep === '\\' || /^[A-Za-z]:/.test(resolved);
  const eq = (a: string, b: string): boolean =>
    isWin ? a.toLowerCase() === b.toLowerCase() : a === b;
  const under = (root: string): boolean => {
    const r = pathResolve(root);
    if (eq(resolved, r)) return true;
    // 边界敏感：必须 root + sep 开头，避免 /home/user 匹配 /home/user-evil
    return resolved.startsWith(r + sep) ||
      (isWin && resolved.toLowerCase().startsWith(r.toLowerCase() + sep));
  };
  if (!allowed_roots.some(under)) {
    throw new RpcError(
      'forbidden',
      `path outside allowed_roots: ${resolved}`,
    );
  }
}

/** fs 错误 → RpcError 映射（B5 权限不足 / B3 不存在 / 其他 internal）。 */
function toRpcError(e: unknown, where: string): RpcError {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? (e as { code: string }).code
      : '';
  const msg = e instanceof Error ? e.message : String(e);
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new RpcError('not_found', `${where}: ${msg}`);
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new RpcError('internal', `${where}: permission denied`);
  }
  return new RpcError('internal', `${where}: ${msg}`);
}
```

### 5.4 daemon.ts 注册 handler

```ts
// _wsLoop 内构造 WsClient 之后、connect() 之前：
this._wsClient = this._wsClientFactory({ /* ...callbacks... */ });

// task-05：注册 list_dir RPC handler
if ('registerRpcHandler' in this._wsClient && typeof this._wsClient.registerRpcHandler === 'function') {
  (this._wsClient as { registerRpcHandler: (m: string, h: (p: Record<string, unknown>) => Promise<unknown>) => void })
    .registerRpcHandler('list_dir', async (params) => {
      const path = typeof params.path === 'string' ? params.path : '';
      return listDir(path, this._config.allowed_roots);
    });
}
```

> 用鸭子类型探测 `registerRpcHandler`（与现有 `WsClientLike`/`ClientLike` 风格一致，便于测试 mock 不强制实现）。`ClientLike`/`WsClientLike` interface 子集补 `registerRpcHandler?`（可选），同时 import `listDir` from './file-rpc.js'。

### 5.5 穿越防护专项（D-002 落点）

| 攻击向量 | 输入示例 | 防护点 | 结果 |
|---|---|---|---|
| `..` 穿越 | `path = "/home/user/../../etc/passwd"` | `pathResolve` 折叠 → `/etc/passwd` → `under(root)` false | forbidden |
| 兄弟目录前缀撞名 | `allowed_root="/home/qinyi"`, `path="/home/qinyi-evil"` | `root + sep` 边界敏感（`/home/qinyi/` 前缀），`/home/qinyi-evil` 不匹配 | forbidden |
| 相对路径 | `path="./secret"`（cwd 在 root 外） | `pathResolve` 基于 cwd → 若落在 root 外 → forbidden | forbidden |
| 大小写绕过（win） | `path="C:\\Users\\QINYI"` vs root `C:\\Users\\qinyi` | `isWin` 时 `eq`/`under` 走 toLowerCase | 允许（NTFS 不区分大小写） |
| 符号链接逃逸 | root 内有 symlink 指向 root 外 | **本任务不防**（readdir 不解析 symlink 目标是否逃逸；listDir 列 symlink 当 file/dir 但不跟随去读 root 外）。理由：allowed_roots 约束的是「前端能浏览的目录」而非「解析后的真实 inode 位置」；深层 symlink 沙箱属另一安全议题（YAGNI，记录于 §9 R-2） | 列出 symlink 节点本身 |

## 6. 边界处理（≥5 条）

| 编号 | 边界场景 | 输入示例 | 期望行为 | 实现位置 |
|---|---|---|---|---|
| B1 | 越界 forbidden | `path="/etc"`, `allowed_roots=["/home/qinyi"]` | `RpcError('forbidden', 'path outside allowed_roots: /etc')` → RPC_RESULT.error.code=forbidden | `assertWithinAllowedRoots` |
| B2 | 路径不存在 | `path="/home/qinyi/does-not-exist"`（在 root 内但不存在） | `RpcError('not_found')`（lstat ENOENT 映射）→ error.code=not_found | `toRpcError` ENOENT 分支 |
| B3 | 符号链接目标 | root 内 symlink → 另一 root 内 dir；或 → 不存在的目标 | 父目录列举时：`stat(child)` 跟随 → symlink-to-dir 归 dir、symlink-to-file 归 file；目标损坏（ENOENT）→ 兜底 file + 不中断 | `listDir` step 4 try/catch |
| B4 | 权限不足 | `path` 本身无读权限（EACCES），或某子项无权限 | `RpcError('internal', 'permission denied')`（父目录）；子项失败→该项降级 file，不影响整体 | `toRpcError` EACCES/EPERM + step 4 单项 catch |
| B5 | 空目录 | `path` 合法但无子项 | 返回 `{ entries: [] }`（**非 error**，前端渲染空树节点） | `listDir` step 3-4 正常返回空数组 |
| B6 | path 不是目录 | `path="/home/qinyi/file.txt"`（在 root 内但是文件） | `RpcError('not_found', 'path is not a directory')`（前端只期望列目录） | `listDir` step 2 `!isDirectory()` |
| B7 | RPC 字段缺失/畸形 | `payload.params` 无 path / path 非字符串 / rpc_id 缺失 | rpc_id 缺失 → 丢弃 + warn（无法回填）；path 缺失 → `RpcError('forbidden', 'path is empty')` 回发 | `_dispatchRpc` + `assertWithinAllowedRoots` 空串检查 |
| B8 | 未注册 method | backend 发 `method="read_file"`（本任务不实现） | `error.code='method_not_found'` 回发，不崩 | `_dispatchRpc` handler 缺失分支 |
| B9 | handler 抛非 RpcError | listDir 内部 bug 抛普通 Error | 转成 `error.code='internal'` + 原 message 回发，不向上冒泡到 WS | `_dispatchRpc` catch |
| B10 | 并发多个 list_dir | 前端快速展开多节点，多条 RPC 并行到达 | 每条 `_dispatchRpc` 独立 `void` 异步，互不阻塞；无锁无竞态（fs 操作只读） | `_handleMessage` `void this._dispatchRpc` |

**非目标（明确不做）**：
- ❌ 不做文件内容读取（read_file / cat）——design §3 非目标；spec 下发走 FR-05 bundle/sync。
- ❌ 不做递归列举（深度参数 depth）——前端树形懒加载逐层展开，YAGNI。
- ❌ 不做 hidden 文件过滤——返回全部 entries，过滤交前端（不同 OS dotfile 约定不同）。
- ❌ 不做 entries 体积上限——前端懒加载单层通常 < 1000 项；超大目录监控留待性能问题出现再加（YAGNI）。
- ❌ 不做符号链接逃逸深层沙箱——见 §5.5 / §9 R-2。

## 7. TDD（测试用例）

遵循 CLAUDE.md「写测试 → 写实现」。测试文件 `sillyhub-daemon/src/file-rpc.test.ts`（新增）+ `ws-client.test.ts`（已有则补 RPC 分发用例）。用例规格：

### 7.1 file-rpc.test.ts（list_dir + assertWithinAllowedRoots）

| 用例 ID | 场景 | 输入 | 期望 | 对应边界 |
|---|---|---|---|---|
| T1 | 合法 root 内目录列举 | tmp 目录建 `a/`(dir) + `b.txt`(file) + `c/`(dir)，path=tmp，roots=[tmp] | `entries` 含 3 项，排序后 `[c(dir), a(dir), b.txt(file)]`（dir 优先 + 字母序） | 正常 |
| T2 | 越界 forbidden | path=`/etc`, roots=[`/home/x`] | reject `RpcError` code=forbidden | B1 |
| T3 | `..` 穿越 forbidden | path=`/home/x/../../etc`, roots=[`/home/x`] | reject forbidden（resolve 后 `/etc` 不在 root 下） | B1/§5.5 |
| T4 | 兄弟撞名 forbidden | path=`/home/x-evil`, roots=[`/home/x`] | reject forbidden（`/home/x/` 前缀不匹配 `/home/x-evil`） | B1/§5.5 |
| T5 | path 等于 root 本身 | path=roots[0] | 允许，列举 root 一级子项 | §5.5 `eq(resolved, r)` |
| T6 | 不存在 not_found | path=`<tmp>/nope`（在 root 内） | reject not_found | B2 |
| T7 | path 是文件 not_found | path=`<tmp>/file.txt`（在 root 内） | reject not_found 'is not a directory' | B6 |
| T8 | 空目录 → entries:[] | path=空 tmp 目录 | resolve `{ entries: [] }`（非 reject） | B5 |
| T9 | 符号链接归类 | tmp 内 symlink→dir、symlink→file、symlink→不存在 | dir-symlink 归 dir；file-symlink 归 file；dangling 兜底 file；整体不 reject | B3 |
| T10 | 子项权限不足降级 | tmp 内建一无权限子项（chmod 000），父目录可读 | 整体不 reject；该子项降级 file（或按实现 stat 失败兜底） | B4 |
| T11 | allowed_roots 为空 | roots=[] | reject forbidden 'no allowed_roots configured' | B1 兜底 |
| T12 | path 空串/非字符串 | path="" | reject forbidden 'path is empty' | B7 |
| T13 | 大小写（win only，skip on posix） | path=`C:\USERS\X`, root=`C:\users\x` | 允许 | §5.5 isWin |

### 7.2 ws-client.test.ts（RPC 分发）

| 用例 ID | 场景 | 输入 | 期望 | 对应边界 |
|---|---|---|---|---|
| T14 | 注册 handler 并收到 RPC | register `list_dir` → mock handler 返回 `{entries:[]}`；收 `daemon:rpc {rpc_id, method:'list_dir', params:{path}}` | `send` 被调一次，参数 type=`daemon:rpc_result`，payload.rpc_id 回填，payload.result 等于 handler 返回值 | §5.2 正常路径 |
| T15 | handler 抛 RpcError | handler reject `RpcError('forbidden','...')` | RPC_RESULT.error = {code:'forbidden', message}；不抛到外层 | B1/B9 |
| T16 | handler 抛普通 Error | handler reject `new Error('boom')` | error.code='internal'；message='boom' | B9 |
| T17 | 未注册 method | 收 method='unknown' | error.code='method_not_found' | B8 |
| T18 | rpc_id 缺失 | 收 `{method, params}` 无 rpc_id | 不调 send（丢弃）；触发 onError warn | B7 |
| T19 | path 缺失（params 无 path） | register list_dir → handler 调 listDir(undefined,...) → file-rpc 抛 forbidden 空串 | RPC_RESULT.error.code=forbidden | B7 |
| T20 | 并发 RPC 不阻塞 | 快速发 2 条 RPC（handler 用 setTimeout） | 两条 RPC_RESULT 各自回填对应 rpc_id，顺序无关 | B10 |
| T21 | 同名 method 重复注册 | register 'list_dir' 两次 | 后者生效；首次触发 warn（onError） | §5.2 |

TDD 顺序：T2~T4/T11/T12（穿越防护，最关键）先行驱动 `assertWithinAllowedRoots` → T1/T5/T8 驱动 listDir 主体 → T6/T7/T9/T10 驱动错误映射 → T14~T21 驱动 ws-client 分发。

## 8. 验收标准（对照需求/决策）

| 验收点 | 来源 | 验证方式 | 通过条件 |
|---|---|---|---|
| AC-1 protocol.ts MSG 含 `RPC='daemon:rpc'` / `RPC_RESULT='daemon:rpc_result'` | D-005@v1 / design §7.1 | grep + `tsc --noEmit` | 字面量存在；与 backend `DAEMON_MSG_RPC`/`DAEMON_MSG_RPC_RESULT` 字符串逐字相等 |
| AC-2 list_dir 越界返回 forbidden | FR-04 / D-002@v1 | 单测 T2/T3/T4 | error.code === 'forbidden'；穿越用例全覆盖 |
| AC-3 list_dir 正常返回 {entries:[{name,type}]} | FR-03 / design §7.1 | 单测 T1/T5/T8 | 结构精确匹配；空目录返回 entries:[]；排序稳定 |
| AC-4 路径不存在 / 非目录 → not_found | 本任务 B2/B6 | 单测 T6/T7 | error.code === 'not_found' |
| AC-5 符号链接正确归类不崩 | 本任务 B3 | 单测 T9 | dangling symlink 兜底 file，整体不 reject |
| AC-6 权限不足子项不中断整体列举 | 本任务 B4 | 单测 T10 | 整体成功返回，权限受限项降级 |
| AC-7 ws-client RPC 分发回填 rpc_id | D-005@v1 | 单测 T14 | RPC_RESULT.payload.rpc_id 等于入站 rpc_id |
| AC-8 handler 异常不崩 WS 连接 | 本任务 B9 | 单测 T15/T16 | RpcError 与普通 Error 都转 error 回发；ws-client 不抛、不断连 |
| AC-9 未注册 method → method_not_found | 本任务 B8 | 单测 T17 | error.code === 'method_not_found' |
| AC-10 不做文件内容读取（非目标守住） | design §3 | 代码静态检查 | file-rpc.ts 仅 import readdir/stat/lstat，无 readFile/createReadStream |
| AC-11 daemon.ts 注册 list_dir handler | D-005@v1 | 静态检查 + 集成测 | `_wsLoop` 构造 WsClient 后调 registerRpcHandler('list_dir', ...) |
| AC-12 端到端：backend(task-04)→daemon→回 RPC_RESULT | FR-03 | 手动/集成（依赖 task-04） | 前端调 list-dir 端点能拿到 entries（task-04 落地后联调；本任务单元层证明 daemon 端正确） |
| AC-13 不引入非 allowed_paths 文件改动 | 本任务边界 | `git diff --name-only` | 仅 protocol.ts / ws-client.ts / daemon.ts / file-rpc.ts（+ 对应 .test.ts） |
| AC-14 TypeScript 严格模式编译通过 | 项目规约 | `pnpm tsc --noEmit` | 0 error |
| AC-15 现有 daemon 行为零回归 | design §9 | 启动 daemon + 心跳 + 一次 task_available | 启动正常；现有 lease 流程不受 RPC 分发影响（rpc 消息走独立分支，不进 onMessage） |

## 9. 风险与备注

- **R-1（与 task-02 / task-04 接口契约）**：
  - task-02 提供 `config.allowed_roots: string[]`（字段名 snake_case，task-02 R-1 已强调），本任务 `this._config.allowed_roots` 引用必须严格同名。
  - task-04 定义 backend 端 `DAEMON_MSG_RPC`/`DAEMON_MSG_RPC_RESULT` 字符串值与 rpc_id 生成规则；本任务 `MSG.RPC`/`MSG.RPC_RESULT` 字面量必须逐字相等（design §7.1 已定 `daemon:rpc`/`daemon:rpc_result`）。建议 task-04 落地后跑一次跨端契约单测核对。
- **R-2（符号链接逃逸未防）**：`listDir` 只校验 `path` 本身在 allowed_roots 内，不递归判定 readdir 出来的 symlink 是否指向 root 外。深层 symlink 沙箱（如拒绝列出「指向 root 外的 symlink」）属另一安全议题，本次 YAGNI 不做；若后续需要，可在 step 4 加 `lstat` 判定 symlink 后拒绝或标记。需在 file-rpc.ts 模块注释明确标注此限制。
- **R-3（大小写归一平台依赖）**：`isWin` 判定基于 `sep==='\\'` 或盘符正则；Linux/macOS 大小写敏感不归一。若 daemon 跑在 case-sensitive FS（Linux 默认）而用户配 root 大小写不一致，会被判 forbidden——属配置错误，文档（task-02 JSDoc）已提示「请配绝对路径」，本任务不额外归一。
- **R-4（readdir 大目录性能）**：单层 readdir 全量返回，无分页/流式。前端懒加载单层通常 < 1000 项可接受；若客户端有数万项目录需后续加分页参数（YAGNI 暂不做，AC-10 之外的性能议题）。
- **R-5（WsClient 测试可注入性）**：daemon 用鸭子类型探测 `registerRpcHandler`，测试 mock WsClient 不强制实现该方法（`WsClientLike` 子集 optional）。生产路径真实 WsClient 必须实现，否则 handler 不注册、所有 list_dir 返回 method_not_found——需在 daemon 集成测覆盖一次（AC-11）。
- **R-6（rpc_id 不是 UUID 也能透传）**：本任务不强校验 rpc_id 格式，只要非空字符串即回填；格式约束在 backend task-04。防御性：rpc_id 空串 → 丢弃 + warn（B7）。

## 10. 出参检查清单（执行阶段自检）

- [ ] `protocol.ts` 新增 RPC/RPC_RESULT 常量 + JSDoc（引用 D-005/design §7.1）
- [ ] `ws-client.ts` 新增 `RpcError` / `RpcHandler` 类型 export、`registerRpcHandler` 方法、`_dispatchRpc`/`_sendRpcResult` 私有方法
- [ ] `ws-client.ts` `_handleMessage` 对 `daemon:rpc` 分支分发（不进 onMessage）
- [ ] `file-rpc.ts` 新增：`listDir` + `assertWithinAllowedRoots` + `toRpcError` + DirEntry/ListDirResult 类型 export
- [ ] `file-rpc.ts` 顶部模块注释含 FR/决策引用 + 非目标声明（不读文件内容）+ 符号链接限制（R-2）
- [ ] `daemon.ts` `_wsLoop` 注册 list_dir handler；import listDir
- [ ] 穿越防护用例 T2/T3/T4 全过
- [ ] 单测 T1~T21 全过
- [ ] `tsc --noEmit` 0 error
- [ ] `git diff --name-only` 仅 4 个 allowed_paths（+ .test.ts）
- [ ] 现有 daemon 启动 + 心跳 + lease 流程手动回归无异常
