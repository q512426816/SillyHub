---
id: task-06
title: W1 测试——cause 透传 / handler 不退进程 / _fire 自愈 / 断连计数
priority: P0
wave: W1
depends_on: [task-01, task-02, task-03, task-04, task-05]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/__tests__/w1-resilience.test.ts
  - sillyhub-daemon/tests/w1-resilience.test.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-06: W1 测试

> 来源：design.md §5 Phase1；plan.md Wave1 task-06。汇总 W1（task-01~05）的集成测试。
> 本质：vitest 集成测试，覆盖 cause 透传断言、handler 不退进程、_fire 自愈、断连计数。与各 task 内的单元测试互补，本 task 做端到端场景串联。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/tests/w1-resilience.test.ts` | W1 集成测试（位置参照现有 tests/ 目录约定） |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-01 | cause 透传 | 场景：网络错误日志含 code |
| FR-02 | 进程保活 | 场景：handler 不退 + _fire 自愈 |
| FR-03 | 断连计数 | 场景：超阈值 FATAL |

## 实现要求

1. **定位测试目录**：先查 `sillyhub-daemon/tests/` 与 `sillyhub-daemon/src/__tests__/` 哪个是现有约定（参考 hub-client.test.ts / daemon-interactive-bridge.test.ts 位置），放同处保持一致。
2. **mock 工具**：mock `fetch`（undici）抛 TypeError({cause:{code}}) / TimeoutError；spy `_logger.warn/error`；spy `process.exit`（断言不被调用）；vitest fake timers 推进退避/断连阈值。
3. **测试用例**：
   - T1 cause 透传：mock fetch reject TypeError cause code=ECONNREFUSED → 触发 onTurnMessage/heartbeat → 断言 warn 含 cause.code。
   - T2 handler 不退：emit process unhandledRejection → 断言 process.exit 未调用 + stderr 含 FATAL。
   - T3 _fire 自愈：构造 _fire(loop)，loop 抛 Error → fake timer 跳 5s → 断言 loop 被再调用（restart count++）。
   - T4 _fire AbortError 不重启：loop 抛 AbortError → 不再调用。
   - T5 stop 不重启：_running=false + loop 崩 → 不 _fire。
   - T6 断连计数：mock heartbeat 连续失败，fake timer 推 30s+ → 断言 daemon_disconnect_degraded 记 1 次；推进 60s 仍 1 次（无风暴）；mock 成功 → 清零后再失败可再告警。
4. **不依赖 backend**：纯 daemon 侧测试，mock HubClient。

## 接口定义

测试组织（vitest）：
```ts
describe('W1 daemon resilience', () => {
  // T1..T6 用 vi.useFakeTimers + vi.spyOn(logger/process.exit) + mock fetch/client
});
```

## 边界处理

1. **进程未退断言**：spy `process.exit`，断言未被调用（vitest 下 process.exit 默认不真退，spy 即可）。
2. **mock 时序**：fake timers 控制 _fire 退避 5s 与断连 30s，避免真实等待。
3. **_fire 重启 await**：_fire 重启是 async，测试需 await + flush microtasks/timers。
4. **日志风暴断言**：T6 推进 60s 断言 FATAL 仍 1 次。
5. **多 rid 独立**：T6 可扩展两 rid 一断一连验证独立计数。
6. **回归**：不影响现有 daemon-interactive-bridge.test.ts 等。

## 非目标

- 不测 W2/W3（重试/暂存/幂等，各 Wave 自带测试）。
- 不连真实 backend。
- 不测 cli startAction 全流程（单测已有）。

## 参考

- sillyhub-daemon/tests/ 现有测试 mock 模式
- task-01~05 蓝图
- design.md §5 Phase1

## TDD 步骤

1. 写 T1-T6 测试。
2. 确认失败（task-01~05 未实现时；本 task 在 task-01~05 完成后执行应为绿，若红回查各 task）。
3. 必要时补 mock/fixture。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归全套。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 测试文件存在 | w1-resilience.test.ts 非空 |
| AC-02 | T1-T6 全绿 | `cd sillyhub-daemon && pnpm test w1-resilience` 通过 |
| AC-03 | 覆盖 FR-01/02/03 | 测试含 cause/handler/_fire/断连场景 |
| AC-04 | 全套测试绿 | `cd sillyhub-daemon && pnpm test` 通过 |
| AC-05 | typecheck | `pnpm typecheck` 通过 |
