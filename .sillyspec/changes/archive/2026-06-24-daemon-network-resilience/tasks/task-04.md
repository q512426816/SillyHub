---
id: task-04
title: daemon.ts _fire 循环自愈（非 AbortError 异常带退避重启）
priority: P0
wave: W1
depends_on: []
blocks: [task-06]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-04: daemon.ts _fire 循环自愈

> 来源：design.md §5 Phase1（循环自愈）/ §10 R-05；plan.md Wave1 task-04。
> 本质：`_fire`（daemon.ts:1421-1436）的 `.catch` 当前非 AbortError 只记 `loop_crashed` 不重启，三循环（heartbeat/poll/ws 驱动）崩了就永久死。改为：非 AbortError 异常结束时带退避重新 `_fire` 同一 loop。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/daemon.ts` | _fire 改造为可自愈重启 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-02 | 三循环异常退出能自愈重启 | _fire 非 AbortError 后带退避重启 |

## 实现要求

1. **读 _fire（1421-1436）**：当前 `loop(signal).catch(AbortError→return; else→log).finally(删 controller/promise)`。改：else 分支后，若 `this._running` 仍为 true，带退避重新 `this._fire(loop)`。
2. **退避防风暴**：重启前 sleep 固定退避（如 5s，复用 abortableSleep）+ 可配；重启不无限立即重试。
3. **stop() 不再重启**：重启前检查 `this._running`，false 时不再 _fire（正常停止）。
4. **AbortError 不重启**：AbortError 是正常停止信号（stop 触发 AbortController.abort），不重启。
5. **AbortController 重新创建**：每次 _fire 内部 new AbortController（现有逻辑），重启即重新进入 _fire 自然重建。
6. **集合清理**：.finally 已删 controller/promise；重启是新 _fire 调用，重新注册，无泄漏。

## 接口定义

```ts
// _fire 改造伪码
private _fire(loop: (signal: AbortSignal) => Promise<void>): void {
  const controller = new AbortController();
  this._controllers.add(controller);
  const p: Promise<void> = loop(controller.signal)
    .catch(async (e: unknown) => {
      if (e instanceof AbortError || (e as Error | undefined)?.name === 'AbortError') return;
      this._logger.error('loop_crashed', { error: e });
      // 自愈：仅当仍在运行时带退避重启
      if (this._running) {
        try {
          await abortableSleep(this._config.loop_restart_backoff_ms ?? 5000, controller.signal);
        } catch { /* abort 期间不重启 */ return; }
        if (this._running) this._fire(loop); // 递归重启
      }
    })
    .finally(() => {
      this._controllers.delete(controller);
      this._loopPromises.delete(p);
    });
  this._loopPromises.add(p);
}
```

控制流：loop 异常 → 非 AbortError → log → 若 _running → sleep 退避 → 仍 _running → _fire(loop) 重启。AbortError/_running=false → 不重启。

## 边界处理

1. **stop() 期间不重启**：`_running=false` 检查双重（sleep 前后），确保 stop 退出后不复活循环。
2. **AbortError 不重启**：正常停止信号。
3. **重启风暴防护**：固定退避 5s（可配 `loop_restart_backoff_ms`）；不立即重试。极端反复崩也最多每 5s 一次，可接受（比永久死好）。
4. **WS 循环的连接归 ws-client**：_fire 重启的是 daemon 侧 loop（如 _heartbeatLoop/_pollLoop），WS 连接生命周期归 WsClient 自身重连（ws-client.ts:460 _scheduleReconnect），_fire 不重复建 WS 连接。若 _fire 驱动的 loop 内部含 WsClient.start，需确认重启不会与 ws-client 重连冲突——读代码确认 _fire 启动的具体 loop（heartbeat/poll）不含 WS 建连，WS 在 daemon.start 另起。
5. **集合生命周期**：.finally 删除旧 controller/promise，新 _fire 重新 add，无累积泄漏。
6. **递归深度**：_fire 递归调用，但每次间隔 5s sleep 且串行（同一 loop 不会并发多个实例，因 .catch 串行），栈不累积（await 后回调非同步递归深度增长）。
7. **参数不可变**：loop 函数引用不变，重启传同一引用。

## 非目标

- 不改 ws-client 的重连逻辑（5s 固定，ws-client.ts:460）。
- 不实现指数退避（固定退避足够，YAGNI）。
- 不改 _heartbeatLoop/_pollLoop 内部逻辑（task-05 改 heartbeat 断连计数）。
- 不改 abortableSleep。

## 参考

- daemon.ts:1415-1436（_fire + 注释）
- daemon.ts:1440（_heartbeatLoop）/ 1462（_pollLoop）
- ws-client.ts:460（_scheduleReconnect，WS 自身重连独立）
- design.md §5 Phase1 / §10 R-05

## TDD 步骤

1. 写测试：构造 _fire(loop)，loop 抛非 AbortError → 断言 _fire 被再次调用（重启）+ 进程不退 + loop_crashed 日志；用 vitest fake timers 跳过 5s 退避。另测 stop() 后 loop 崩不重启；AbortError 不重启。
2. 确认失败（当前不重启）。
3. 实现自愈 _fire。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归现有 daemon 测试。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 非 AbortError 后重启 | 测试 loop 抛 Error → fake timer 跳 5s → loop 被再次调用 |
| AC-02 | AbortError 不重启 | 测试 loop 抛 AbortError → 不再调用 |
| AC-03 | stop 后不重启 | _running=false + loop 崩 → 不 _fire |
| AC-04 | loop_crashed 日志 | 重启前记 loop_crashed |
| AC-05 | 无并发多实例 | 同一 loop 重启前旧 promise 已 finally 清理 |
| AC-06 | 退避可配 | loop_restart_backoff_ms 默认 5000，config 可覆盖 |
| AC-07 | 现有测试全绿 | `cd sillyhub-daemon && pnpm test` 通过 |
