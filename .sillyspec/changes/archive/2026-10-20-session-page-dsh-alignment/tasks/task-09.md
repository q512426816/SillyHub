---
id: task-09
title: '1b daemon: per-turn workspace snapshot with perf budget, degrade paths and telemetry'
title_zh: '1b daemon：每轮工作区快照采集（性能红线 / 降级 / 遥测）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P0
depends_on: []
blocks: [task-10]
requirement_ids: [FR-13, FR-15, FR-16]
decision_ids: [D-023@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/turn-file-changes.ts
  - sillyhub-daemon/src/interactive/turn-file-changes-types.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/tests/interactive/
target_files:
  - NEW:sillyhub-daemon/src/interactive/turn-file-changes.ts
  - NEW:sillyhub-daemon/src/interactive/turn-file-changes-types.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - NEW:sillyhub-daemon/tests/interactive/turn-file-changes.test.ts
goal: >
  让 daemon 在每轮结束时报出「这轮工作区改了哪些文件」：轮首记 HEAD 基线，轮尾跑 ≤3 条 git 子进程产出
  `TurnFileChangesSnapshot`（逐文件 +/−、status、attribution、source、partial 降级），并把「可能含并行会话改动」
  恒定标注。本卡是 1b 数据链路的唯一入口；性能红线是验收项，不是建议。
implementation:
  - '首步跑 spike-01：在本仓真实语料工作区跑一次采集，量 collectMs p50/p95 与子进程数；若超 3 条或 p50 > 300ms，按 plan「Spike 前置验证」退一档（只跑 status，+/− 显示破折号，超时降到 800ms）并改写本卡 acceptance'
  - 'NEW:sillyhub-daemon/src/interactive/turn-file-changes-types.ts：`TurnFileChange` / `TurnFileChangesSnapshot` / `FileChangesCapability` 类型，字段名逐字对齐 design「接口定义」（path / status / added / deleted / binary? / attribution / editToolNames? / source?；runId / baselineHead / collectedAt / collectMs / status / reason? / truncated? / files / concurrentSessionsHint: true）'
  - 'NEW:sillyhub-daemon/src/interactive/turn-file-changes.ts：纯采集函数 `collectTurnFileChanges(input)`（input：runId、workspaceRoot、baselineHead、toolCallPaths、limits）——①`git rev-parse HEAD` 基线（轮首 E1，由调用方在 inject 时记录）②`git status --porcelain -z --untracked-files=normal`（一次）③`git diff --numstat <baselineHead>`（一次）→ 合计 3 条；git 调用一律 `--no-optional-locks` + 环境 `-c core.preloadIndex=true`；禁 rename 检测（`--no-renames`），porcelain 里的 `R` 条目必须归一成 delete + add 两条'
  - '归因：`attribution="edit_patch"` 仅当同一文件命中本轮 Edit/Write 的 `edit_patch.path`（`editToolNames[]` 记来源工具），其余 `"command"`；ignored 目录（gitignore 命中）按「本轮工具调用路径前缀 + mtime」探测，命中项 `source="mtime"`；二进制 → `added=0/deleted=0 + binary=true`'
  - '降级：`Promise.race` 1500ms 硬超时 + 子进程 kill → `status="partial"`、`reason="timeout"`；非 git 仓 / git 缺失 → `status="unavailable"` + `reason="not_a_repo"|"git_missing"`；改动数超上限（如 500）→ `truncated=true` + `status="partial"`；单工作区串行队列（`Map<workspaceRoot, Promise>`）队列长度超 1 排队、超上限 → `status="partial"` + `reason="queue_overflow"`；**partial 不是错误态**'
  - '遥测：快照自带 collectMs / 子进程数 / truncated，另打一行结构化日志 `turn_file_changes_collected`（runId、collectMs、fileCount、subprocessCount、status、reason）；模块内滑窗统计 p50/p95 与降级率供 task-13 的验收读取（不引外部依赖）'
  - '接线（sillyhub-daemon/src/interactive/session-manager.ts）：轮首在 `inject`（:1266）成功后记录 baselineHead 与本轮 toolCallPaths 累加器（复用 `_registerAgentToolUseMeta` :1586 的同一路，不改事件协议）；轮尾在 `_onResult`（:1567）`await onResult(...)` **之后** fire-and-forget 调采集（`void collect(...).then(report)`），禁阻塞终态与 SSE；按 runId 覆盖上报'
  - '测试 NEW:sillyhub-daemon/tests/interactive/turn-file-changes.test.ts：六类夹具（有改动 / 无改动 / 非 git 仓 / untracked / binary / ignored-by-mtime）+ 超时 partial（假 git 睡 2s）+ 串行队列不并发（并发标记恒 1）+ 子进程计数 ≤3（mock execFile 计数）+ rename 归一成 delete+add'
acceptance:
  - '六类夹具 + 超时 + 串行 + 子进程计数 + rename 归一，全部单测绿'
  - '单轮 git 子进程数 ≤3（测试断言 mock 调用次数）；`--no-optional-locks` 与 `core.preloadIndex` 出现在调用参数里（测试断言）'
  - '超时分支返回 `status="partial"` 且 `reason="timeout"`，且轮终态不受影响（断言 `_onResult` 不 await 采集）'
  - '非 git 仓返回 `status="unavailable"` + `reason="not_a_repo"`，不抛错、不写「无改动」之类伪值'
  - 'p50 / p95 / 降级率 / 单轮子进程数实测值写回 tasks.md 本任务证据行（spike-01 的实测数字在此留档；p50 > 300ms 或降级率 > 5% 必须显式登记为风险）'
verify:
  - cd sillyhub-daemon && node node_modules/vitest/vitest.mjs run tests/interactive/turn-file-changes.test.ts
  - cd sillyhub-daemon && node node_modules/typescript/bin/tsc --noEmit
constraints:
  - 每轮 git 子进程 ≤3；禁全仓扫描、禁 rename 检测、禁 `git status` 之外的重型命令
  - 采集必须在轮终态落库之后异步执行（E2），禁阻塞轮结束与 SSE 终态
  - 不碰 turn-anchor.ts（另一套轮锚 JSONL 机制）；不改 agent_run_logs 与 edit_patch 表
  - 共享工作区不引每会话 worktree（D-023 范围外），只标 concurrentSessionsHint
  - Windows/Linux/macOS 兼容：路径用 node:path，禁 shell 专用命令，git 调用走 execFile 参数数组
related_tests: []
---
