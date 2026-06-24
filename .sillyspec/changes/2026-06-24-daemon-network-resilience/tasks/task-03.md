---
id: task-03
title: cli.ts handler 强化（结构化 FATAL + 绝不 process.exit）
priority: P0
wave: W1
depends_on: []
blocks: [task-06]
requirement_ids: [FR-02]
decision_ids: [D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/cli.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-03: cli.ts handler 强化（绝不退进程）

> 来源：design.md §5 Phase1（handler 强化）/ §10 R-06；plan.md Wave1 task-03。
> 本质：cli.ts:713-720 的 unhandledRejection/uncaughtException handler 当前只 `process.stderr.write`。Node 默认 `--unhandled-rejections=throw` 会让 daemon 静默 exit 1。改为结构化 FATAL 日志（含 cause+stack）+ **绝不 process.exit**（吞事件保活但完整记录）。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/cli.ts` | 713-720 两个 handler 强化 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-02 | 进程不退出 | handler 吞事件不退进程 |
| D-006@v1 | 断连不主动 degraded（保活优先） | 网络相关 rejection 不退进程 |

## 实现要求

1. **读现有 handler（710-720）**：当前两个 handler 仅 `process.stderr.write`，process.exit(1) 来自 Node 默认 unhandled rejection 行为（非显式调用）。需显式"吞掉"事件——handler 内 try/catch 自身、不 rethrow、不 process.exit。
2. **结构化 FATAL 日志**：handler 内构造结构化记录写到 stderr（JSON 或人类可读多行），含 `kind`（unhandledRejection/uncaughtException）、`message`、`stack`、`cause`（若有）。
3. **绝不退进程**：handler 体末尾不调用 process.exit。仅记日志。
4. **handler 自身容错**：handler 内所有写日志语句包 try/catch，handler 自身抛错时 fallback `process.stderr.write` 原始字符串，绝不让 handler 抛出（否则进程仍可能崩）。
5. **不拦截正常退出**：SIGINT/SIGTERM 走 2425 行 `process.exit(130)`，不受本 handler 影响（handler 只兜未捕获 rejection/exception，不拦信号）。

## 接口定义

```ts
// cli.ts 替换 713-720
function logFatal(kind: string, payload: unknown): void {
  try {
    const err = payload instanceof Error ? payload : new Error(String(payload));
    process.stderr.write(
      `[FATAL ${kind}] ${err.message}\n` +
      (err.stack ? `${err.stack}\n` : '') +
      ((err as Error & { cause?: unknown }).cause
        ? `cause: ${JSON.stringify((err as Error & { cause?: unknown }).cause)}\n`
        : '') +
      `daemon 保活：已吞未捕获 ${kind}，进程不退出。\n`,
    );
  } catch {
    try { process.stderr.write(`[FATAL ${kind}] ${String(payload)}\n`); } catch { /* noop */ }
  }
}

process.on('unhandledRejection', (reason) => { logFatal('unhandledRejection', reason); });
process.on('uncaughtException', (err) => { logFatal('uncaughtException', err); });
```

控制流：未捕获 rejection/exception → handler → logFatal（容错）→ 返回（进程继续）。不 process.exit。

## 边界处理

1. **payload 非 Error**（reject 了个字符串/对象）：`String(payload)` 兜底，handler 不抛。
2. **handler 自身 stderr.write 抛**（极罕见，如 stderr 关闭）：内层 try/catch 吞掉，noop。
3. **真 bug 被吞风险（R-06）**：缓解=结构化 FATAL 保留 message+stack+cause，运维可 grep `[FATAL ` 定位；不静默。
4. **进程主动退出不受影响**：SIGINT→2425 exit(130) 不经本 handler；daemon.stop() 正常路径不触发 unhandledRejection。
5. **OOM/栈溢出不可恢复**：这类 Node 直接 abort 本 task 无法兜底（操作系统级），属可接受边界，记入剩余风险。
6. **日志通道未就绪**：daemon 构造前 handler 已注册（713 在 main() 前），此时 _logger 可能不可用 → 直接用 stderr（不依赖 _logger），保证早期 rejection 也能记录。

## 非目标

- 不拦 SIGINT/SIGTERM（2425 行不变）。
- 不实现循环自愈（task-04 _fire）。
- 不重启崩掉的业务循环（task-04）。
- 不改 main() 流程。
- 不写文件日志（stderr 足够；落盘日志通道修复属运维范畴）。

## 参考

- cli.ts:705-721（现有 handler + 注释自承静默 exit）
- cli.ts:2425（SIGINT→process.exit(130)）
- design.md §5 Phase1 / §10 R-06

## TDD 步骤

1. 写测试：spy process.exit + process.stderr.write，emit unhandledRejection → 断言 process.exit 未被调用 + stderr 含 `[FATAL unhandledRejection]`。
2. 确认失败（当前 handler 仍让 Node 默认 exit）。
3. 实现强化 handler。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归：cli 现有测试（startAction/stopAction）全绿。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | handler 不调用 process.exit | grep "process.exit" cli.ts handler 区间无新增（SIGINT 2425 保留） |
| AC-02 | 结构化 FATAL | handler 写 `[FATAL <kind>]` + message + stack |
| AC-03 | unhandledRejection 不退进程 | 测试 emit rejection → process.exit spy 未调用 |
| AC-04 | uncaughtException 不退进程 | 测试 emit exception → process.exit spy 未调用 |
| AC-05 | handler 自身容错 | mock stderr.write 抛 → handler 不抛 |
| AC-06 | SIGINT 仍退出 | process.on('SIGINT') 路径不变，exit(130) 保留 |
| AC-07 | 现有测试全绿 | `cd sillyhub-daemon && pnpm test` 通过 |
