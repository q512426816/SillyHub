---
author: qinyi
created_at: 2026-10-21 14:47:00
plan_level: full
execution_mode: dispatch  # 跨三仓（daemon/backend/frontend）+ 单任务规模大（新模块/迁移/卡片链路各 >30min）+ 单会话必然撞压缩线；W3/W4 真可并行。共享文件（session-manager.ts）的手工分 Wave 串行见 W4/W5
change: 2026-10-20-session-page-dsh-alignment
---

# 实现计划（Plan）— 2026-10-20-session-page-dsh-alignment

## Spike 前置验证

两条技术不确定性都不是「要新栈」，但都缺实测口径，故把探测压进对应任务的第一步（不单开进度卡）：

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01（并入 task-09 首步） | 在本仓真实语料（21 runs / 1271 logs，`.proto-staging/session-export.json`）所在工作区跑一次采集，量 `collectMs` p50/p95、单轮 git 子进程数、`--porcelain -z` 输出规模 | 子进程超 3 或 p50 > 300ms → 采集口径退一档：只跑 `status --porcelain -z`（放弃 `diff --numstat`，+/− 显示破折号），并把 1500ms 超时降到 800ms；task-09 的 acceptance 按新口径改写 |
| spike-02（并入 task-10 首步） | 用真实 claude/codex 驱动事件流验证能否稳定切出「模型请求起点 → 首个 delta → 请求终点」；无起点信号时能否用「轮首/工具结果后 → 首个 text/thinking delta」近似 | 无稳定起点 → task-10 降级为「只采 TTFT（首 token 延迟）+ 每次 attempt 的终点与 model」，不承诺 attempt 起点区间；前端模型条仍走真实占用近似并标注口径 |
| spike-03（并入 task-08 首步） | 侧表 + `file_changes` JSON 列的迁移在 aiosqlite/pytest 夹具与 PG 上都能 upgrade/downgrade 一遍 | 迁移不可行 → 承载面退到 `DaemonTaskLease.metadata_` 旁路键（不改 schema；capability 仍由读模型计算），task-08 的 acceptance 改为「metadata 键幂等 upsert」 |

## Wave 1

> 同一层并行：9 张卡之间无 depends_on 边、Wave 内文件面两两无交集。**task-01…task-04 是已完成登记卡（tasks.md 已勾 `[x]`），不执行**；task-05 / 06 / 07 为收口清理（单文件 / 文档 / 截图）；task-08 = 1b backend 承载；task-09 = 1b daemon 采集。
> 并行说明：task-08（backend 文件）与 task-09（daemon 文件）跨仓正交，**可真并行**；task-09 与 task-10 虽然文件不同层可排，但两者改同一文件 `sillyhub-daemon/src/interactive/session-manager.ts` 的轮终态接线区，**必须串行**，故 task-10 落到 Wave 2。
> 接受并批护栏提示：Wave 1 的四张登记卡不执行，其余卡各自独占文件面，单卡派发与并批收益相同，故不并批（`batch_orthogonal_unbundled` 提示已知并接受）。

- task-01
- task-02
- task-03
- task-04
- task-05
- task-06
- task-07
- task-08
- task-09

## Wave 2

> 依赖：task-10 ← task-09（**同文件串行**：`sillyhub-daemon/src/interactive/session-manager.ts` 的轮终态接线区，两卡并排会互相覆盖）；task-11 ← task-08 的读模型字段（fileChanges / fileChangesCapability）。
> 并行说明：task-10（daemon）与 task-11（frontend）文件面正交，可并批 `> batch: task-10+task-11`；与 Wave 1 无同文件交集。

- task-10
- task-11

## Wave 3

> 依赖：task-12 ← task-08 + task-10（timing 字段）；task-13 ← task-09 + task-10（两个 daemon 能力合并进一次发版）。
> 并行说明：task-12（`trajectory/` 前端文件）与 task-13（daemon `package.json` + 发版产物）文件面正交，可并批 `> batch: task-12+task-13`。

- task-12
- task-13

## Wave 4

> 依赖：task-14 ← task-08（读模型）+ task-11（卡片形态）+ task-12（泳道口径）——文档必须晚于实现，否则写的是「计划中」。
> 并行说明：单卡成波，无同波并行对象；顺序不可与 Wave 5 颠倒（文档要引用已发版实现，回归要在文档定稿后跑）。

- task-14

## Wave 5

> 依赖：task-15 ← task-11…task-14（全量回归与 R-12 清理必须跑在发版、文档之后）。
> 并行说明：单卡成波。**R-12 的仓根 `.sillyspec/local.yaml` 豁免必须在本 Wave 内移除**，否则 verify 对该测试文件的结论无效。

- task-15

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 视觉层六条 + 过程语义标签（已完成登记） | W1 | P0 | — | FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-20；D-002/003/012/013/015@v2/016/020/021/025 | 已落盘并实测（93 + 8 + 119 + 22 例）；本卡只登记文件面与证据索引 |
| task-02 | 轨迹档 1：泳道时间轴 / 缩放 / 账本 / dev 路由（已完成登记） | W1 | P0 | — | FR-10, FR-11, FR-12；D-022/024/026 | 已落盘（56 例 + 导出稿 618 bar / Δ0.00px） |
| task-03 | 原型管线 + 文件变更卡形态原型（桩数据，已完成登记） | W1 | P0 | — | FR-17, FR-18, FR-19；D-010/014/017/018 | 已落盘（导出脚本机械校验 + 卡片 8 例 + Playwright 1 例）；只证形态，不证数据链路 |
| task-04 | 会话 × 模型用量端点 FR-23（已完成登记） | W1 | P1 | — | FR-23 | 已落盘（`session_insights.py:933-1052`，4 例未复跑 → 由 task-15 复跑） |
| task-05 | R-04：`session-redesign.module.css` 旧参数并存收口 | W1 | P2 | — | 无（R-04） | 删/改 14.5px + 0.55em 规则并留注释；重跑导出脚本保 138 正文块 |
| task-06 | P3 锚点漂移修正 + 1b 接线面补口 | W1 | P2 | — | 无（P3） | `design.md:82` → `turn-timeline.tsx:2129-2133`；`tasks.md` 旧 `:2045-2048` → `:2052-2054`；核对 design 1b 行与真实文件一致 |
| task-07 | R-03：三主题 + 窄屏观感证据 | W1 | P2 | — | FR-09（证据面） | blue/dark + ≤768px 截图留档；对比度人工核对 |
| task-08 | 1b backend：快照承载（侧表/迁移）+ 读模型透传 + capability | W1 | P0 | — | FR-13, FR-14, FR-15, FR-16；D-023 | schema/model/lease service/session_insights + 契约测试；老 daemon 缺字段 → `null` + `tool_only` |
| task-09 | 1b daemon：每轮工作区快照采集（性能红线/降级/遥测） | W1 | P0 | — | FR-13, FR-15, FR-16；D-023 | `turn-file-changes.ts` + types + session-manager 接线 + 六类夹具 + 计时夹具 |
| task-10 | daemon TTFT / attempt 采集 + 版本门控字段 | W2 | P0 | task-09 | FR-11, FR-15；D-025@v1, D-026@v1 | `turn-timing.ts` 纯函数 + session-manager 同接线点；无采样 → 前端保持单色 |
| task-11 | 前端 1b：映射纯函数 + 会话级汇总 + 卡片降级 + 轮级挂载 | W2 | P0 | task-08, task-09 | FR-14, FR-16；D-023②④ | `turn-file-changes.ts` + `file-changes-summary.tsx` + `file-changes-card.tsx` 降级态 + `turn-timeline.tsx` / `session-panel-page.tsx` 透传 |
| task-12 | 前端模型泳道：真实区间消费 + 无采样单色降级 | W3 | P1 | task-08, task-10 | FR-11, FR-15；D-024@v1, D-026@v1 | `build-trajectory.ts` 派生 + `trajectory-timeline.tsx` 标注「近似/真实」；Δ≤2px 与 618 bar 不回归 |
| task-13 | daemon 发版与版本门控验收（显式发布步） | W3 | P0 | task-09, task-10 | FR-13, FR-14, FR-15；D-023@v1；R-06 | 版本号 + CHANGELOG + build + 最小版本常量 + 老 daemon 降级实测 |
| task-14 | 文档同步（模块文档 / 轨迹段 / 原型 dev 路由） | W4 | P1 | task-08, task-11, task-12 | FR-17, FR-19；D-026@v1 | `components-daemon.md`、`sillyhub-daemon/interactive.md`、`backend/daemon.md`、`PROTOTYPE.md` |
| task-15 | R-12 豁免清理 + 全量回归收口（含 FR-23 复跑） | W5 | P0 | task-11…task-14 | FR-23；R-12；SC-08 | 移除仓根 `.sillyspec/local.yaml` 的 `turn-segment-views.test.tsx` 豁免，跑全量测试/lint/tsc |

## 关键路径

**task-09 → task-10 → task-13 → task-15**（daemon 串行链 + 发版 + 回归，决定最短交付周期）；并行支线 `task-08 → task-11 → task-14`（backend → 前端 → 文档）可与 daemon 链重叠推进；Wave 1 内的三条清理卡（task-05/06/07）与四张登记卡（不执行）都不占关键路径。

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- **版本门控**：daemon 未上报快照 → backend 必须补 `capability="tool_only"`；前端**只看 capability、不看字段是否存在**——否则「字段缺失」会被误显示成「本轮无改动」（E6 / E8 / R-06）。
- **性能红线（D-023③，验收项不是建议）**：每轮 git 子进程 **≤3**；复杂度 O(改动数 + 工具调用数)；**禁 rename 检测**；必须 `core.preloadIndex` + `--no-optional-locks`；**1500ms 硬超时降级 `partial`**（`reason="timeout"`）；**单工作区串行队列**（队列满 → `partial` + `queue_overflow`）；遥测记 `collectMs` / 降级率 / 子进程数，**p50 > 300ms 或降级率 > 5% 报警**。
- **顺序**：E2 采集必须在**轮终态已落库之后异步**执行，禁止用 1500ms 采集阻塞轮结束与 SSE 终态；前端收到快照才渲染卡片，**快照未到不出空卡**。
- **幂等**：以 `(runId)` 为键覆盖写；同一 `runId` 重放上报必须等价于最后一次上报（禁追加）。
- **契约字段逐跳一致**：`TurnFileChangesSnapshot` / `TurnFileChange` / `FileChangesCapability` 三段（daemon DTO → backend pydantic 镜像 → 前端类型）字段名逐字对齐（`status` / `reason` / `truncated` / `files[].attribution` / `files[].source` / `concurrentSessionsHint`），**不得增删字段**。
- **降级三态语义**：`ok` 全量可信；`partial` = 超时 / 超上限 / 队列溢出——**卡片照出**、行级 +/− 显示破折号（不伪造数字）；`failed` / `unavailable`（`not_a_repo` / `git_missing`）→ 前端按 `tool_only` 走降级卡。**任何情况下禁止把「没有快照」显示成「本轮无改动」**。
- **归因边界**：`attribution="edit_patch"` 只在同一文件命中本轮 `Edit/Write` 的 `edit_patch.path` 时使用，其余一律 `command`（「命令行/脚本改动」）；**禁止用 `edit_patch` 反推改动来源**（真实导出仅 91/1271 条带 patch）。
- **并行隔离**：共享工作区不引入每会话 worktree（D-023 范围外）；卡片恒标 `concurrentSessionsHint`「可能含并行会话改动」；ignored 目录探测结果必须标 `source="mtime"`。
- **TTFT/attempt 口径（D-025@v1 更正）**：采集在范围内、不得缓发；UI **不做** TTFT/decode 双色切分（design 非目标首条仍成立）——有 timing 字段→模型条改用真实占用区间，无字段→保持单色近似并标注「近似」。
- **视觉零回归**：线 A 已锁数值不得被后续任务改动——正文 15px/1.8/0.65em、过程 11.5px + `muted-foreground/80`、左规线 `border-border/60`、过程/答复 14px 分区、`turn-block` 仅 `pb-7` 且**无任何边框**、左栏 chip `h-[14px]`/`text-[9px]`。
- **主题与样式**：只走语义 token（`hsl(var(--…))` / `--color-*`），零写死色值；三主题（ai-native / blue / dark）布局与信息层级不变（D-015@v2）。
- **架构与范围边界**：禁引依赖 / 禁虚拟化库 / 禁 Cordis 与 slot 注册表（FR-21）；**不改 `frontend/src/components/daemon/session-panel/` 的取数 / 分页 / SSE 编排**（FR-22；task-11 只允许加 props 透传）；不顺手做首屏/翻页/滚动/流式性能优化（D-006 / D-007）。
- **跨平台**：路径一律 `node:path` / `pathlib`，禁 shell 专用命令；换行差异不得影响断言（Windows / Linux / macOS）。
- **可回退**：`detailLevel` / `RoundDivider.detail` / `AttachmentChips.tone` 等可选入参缺省等价旧行为；`/proto/*` 与 `frontend/.proto-staging/` 可整块删除；导出产物禁止手改（改动必须重跑 `export-hydrated.mjs`）。
- **文案与错误**：UI 文案中文；降级/超时/不可用一律**显式提示**来源，禁止静默；错误按事件命名，不新增无依据的枚举值。
- **测试纪律**：先红后绿（TDD），实现与测试同卡；非测试逻辑本身有误时**禁止改测试**；改动既有断言失效面必须在该卡 `related_tests` 声明。

## 全局验收标准

1. **daemon 段**：`cd sillyhub-daemon && node node_modules/vitest/vitest.mjs run tests/interactive/` 全绿——六类夹具（有改动 / 无改动 / 非 git 仓 / untracked / binary / ignored-by-mtime）+ 超时 `partial` + 串行队列不并发（并发标记恒 1）+ 子进程计数 ≤3 + timing 派生（首 token / 多次 attempt / 空流 null）。
2. **backend 段**：`cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_session_file_changes.py app/modules/daemon/tests/test_session_model_usage.py` 全绿——`full` / `tool_only` 两分支序列化、`(runId)` 幂等覆盖写、排序与 404 闸门不回归、FR-23 四例复跑。
3. **前端段**：`cd frontend && node node_modules/vitest/vitest.mjs run src/components/daemon/file-changes/__tests__/` 全绿——归因映射 / `partial → truncated` / `tool_only` 降级（不出现「无改动」）/ 空快照不出卡 / 汇总去重与 Σ+/− / 横幅在场；`trajectory` 既有 56 例不回归。
4. **版本门控实测**：构造「无快照字段」的 run → 卡片显示「仅工具编辑」；无 timing 字段 → 模型泳道单色 + 标注「近似」；两态均无「本轮无改动」字样。
5. **性能实测落盘**：采集计时夹具输出 p50 / p95 / 降级率 / 单轮子进程数，写回 task-09 证据行；p50 > 300ms 或降级率 > 5% 时必须显式登记为风险而不是放过。
6. **零回归**：`tsc --noEmit` / `pnpm lint` / `ruff check` / `mypy` 退出 0；既有 208 例 / 9 文件面（SC-08）全绿；导出脚本机械校验通过（正文块 138 / `<template>` 0 / `turn-block` 无边框且带 `pb-7`）。
7. **R-12 已清**：仓根 `.sillyspec/local.yaml` 的 `known_failures` 不再含 `turn-segment-views.test.tsx`，且该文件 93/93 绿。

> 逐项核验结果由 verify 阶段写入 `verify-result.md`；task 级验收对照 TaskCard 的 `acceptance` 字段。

## Review Focus 盲区清单（隐含面）

| # | 输入/条件 | 合理人预期行为 | 承接落点 |
|---|---|---|---|
| 1 | 目标工作区不是 git 仓（或 git 不在 PATH） | 快照 `status="unavailable"` + `reason="not_a_repo"`/`"git_missing"`，前端显示「仅工具编辑」降级卡；**不得**显示「本轮无改动」、不得抛错打断轮终态 | task-09（夹具）/ task-11（降级用例） |
| 2 | 工作区把改动目录 gitignore 掉（本仓 `.sillyspec/` 未被忽略，但目标仓可能忽略） | ignored 目录走「本轮工具调用路径前缀 + mtime」探测，命中项 `source="mtime"` 且卡片标注来源是 mtime 探测 | task-09 / task-11 |
| 3 | 同一 `(runId)` 被重放上报两次（outbox 补发 / retryTerminal） | 等价于最后一次上报，不追加、不重复计数；卡片不出现重复文件行 | task-08（幂等 upsert 用例） |
| 4 | 单文件二进制改动 / 改动数超上限被截断 | `binary=true` 且 +/− 显示破折号（不伪造 0/0 为「无改动」）；`truncated=true` 时行级统计显示破折号但总数仍给 | task-09 / task-11 |
| 5 | 一轮里模型请求被工具调用切成多段（首 token 前已跑过工具） | TTFT 只对「该 attempt 起点 → 首个 delta」成立；多段各出一次 attempt，模型条不把工具时间算进模型占用 | task-10 / task-12 |

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | 全局约束（架构边界） | task-15：`frontend/package.json` 零改动 + 无 Cordis/slot 新增 |
| D-002@v1 | task-01, task-07 | 视觉六条既有断言（93 例）+ 三主题截图 |
| D-003@v1 | task-01, task-07 | 同上（密度/留白口径） |
| D-004@v1 | task-01, task-02 | `SessionViewMode` 二态未改（FR-20） |
| D-005@v1 | task-03 | 原型管线留档（A/C 双形态） |
| D-006@v1 | 全局约束 | task-15：`session-panel` 取数/分页零改动 |
| D-007@v1 | 同上 | 性能四项不纳入（无对应任务） |
| D-008@v1 | 本计划 | SC-01…SC-10 已定稿（proposal） |
| D-009@v1 | task-01, task-02 | 方案定稿记录 |
| D-010@v1 | task-02, task-03 | `/proto/*` dev-only + 导出脚本 |
| D-011@v1（rejected，留档防复潮） | —（无任务） | 静态复刻不作定稿；task-03 只走 dev 路由 + 水合导出 |
| D-012@v1 | task-01 | 折叠未接线（无调用方传 `detailLevel`） |
| D-013@v1 | task-01 | token-only + 作用域选择器 |
| D-014@v1 | task-03 | SSR/水合导出链 |
| D-015@v1（已被 v2 取代，留档防复潮） | —（无任务） | 深色单基线作废 |
| D-015@v2 | task-01, task-07 | 三主题 token + 对比度核对 |
| D-016@v1 | task-01 | 五处层次问题逐条落地（93 例断言） |
| D-017@v1 | task-03 | 定稿原型由真实组件产出 |
| D-018@v1 | task-03, task-05 | 水合后 DOM + 脚本机械校验（138 正文块） |
| D-019@v1 | task-07 | 重判结论交用户（R-13） |
| D-020@v1 | task-01 | `turn-block` 无边框 + `pb-7`（8 例 + 导出核验） |
| D-021@v1 | task-01 | 四组数值锁死（15/1.8/0.65em、11.5、/80、/60、14px） |
| D-022@v1 | task-02, task-10 | 档 1 边界（不做 decode 切分；TTFT 采集由 D-025 更正入范围） |
| D-023@v1 | task-08, task-09, task-10, task-11, task-13 | 1b 四段测试 + 性能夹具 + 版本门控实测 |
| D-024@v1 | task-02, task-12 | 三泳道共享绝对轴 + 模型条近似标注 |
| D-025@v1 | task-01（已落盘）, task-10 | 语义标签 18 例 + TTFT/attempt 不缓发 |
| D-026@v1 | task-02, task-12 | 缩放/平移/刷子/Δ≤2px 不回归；有 timing 时模型条改真实区间 |
