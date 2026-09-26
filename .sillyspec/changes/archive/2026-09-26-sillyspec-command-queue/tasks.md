---
author: flow-machine-draft
created_at: 2026-09-26T13:50:07.076Z
---
# 任务注册表（Tasks）— 2026-09-26-sillyspec-command-queue

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: daemon.ts 队列化改造——`_runSillySpecCommand` 两臂忙拒改 FIFO promise 链尾（`_sillyspecCommandQueueTail` 置换 `_sillyspecCommandInFlight`；升级臂改出队时轮询等待 `SILLYSPEC_COMMAND_UPGRADE_POLL_MS`，定时器 unref 对齐 deferred 重查惯例）；删 `SILLYSPEC_COMMAND_BUSY_ERROR` 常量；`_nudgeHeartbeatAfterCommandResult` 去 busy 相位收敛单参；相关 doc 注释同步（executor 接口 isUpgradeInFlight 注释、case 分发注释）
- [x] task-02: 测试改造——sillyspec-platform-command.test.ts 忙拒 describe 块（4 用例 + nudge 忙拒用例）改写排队语义：并发到达排队依序执行 / 升级链等待后执行（resolve+ghost 两式，fake timers 推进轮询）/ nudge 改各条完成各补发（双 gate 锁执行序防结果槽竞态）；模块头注释行为矩阵同步
- [x] task-03: 聚焦验证 + 显式 pathspec 提交——sillyspec-platform-command 套件 41 绿 + 近邻 daemon-heartbeat-sillyspec/sillyspec-conflict-snapshot 51 绿 + daemon tsc 0（不跑全量），git add -- 显式文件提交（commit 正文含 task-NN）
- [x] task-04: 模块文档追加记录——.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md 变更索引置顶追加本变更条目（忙拒→排队语义更替，注明推翻 D-001 拒排队裁决的生产实证）
