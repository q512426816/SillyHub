---
author: zcode-agent
created_at: 2026-10-22T11:17:23.094Z
---
# 设计记录（Design Record）— 2026-10-22-file-changes-card-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

daemon 采集器（`sillyhub-daemon/src/interactive/turn-file-changes.ts`）把「文件清单真相源」从 `git status` 单源改为 **status ∪ `git diff --name-status <baselineHead>`**：status 覆盖未提交/未跟踪，baseline→工作区的 name-status 覆盖轮内已提交改动；行数统一取 `git diff --numstat <baselineHead>`。采集过程改为分阶段记录（status / name-status / numstat），任一 diff 阶段超时只降级行数或状态精度，不再丢弃已完成清单。预算按工作区分层：默认 1500ms，`/mnt/` 挂载 ≥8000ms，超时后进程内自动升级到 15000ms 封顶，并支持 `SILLYHUB_FILE_CHANGES_TIMEOUT_MS` 覆盖。前端把 DTO 的 `status` 带进视图模型，渲染状态徽标；未跟踪/mtime 行不再显示 +0 −0；删除行不可点击；「改N次」改为编辑调用次数（daemon 侧不再按工具名去重）；notice 按 reason+collectMs 生成文案，并在 notice 态渲染共享工作区提示。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- HTTP / DB / OpenAPI：**无变更**。`TurnFileChange` 已有 `status` / `source` 字段，`TurnFileChangesSnapshot` 已有 `reason` / `collectMs`，后端镜像与读模型无需改动。
- daemon wire 语义变化：`TurnFileChange.editToolNames` 由「去重工具名集合」改为「每次编辑调用的工具名序列（允许重复）」——数组长度=编辑调用次数；前端展示时去重。字段名与类型不变。
- daemon 采集子进程：baseline 已知时 `status + diff --name-status + diff --numstat` 恰 3 条（原为 2 条，仍在 design ≤3 红线内）；baseline 未解析的兜底路径为 `rev-parse` + 3 条 = 4 条（原为 3 条，属复杂 worktree 的罕见兜底，设计登记为例外）。
- 环境变量：新增可选 `SILLYHUB_FILE_CHANGES_TIMEOUT_MS`（正整数毫秒，覆盖基础预算；非法值忽略）。
- 内部导出：新增/导出 `resolveTurnFileChangesLimits(workspaceRoot, limits)` 与自适应预算记录（供测试与遥测读取），`resetTurnFileChangesTelemetry()` 同时清空自适应表。
- `includeLineCounts=false` 退档语义保持：只跑 status，不跑两条 diff，`partial` 无 reason（既有测试零回归）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不涉及事件时序。status 与两条 diff 使用同一个 baseline 快照，合并时以 path 为键、status 优先、name-status 次之、numstat 只补行数；`-z` 解析对含空格/中文/换行的路径稳定。mtime 探测仍以轮首时间为下界，与 git 面互不覆盖（seen 去重）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

采集仍走单工作区串行队列（深度 1）；并发会话同时收尾时后到者依旧 `partial/queue_overflow`（语义不变）。自适应预算表是进程内 `Map`，Node 单线程无竞态；同一工作区多轮并发排队不会并行跑 git。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

采集是轮尾 fire-and-forget，不阻塞轮终态；任一阶段失败都收口成快照、不抛穿。baseline 提交被 rebase/GC 导致 diff 失败时，保留 status 清单并降级 `partial`（行数破折号），不伪造 ok。daemon 重启后自适应预算归零，回到默认/慢盘基线。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

采集按 `workspaceRoot` 独立；自适应表以 queueKey（工作区绝对路径）为键，不跨工作区复用。文件路径统一转仓根相对 posix，仓外路径不入清单；环境变量是进程级覆盖，不影响其他工作区的数据语义。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：慢盘上从 2 条 git 命令增至 3 条，首轮仍可能超时；但 `/mnt/` 基础预算提升 + 超时后自动升级 + 超时保留清单，使「超时后整卡空白」不再发生。另一个风险是「本轮改动」口径扩大：轮内 commit 的文件现在会出现，卡片数字可能比以前大——这是修复目标（以前漏报），需在发布说明中明确。
放弃方案 A：只调大 timeout——不解决轮内 commit 漏报与 numstat 超时丢清单。
放弃方案 B：只用 `git diff --name-status` 不跑 numstat——行数全变破折号，信息退化。
放弃方案 C：忽略文件读到真实行数——`/mnt/e` 上读文件比 git 更慢，且 untracked 可能很大；保持诚实破折号。
放弃方案 D：给卡片加「重新采集」按钮——需要新增 daemon RPC 与平台端点，超出本次修复面，留作后续。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/interactive/turn-file-changes.ts | status∪name-status 合并、分阶段降级、慢盘自适应预算、编辑调用计数 |
| 修改 | sillyhub-daemon/src/interactive/turn-file-changes-types.ts | `editToolNames` 语义注释（长度=编辑次数） |
| 修改 | sillyhub-daemon/tests/interactive/turn-file-changes.test.ts | commit 入列/partial 保留/自适应/编辑计数/既有预算断言更新 |
| 修改 | frontend/src/components/daemon/file-changes/turn-file-changes.ts | 视图模型补 status/hasLineStats、notice 按 reason、编辑次数 |
| 修改 | frontend/src/components/daemon/file-changes/file-changes-card.tsx | 状态徽标、删除行不可点、未跟踪破折号、notice 共享提示、头部文案 |
| 修改 | frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts | 视图模型/notice 用例 |
| 修改 | frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx | 徽标/不可点/破折号/notice 提示用例 |
| 修改 | .sillyspec/docs/sillyhub-daemon/modules/interactive.md | 采集口径与预算自适应说明 |
| 修改 | .sillyspec/docs/frontend/modules/components-daemon.md | 文件变更卡状态/提示/交互说明 |
