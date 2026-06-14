---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-03
title: 协议常量定义（src/protocol.ts，对齐 backend protocol.py）
priority: P0
estimated_hours: 1
depends_on: [task-01]
blocks: [task-17, task-18, task-20, task-22]
allowed_paths:
  - sillyhub-daemon/src/protocol.ts
---

# task-03 — 协议常量定义（src/protocol.ts，对齐 backend protocol.py）

> 变更：`2026-06-13-daemon-nodejs-rewrite` · Wave W0 · 纯常量模块，无运行时逻辑。
> 对应 design.md G-02「契约不变」、R-02「WS 消息类型/lease 状态机漂移」P0 风险缓解。
> 对应 tasks.md T-W0-03。

## 修改文件

| 操作 | 路径 | 说明 |
|------|------|------|
| 新增 | `sillyhub-daemon/src/protocol.ts` | 仅导出常量与字面量类型别名，不含任何函数、状态、副作用 |

不新增/不修改其他文件。本 task 不写测试文件（契约单测归入 task-04 测试脚手架落地的迁移工作，见 T-W0-04），但本文档第 9 节给出契约单测范例代码，供 task-04/task-17 引用。

## 实现要求

### 双端来源（铁律：逐字对齐，不得改任何字符）

| 来源 | 路径 | 角色 |
|------|------|------|
| backend 对端（**权威基准**） | `backend/app/modules/daemon/protocol.py` | 字符串值以本文件为准 |
| daemon Python 端（待重写源） | `sillyhub-daemon/sillyhub_daemon/protocol.py` | 用于交叉校验，值必须与 backend 一致 |
| 模块文档 | `.sillyspec/docs/sillyhub-daemon/modules/protocol.md` | 契约摘要 |

**已比对结论**（撰写本蓝图前已 Read 两文件）：

两端 Python 文件常量值**逐字完全一致**，仅变量命名前缀不同（backend 端加 `DAEMON_` 前缀，daemon 端无前缀）；本 task 采用 daemon Python 端的短命名（`MSG_*` / `STATE_*`），与模块文档约定一致。

### 待拷贝常量清单

**WS 消息类型 — Server → Daemon（2 个）**

| TS 键 | backend 变量 | daemon 变量 | 字符串值（逐字） |
|-------|--------------|-------------|-------------------|
| `MSG.TASK_AVAILABLE` | `DAEMON_MSG_TASK_AVAILABLE` | `MSG_TASK_AVAILABLE` | `'daemon:task_available'` |
| `MSG.HEARTBEAT` | `DAEMON_MSG_HEARTBEAT` | `MSG_HEARTBEAT` | `'daemon:heartbeat'` |

**WS 消息类型 — Daemon → Server（6 个）**

| TS 键 | backend 变量 | daemon 变量 | 字符串值（逐字） |
|-------|--------------|-------------|-------------------|
| `MSG.REGISTER` | `DAEMON_MSG_REGISTER` | `MSG_REGISTER` | `'daemon:register'` |
| `MSG.HEARTBEAT_ACK` | `DAEMON_MSG_HEARTBEAT_ACK` | `MSG_HEARTBEAT_ACK` | `'daemon:heartbeat_ack'` |
| `MSG.LEASE_CLAIM` | `DAEMON_MSG_LEASE_CLAIM` | `MSG_LEASE_CLAIM` | `'daemon:lease_claim'` |
| `MSG.LEASE_START` | `DAEMON_MSG_LEASE_START` | `MSG_LEASE_START` | `'daemon:lease_start'` |
| `MSG.LEASE_COMPLETE` | `DAEMON_MSG_LEASE_COMPLETE` | `MSG_LEASE_COMPLETE` | `'daemon:lease_complete'` |
| `MSG.LEASE_MESSAGES` | `DAEMON_MSG_LEASE_MESSAGES` | `MSG_LEASE_MESSAGES` | `'daemon:lease_messages'` |

**Lease 任务状态（5 个）**

| TS 键 | daemon 变量 | 字符串值（逐字） |
|-------|-------------|-------------------|
| `LEASE_STATE.PENDING` | `STATE_PENDING` | `'pending'` |
| `LEASE_STATE.RUNNING` | `STATE_RUNNING` | `'running'` |
| `LEASE_STATE.COMPLETED` | `STATE_COMPLETED` | `'completed'` |
| `LEASE_STATE.FAILED` | `STATE_FAILED` | `'failed'` |
| `LEASE_STATE.CANCELLED` | `STATE_CANCELLED` | `'cancelled'` |

> backend 端 protocol.py 无 STATE_* 常量定义；状态值源自 backend lease 状态机（`backend/app/modules/daemon/lease_service.py` 的 lease 状态字符串）与 daemon Python 端 protocol.py 的 `STATE_*` 一一对应。本 task 以 daemon Python 端 protocol.py 为逐字基准（design.md N-01：Node 迁就 backend；daemon Python 端已是 backend 对端契约的对齐产物）。

**WS 端点路径**

来源 `sillyhub-daemon/sillyhub_daemon/daemon.py:160`：
```python
return f"{ws_base}/api/daemon/ws?runtime_id={self._runtime_id}"
```
→ TS 常量 `WS_PATH = '/api/daemon/ws'`，query 参数 `runtime_id` 由调用方拼接（task-18 WsClient 负责）。

**REST 端点前缀**

来源 `sillyhub-daemon/sillyhub_daemon/client.py` 所有端点共享前缀 `/api/daemon`（register/heartbeat/leases/{id}/claim|start|heartbeat|messages|complete、runtimes/{id}/pending-leases）。
backend 对端 `backend/app/modules/daemon/router.py:44` `APIRouter(prefix="/daemon")` + `main.py:237` `include_router(daemon_router, prefix="/api")` = `/api/daemon`。
→ TS 常量 `REST_PREFIX = '/api/daemon'`。

## 接口定义

`protocol.ts` 完整代码（搬砖工直接拷贝保存，**不要改动任何字符串字面量**）：

```ts
/**
 * Daemon ↔ Server WebSocket 消息协议常量与 lease 任务状态常量。
 *
 * 所有字符串值**逐字对齐** backend 对端：
 *   - WS 消息类型: backend/app/modules/daemon/protocol.py (DAEMON_MSG_*)
 *   - Lease 状态:  sillyhub-daemon/sillyhub_daemon/protocol.py (STATE_*)
 *   - WS 路径:     sillyhub-daemon/sillyhub_daemon/daemon.py:160
 *   - REST 前缀:   backend/app/modules/daemon/router.py:44 + main.py:237
 *
 * 修改任何常量前必须先改 backend 对端并走契约单测（见 task-04）。design.md G-02 / R-02。
 *
 * @module protocol
 */

// ── WebSocket 消息类型 ───────────────────────────────────────────────────────
// 值形如 `daemon:<action>`，前缀 `daemon:` 不可漏。

/** Server → Daemon 消息类型 + 双向消息（HEARTBEAT 既入又出）。 */
export const MSG = {
  /** Server → Daemon：有 lease 任务可认领（带 runtime_id / task_id / lease_id payload）。 */
  TASK_AVAILABLE: 'daemon:task_available',
  /** 双向心跳：Daemon 上行保活，Server 下行探活。 */
  HEARTBEAT: 'daemon:heartbeat',

  /** Daemon → Server：首次连接注册 runtime（agent_name + capability）。 */
  REGISTER: 'daemon:register',
  /** Daemon → Server：对 Server HEARTBEAT 的应答（含 pending_operations）。 */
  HEARTBEAT_ACK: 'daemon:heartbeat_ack',
  /** Daemon → Server：声明开始认领某 lease（runtime_id + lease_id）。 */
  LEASE_CLAIM: 'daemon:lease_claim',
  /** Daemon → Server：lease 执行正式开始（携带 claim_token）。 */
  LEASE_START: 'daemon:lease_start',
  /** Daemon → Server：lease 执行完成（result: status + patch + stats）。 */
  LEASE_COMPLETE: 'daemon:lease_complete',
  /** Daemon → Server：lease 执行期间增量上报 agent 消息事件。 */
  LEASE_MESSAGES: 'daemon:lease_messages',
} as const;

/** WebSocket 消息类型联合（字面量），用于 DaemonMessage.type。 */
export type MsgType = (typeof MSG)[keyof typeof MSG];

// ── Lease 任务状态 ────────────────────────────────────────────────────────────
// 与 backend lease 状态机字符串值一一对应。

/** Lease 生命周期状态。 */
export const LEASE_STATE = {
  /** 待认领：lease 已创建，等待 daemon LEASE_CLAIM。 */
  PENDING: 'pending',
  /** 执行中：LEASE_START 已发，daemon 正在跑 agent。 */
  RUNNING: 'running',
  /** 成功：LEASE_COMPLETE result.status === completed。 */
  COMPLETED: 'completed',
  /** 失败：LEASE_COMPLETE result.status === failed 或执行抛错。 */
  FAILED: 'failed',
  /** 取消：用户主动 cancel 或 lease 过期。 */
  CANCELLED: 'cancelled',
} as const;

/** Lease 状态联合（字面量），用于 TaskResult.status / lease.status 字段。 */
export type LeaseState = (typeof LEASE_STATE)[keyof typeof LEASE_STATE];

// ── 端点路径 ──────────────────────────────────────────────────────────────────

/**
 * WebSocket 端点路径（不含 origin / query）。
 * 完整 URL 形如：`{wsBase}/api/daemon/ws?runtime_id={runtime_id}`。
 * query 参数 `runtime_id` 由调用方拼接（task-18 WsClient._buildWsUrl）。
 */
export const WS_PATH = '/api/daemon/ws';

/**
 * REST API 路径前缀（不含 origin）。
 * 端点形如：`{restPrefix}/register`、`{restPrefix}/leases/{id}/claim`。
 * task-17 HubClient 在此前缀后拼具体子路径。
 */
export const REST_PREFIX = '/api/daemon';
```

## 边界处理

1. **双端不一致以 backend 为准**：若 `sillyhub-daemon/sillyhub_daemon/protocol.py` 与 `backend/app/modules/daemon/protocol.py` 任一字符串值出现差异，立即停止实现，以 backend 端为权威基准，并在本蓝图第 2 节「双端来源」表格下追加「⚠ 漂移记录」说明差异点 + 处置（提交 issue 要求修齐 daemon Python 端或 backend 端，本 task 仍只对齐 backend）。当前已校验：两端 8 个 MSG + 5 个 STATE 值逐字一致，无漂移。
2. **新增消息类型须同步双端**：本 task 实现期或后续若需新增 `MSG_*`，必须**先**在 backend 对端 `protocol.py` 落地新常量并部署，再在本 `protocol.ts` 添加等值键；严禁本端先加（design.md N-01：不改 backend 端 protocol.py / daemon REST 端点，Node 版迁就 backend）。
3. **`as const` 保证字面量类型**：所有常量对象必须以 `as const` 收尾，使 `MsgType` / `LeaseState` 退化为字面量联合类型（如 `'daemon:register' | 'daemon:heartbeat' | ...`），而非宽泛的 `string`；这样 types.ts 的 `DaemonMessage.type: MsgType` 能在编译期拦截非法消息类型赋值。
4. **不导出可变对象**：`MSG` / `LEASE_STATE` 只允许读，TS `as const` 已将属性标记为 `readonly`；运行期若被尝试 `MSG.TASK_AVAILABLE = 'x'`（在 strict 模式下）会编译失败。代码不得提供任何 setter 或 re-export 别名（如 `export { MSG as MSG_ALIAS }` 后允许改写）。
5. **前缀 `daemon:` 不可漏**：所有 8 个 MSG 字符串必须以 `daemon:` 开头；backend WS Hub（`backend/app/modules/daemon/ws_hub.py`）路由分发依赖此前缀，缺前缀会导致消息落入 `ws_unknown_message_type` warning 分支。本蓝图已逐字给出，搬砖工不得「优化」成 `'task_available'` 之类短写。
6. **不引入运行时逻辑**：本文件只允许出现 `export const` / `export type`，禁止任何 `function` / `class` / `import`（除类型 import 外，本文件无需任何 import）；禁止 `console.log` / 顶层副作用；禁止 default export（保持具名导出便于 tree-shaking 与契约单测静态断言）。
7. **`daemon:` 前缀 vs 状态值无前缀**：LEASE_STATE 的 5 个值刻意不带任何前缀（`'pending'` 而非 `'lease:pending'`），与 backend lease 状态机字符串一致；不要「对称美化」成带前缀形式。

## 非目标

- **不定义数据结构类型**：`DaemonMessage`（`{ type: MsgType; payload?: Record<string, unknown> }`）、`TaskAvailablePayload` / `HeartbeatPayload` / `LeaseClaimPayload` / `LeaseCompletePayload` 等 Pydantic 模型对应的 TS interface **不放在 protocol.ts**，归 task-02（`src/types.ts`，T-W0-02）。
- **不改 backend**：backend 端 `protocol.py` / `router.py` / `lease_service.py` 完全不动（design.md N-01）。
- **不实现 WS / REST 客户端**：`WS_PATH` / `REST_PREFIX` 仅作常量导出，URL 拼接、fetch 调用、ws 连接逻辑归 task-17（HubClient）/ task-18（WsClient）。
- **不引入配置项**：origin / port / token 等运行时配置归 task-08（config.ts），本文件不含 `SERVER_URL` 之类的可配置项。
- **不写契约单测本体**：本 task 只产出 `protocol.ts`；契约单测文件（`tests/protocol.contract.test.ts`）归 task-04 落地，本蓝图第 9 节仅给出范例代码供其复用。

## 参考

- **backend 对端（权威基准）**：`backend/app/modules/daemon/protocol.py`（MSG 值 + Payload Pydantic 模型，本 task 仅取 MSG 值）
- **daemon Python 端（待重写源）**：`sillyhub-daemon/sillyhub_daemon/protocol.py`（MSG + STATE 值，命名短）
- **WS 路径源**：`sillyhub-daemon/sillyhub_daemon/daemon.py:160` `_build_ws_url` 返回 `f"{ws_base}/api/daemon/ws?runtime_id={...}"`
- **REST 前缀源**：`sillyhub-daemon/sillyhub_daemon/client.py`（`/api/daemon/register` 等所有端点共享前缀）；backend 对端 `backend/app/modules/daemon/router.py:44` + `backend/app/main.py:237`
- **模块文档**：`.sillyspec/docs/sillyhub-daemon/modules/protocol.md`（契约摘要）
- **变更设计**：`.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/design.md` G-02 / N-01 / R-02、§7.4 protocol.ts 蓝图骨架
- **变更需求**：`.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/requirements.md`

## TDD 步骤

契约单测目标：断言 `protocol.ts` 导出的每个字符串值与 backend Python 对端的实际字符串**完全相等**，任一字符漂移即失败（对应 R-02）。

> 测试文件路径：`sillyhub-daemon/tests/protocol.contract.test.ts`（归 task-04 脚手架创建，本 task 实现完成后即可立即编写并运行）。本蓝图给出完整可运行测试代码。

**RED 阶段 — 先写契约单测（硬编码期望值，来自 backend protocol.py）**：

```ts
// tests/protocol.contract.test.ts
import { describe, it, expect } from 'vitest';
import { MSG, LEASE_STATE, WS_PATH, REST_PREFIX } from '../src/protocol';

describe('protocol.MSG — 逐字对齐 backend/app/modules/daemon/protocol.py', () => {
  // 期望值硬编码自 backend DAEMON_MSG_*（撰写本蓝图时已 Read 确认）
  it('Server → Daemon 消息', () => {
    expect(MSG.TASK_AVAILABLE).toBe('daemon:task_available');
    expect(MSG.HEARTBEAT).toBe('daemon:heartbeat');
  });

  it('Daemon → Server 消息', () => {
    expect(MSG.REGISTER).toBe('daemon:register');
    expect(MSG.HEARTBEAT_ACK).toBe('daemon:heartbeat_ack');
    expect(MSG.LEASE_CLAIM).toBe('daemon:lease_claim');
    expect(MSG.LEASE_START).toBe('daemon:lease_start');
    expect(MSG.LEASE_COMPLETE).toBe('daemon:lease_complete');
    expect(MSG.LEASE_MESSAGES).toBe('daemon:lease_messages');
  });

  it('全部 8 个 MSG 以 daemon: 为前缀', () => {
    for (const v of Object.values(MSG)) {
      expect(v.startsWith('daemon:')).toBe(true);
    }
  });
});

describe('protocol.LEASE_STATE — 逐字对齐 daemon protocol.py STATE_*', () => {
  it('5 个状态值', () => {
    expect(LEASE_STATE.PENDING).toBe('pending');
    expect(LEASE_STATE.RUNNING).toBe('running');
    expect(LEASE_STATE.COMPLETED).toBe('completed');
    expect(LEASE_STATE.FAILED).toBe('failed');
    expect(LEASE_STATE.CANCELLED).toBe('cancelled');
  });
});

describe('protocol 端点路径', () => {
  it('WS_PATH 对齐 daemon.py:160 _build_ws_url', () => {
    expect(WS_PATH).toBe('/api/daemon/ws');
  });
  it('REST_PREFIX 对齐 backend router.py:44 + main.py:237', () => {
    expect(REST_PREFIX).toBe('/api/daemon');
  });
});

describe('protocol 类型守卫（编译期保证字面量类型）', () => {
  it('MsgType 是字面量联合而非 string', () => {
    // 此处的赋值若 MSG 未声明 as const，TS 会推断为 string 而非字面量
    const t: 'daemon:register' = MSG.REGISTER;
    expect(t).toBe(MSG.REGISTER);
  });
  it('LeaseState 是字面量联合而非 string', () => {
    const s: 'running' = LEASE_STATE.RUNNING;
    expect(s).toBe(LEASE_STATE.RUNNING);
  });
});
```

**GREEN 阶段 — 实现最小可过**：将本蓝图第 5 节「接口定义」中的 `protocol.ts` 代码原样写入 `sillyhub-daemon/src/protocol.ts`，运行 `pnpm test tests/protocol.contract.test.ts` 全绿。

**REFACTOR 阶段**：本文件为纯常量，无重构空间；仅检查 `as const` / 字面量类型推导是否如预期（`MsgType` 鼠标悬停应显示 `'daemon:task_available' | 'daemon:heartbeat' | ...` 联合，而非 `string`）。

## 验收标准

| ID | 验收项 | 验证方法 | 通过标准 |
|----|--------|----------|----------|
| AC-01 | protocol.ts 常量与 backend protocol.py 逐字一致 | Read `backend/app/modules/daemon/protocol.py` 提取 8 个 `DAEMON_MSG_*` 字符串值，与 `protocol.ts` 的 `MSG.*` 逐字符 diff | 8/8 全等，零差异（含前缀 `daemon:`、下划线、大小写） |
| AC-02 | TypeScript 编译零错误 | 在 `sillyhub-daemon/` 执行 `pnpm tsc --noEmit`（task-01 提供的 tsconfig.json strict 模式） | 退出码 0，无 error / 无 warning |
| AC-03 | 契约单测全绿 | 在 `sillyhub-daemon/` 执行 `pnpm test tests/protocol.contract.test.ts`（vitest） | 4 个 describe block、全部 it 通过，断言数 = 8 MSG + 5 STATE + 1 前缀 + 2 路径 + 2 类型守卫 ≥ 18 条 |
| AC-04 | WS_PATH / REST_PREFIX 正确 | 人工核对 `WS_PATH === '/api/daemon/ws'` 与 daemon.py:160 输出一致；`REST_PREFIX === '/api/daemon'` 与 backend router.py:44 + main.py:237 挂载结果一致 | 两项均通过 |
| AC-05 | 不含运行时逻辑 | `grep -E 'function|class|console\.|import\s' sillyhub-daemon/src/protocol.ts` | 无任何匹配（仅 `export const` / `export type` / 注释） |
| AC-06 | `as const` 字面量类型生效 | IDE 鼠标悬停 `MsgType` 显示字面量联合而非 `string` | 类型显示为 `'daemon:task_available' \| 'daemon:heartbeat' \| ...` |
