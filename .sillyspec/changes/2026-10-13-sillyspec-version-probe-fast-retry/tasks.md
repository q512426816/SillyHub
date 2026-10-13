---
author: flow-machine-draft
created_at: 2026-10-13T15:01:33.214Z
---
# 任务注册表（Tasks）— 2026-10-13-sillyspec-version-probe-fast-retry

- [x] task-01: SillySpecManager 实现：常量 SILLYSPEC_VERSION_RETRY_MS=120_000 + deps.versionRetryMs 注入口 + _versionLastAttemptAt 字段（probeLocal 入口统一记账）+ retryProbeLocalIfUnknown()（已知 no-op/窗口内跳过/窗口外重探/try-catch 收敛）；验证：tsc --noEmit 通过
- [x] task-02: manager 单测（tests/sillyspec-manager.test.ts 新 describe，makeHarness 增 versionRetryMs 注入）：版本未知+窗口过→探测并刷新快照 / 版本已知→no-op / 窗口内→跳过 / 失败→窗口重计时（多次调用仅一次探测）；验证：vitest run tests/sillyspec-manager.test.ts 新用例全绿
- [x] task-03: daemon 接线（daemon.ts _sendHeartbeatOnce）：getSnapshot 组装前 duck-type 守卫（typeof 对齐 getCommandResult 惯例）+ void fire-and-forget 触发；验证：tsc --noEmit 通过
- [x] task-04: daemon 心跳测试（tests/daemon-heartbeat-sillyspec.test.ts）：FakeManager 增可编程 retryProbeLocalIfUnknown + 两用例（心跳触达且不阻塞 / 旧假 manager 缺方法不崩旧语义组包）；验证：vitest run tests/daemon-heartbeat-sillyspec.test.ts 全绿
- [ ] task-05: 汇总验证：vitest run tests/sillyspec-manager.test.ts tests/daemon-heartbeat-sillyspec.test.ts 全量（新+旧用例）+ pnpm typecheck 双绿零回归
