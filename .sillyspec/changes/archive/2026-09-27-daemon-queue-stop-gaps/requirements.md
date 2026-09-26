---
author: flow-machine-draft
created_at: 2026-09-26T23:16:33.960Z
---
# 需求规格（Requirements）— 2026-09-27-daemon-queue-stop-gaps

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 排队命令等待升级链有总预算上限（5 分钟），超预算后当前命令记 failed 结果槽（含可重试提示的
Given 上限 相关模块就绪
When 排队命令等待升级链有总预算上限（5 分钟），超预算后当前命令记 failed 结果槽（含可重试提示的错误文案）并放行队列后续命令，不再永久排队
Then 行为符合本条标准描述

### FR-02: 升级链在预算内结束的既有行为不变：命令照常执行、无 failed 槽
Given 系统就绪
When 升级链在预算内结束的既有行为不变：命令照常执行、无 failed 槽
Then 行为符合本条标准描述

### FR-03: daemon 停机（_stopInternal）停止并置空 hits 周期上行器实例，重复停机不炸
Given 系统就绪
When daemon 停机（_stopInternal）停止并置空 hits 周期上行器实例，重复停机不炸
Then 行为符合本条标准描述

### FR-04: 新增测试：超预算记 failed 槽且队列放行（fake timers 推进总预算）、预算内结束照常
Given 测试 / 幂等 相关模块就绪
When 新增测试：超预算记 failed 槽且队列放行（fake timers 推进总预算）、预算内结束照常执行、_stopInternal 清周期器与幂等
Then 行为符合本条标准描述

### FR-05: 既有聚焦测试全绿 + tsc 0 错
Given 测试 相关模块就绪
When 既有聚焦测试全绿 + tsc 0 错
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/sillyspec-platform-command.test.ts「升级链持续在跑超过等待总预算 → 当前命令记 failed 槽（不 exec）并放行队列后续命令」；sillyhub-daemon/tests/sillyspec-platform-command.test.ts「ghost_cleanup 超预算同口径：记 failed 槽（action=ghost_cleanup、无 change/strategy 键）不 exec」

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/sillyspec-platform-command.test.ts「升级链在总预算内结束 → 行为不变：命令照常执行、无 failed 槽（预算边界回归）」；既有「isUpgradeInFlight()=true（npm 升级链在跑）→ 排队轮询等待：升级结束前不执行不记结果，结束后依序执行」回归

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts「停机调用 _hitsPeriodic.stop() 并置空实例（同进程 stop→start 不残留旧 interval）」；同文件「实例为 null（未启动/已清）时停机不炸（幂等重复停机）」

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
FR-01/02/03 所列五个用例即新增面（fake timers 推进 300s 总预算 / 299s 预算内边界 / _stopInternal 清理与幂等），全部为本变更新增

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/sillyspec-platform-command.test.ts 全套 44 passed；sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts 2 passed；近邻 daemon-selfupdate-orchestrator/daemon-heartbeat-sillyspec/sillyspec-conflict-snapshot 76 passed；knowledge-hits-periodic/knowledge-hits-upload 24 passed；npx tsc --noEmit 0 错
