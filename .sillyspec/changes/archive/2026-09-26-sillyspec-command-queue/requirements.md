---
author: flow-machine-draft
created_at: 2026-09-26T13:50:07.075Z
---
# 需求规格（Requirements）— 2026-09-26-sillyspec-command-queue

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可；机器摘录碎片已按语义重组为 4 条） -->
### FR-01: 平台命令并发到达改 FIFO 排队串行执行（不再忙拒）
Given daemon 已接线 sillyspec 命令执行器且无升级链在跑
When SILLYSPEC_RESOLVE / SILLYSPEC_GHOST_CLEANUP 消息并发到达（前一条尚未完成）
Then 后到命令不记 failed 不丢执行——排队待前一条完成（含执行失败/防御 reject 出口）后依序执行，结果仍逐条写结果槽

### FR-02: npm 升级链在跑时到达的命令排队等待升级结束再执行
Given executor.isUpgradeInFlight() 为 true（升级链 running/deferred）
When 平台命令到达
Then 不再记 failed busy（原固定文案 SILLYSPEC_COMMAND_BUSY_ERROR 忙拒路径删除）——轮询等待升级链结束后依序执行

### FR-03: 命令完成落槽后心跳补发语义保持
Given 命令经队列执行完成（成功或失败）
When 结果写入 _lastCommandResult 结果槽
Then 仍立即补发一次心跳（ql-20260911-024 回显提速语义不变）；排队本身不产生心跳/结果

### FR-04: 测试面更新——忙拒断言移除 + 排队/等待升级新用例
Given daemon 源码与测试基线
When 忙拒常量与忙拒断言清理完成后
Then sillyspec-platform-command.test.ts 新增「并发排队依序执行」与「升级链等待后执行」两类用例，聚焦套件全绿 + tsc 0（不跑全量，全量留 CI）

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/sillyspec-platform-command.test.ts「guard 排队：并发到达不忙拒，FIFO 依序执行 > 命令 in-flight（前一条挂起）→ 第二条排队不执行不记结果；放行后依序执行（c1 先 c2 后）」与「ghost_cleanup 排队：前一条挂起期间第二条到达 → 排队，放行后两步依序执行」

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/sillyspec-platform-command.test.ts「isUpgradeInFlight()=true（npm 升级链在跑）→ 排队轮询等待：升级结束前不执行不记结果，结束后依序执行」与「升级链等待同样适用于 ghost_cleanup（共用判定跨命令种类）」

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/sillyspec-platform-command.test.ts「排队命令逐条完成逐条补发：首条完成先报（携 c1 结果），次条出队执行完再报（携 c2 结果，共两次）」

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/sillyspec-platform-command.test.ts 聚焦全量 41 passed + cd sillyhub-daemon && pnpm typecheck（tsc 0）
