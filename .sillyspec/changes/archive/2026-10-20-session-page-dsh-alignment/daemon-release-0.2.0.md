# SillyHub Daemon 0.2.0 发布说明

- **包**：`sillyhub-daemon`（仓内 `private: true`，随平台 bundle / daemon 自更新分发，不是公网 npm 包）
- **版本**：`0.1.1` → **`0.2.0`**（minor：新增两项对外能力，无既有字段/协议破坏）
- **变更**：`2026-10-20-session-page-dsh-alignment`（线 C / 1b，FR-11 / FR-13 / FR-14 / FR-15 / FR-16）
- **决策依据**：D-023@v1（1b 快照 + 性能红线）、D-027 / D-030（后到快照补写侧表）、D-028（上报体两处手写 snake_case 映射同步）、D-032（`basis` 恒 `approx`）
- **发布日**：2026-10-21
- **版本唯一来源**：`sillyhub-daemon/package.json` 的 `version`；`src/daemon-version.ts` 的 `DAEMON_VERSION` 直接读它，**没有第二处常量**。改版本只改 package.json 一处。

---

## 一、新增能力

### 1. 每轮工作区快照（`TurnFileChangesSnapshot`，FR-13 / FR-14）

轮尾对会话工作区跑 git 采集，产出「这一轮改了哪些文件」：

```ts
interface TurnFileChangesSnapshot {
  runId: string;
  baselineHead: string | null;   // 轮首 HEAD；非 git 仓为 null
  collectedAt: string;           // ISO
  collectMs: number;
  status: "ok" | "partial" | "failed" | "unavailable";
  reason?: "timeout" | "not_a_repo" | "git_missing" | "queue_overflow";
  truncated?: boolean;
  files: TurnFileChange[];       // path/status/added/deleted/binary/attribution/editToolNames/source
  concurrentSessionsHint: true;  // 恒 true：共享工作区可能含并行会话改动
}
```

- **归因口径**：`attribution="edit_patch"` 只在本轮 `Edit/Write` 命中同文件时使用（`editToolNames[]` 记来源工具）；其余一律 `"command"`（命令行 / 脚本改动）。**不用 `edit_patch` 反推改动来源**（真实语料 1271 条日志里只有 91 条带 patch，bash 178 条、sillyspec 30 条无 patch）。
- **禁 rename 检测**：改名呈现为 `delete + add` 两条（已知呈现代价）。
- **上报时序**：首报只带终态；快照在轮终态落库**之后**异步采集，用**同一端点二次上报**（`POST /leases/{id}/runs/{id}/result`）。backend 以 `(run_id)` 幂等覆盖写侧表、不改 run 终态（D-030）。同一 `runId` 重复上报等价于最后一次。
- 采集器：`src/interactive/turn-file-changes.ts::collectTurnFileChanges`；类型：`src/interactive/turn-file-changes-types.ts`。

### 2. TTFT / attempt 采样（`TurnTimingSnapshot`，FR-11 / FR-15）

从本轮既有事件流（`tool_use` / `tool_result` / `text` / `thinking` + 时间戳）派生出每轮模型调用时序：

```ts
interface TurnTimingSnapshot {
  runId: string;
  basis: "observed" | "approx";   // 当前恒 "approx"（见下）
  ttftMs: number | null;          // 只在取到首 token 时有值，禁填 0 冒充
  totalMs: number;
  attempts: { index; startedAt; firstTokenAt; endedAt; model; inputTokens; outputTokens }[];
}
```

- **`basis` 实测恒为 `"approx"`（D-032）**：claude / codex / pi 三引擎在 daemon 事件边界上都**没有稳定的「模型请求起点」信号**（claude 的 `message_start` 被归一化器吃掉；codex 的 `turn/started` 只是轮起点；pi 的 `message_start` 当纯生命周期丢弃）。故 attempt 起点取「轮首（首段）/ 本批工具全部 result 之后」，首 token 取首个 text/thinking delta，终点取下一个 `tool_use` 或轮终态。`"observed"` 只保留契约值，等驱动层补 `request_start` 事件后再翻转。
- **零事件 → 返回 `null`**（不是空壳对象）：前端据此回落「近似（无 TTFT 采样）」单色泳道。
- attempt 与工具区间**零重叠**（构造性保证，见 `turn-timing.ts` 模块头）。
- 已知偏差（诚实披露）：claude 的 text 事件走 500ms partial 节流 flush，TTFT 最多偏大一个节流窗口；`totalMs` 含 inject→起跑排队窗口——两条均属 approx 固有偏差。
- 派生子：`src/interactive/turn-timing.ts::deriveTurnTiming`（纯函数、零 I/O）。

### 3. 上报体新增三段（D-028 唯一防线）

`daemon.ts::buildRunSnapshotPayload`（唯一组装点）+ `hub-client.ts::notifyRunResult`（wire 映射）**两处手写 snake_case**，与外层 `status` / `is_error` 同级：

| wire 键 | 出现条件 | 内部形状 |
|---|---|---|
| `file_changes` | 本轮确有快照 | camelCase（`TurnFileChangesSnapshot`） |
| `timing` | 本轮确有采样 | camelCase（`TurnTimingSnapshot`） |
| `daemon_version` | 后到补报时恒带 | `"0.2.0"` 等语义版本串 |

三段均为**可选字段**：`undefined` → 键不出现（与 `model_usage` 同惯例）。首报（终止 run）不带快照；后到补报会复述终态三字段（`status` / `is_error` / `subtype`）。
wire 级由 `tests/interactive/turn-file-changes-wire.test.ts`（5 例）锁死：三段「有值才出现、无值键不出现」、内部结构保持 camelCase。

---

## 二、采集口径与性能红线（D-023③，验收项不是建议）

| 红线项 | 口径 | 0.2.0 实测 |
|---|---|---|
| 每轮 git 子进程 | **≤3 条**，不随文件数扩张 | **恒 2**（`status --porcelain -z` + `diff --numstat`；轮首 HEAD 走零子进程读 `.git/HEAD`） |
| 复杂度 | O(改动数 + 工具调用数)，无全仓扫描、禁 rename | 已按 `--no-renames` / `core.preloadIndex` / `--no-optional-locks` 实现 |
| 硬超时 | **1500ms** → `partial` + `reason="timeout"`，**禁止阻塞轮结束** | 已实现（Promise.race + 子进程 kill） |
| 单工作区串行 | `Map<workspaceRoot, tail>` 队列；队列满 → `partial` + `reason="queue_overflow"` | 已实现（默认队列深度 1，不与用户操作争 `index.lock`） |
| 告警线 | p50 > **300ms** 或降级率 > **5%** | 安静窗口 9 轮实测：本变更 worktree 语料 **p50 245ms / p95 480ms**（21 改动 / 1,082B）；主仓重脏仓 111 改动 / 5,627B → **p50 318ms / p95 379ms**；降级率 **0%** |

- **退档开关**：`DEFAULT_TURN_FILE_CHANGES_LIMITS.includeLineCounts = false`（只跑 status，行级 +/− 显示破折号、快照置 `partial`），并建议同批把 `timeoutMs` 降到 800。已实现 + 单测，一行改默认值即可退档。
- **R-16（P1，已登记，未擅自降档）**：重脏工作区 p50 **318ms** > 300ms 报警线。按 D-023 的「p50 > 300ms 必须显式登记为风险而不是放过」处理，当前保留全量口径（designated 语料 245ms 未超线），不沉默改判。
- 遥测：快照自带 `collectMs` / `status` / `truncated`，另打结构化日志 `turn_file_changes_collected`；模块内 50 轮滑窗给 p50 / p95 / 降级率（无外部依赖）。

---

## 三、兼容与降级（版本门控）

**平台侧最低可用 daemon 版本＝`0.2.0`。**
含义与边界：`0.2.0` 是「两项能力齐全」的**能力线**，**不是硬版本拦截**——平台版本门控只看 `capability` 与字段存在性（design E8），**低于该版本只降级、不阻断会话**；老 daemon 仍可正常连接、正常跑会话。

| 组合 | 行为 |
|---|---|
| **新平台 × 老 daemon（< 0.2.0）** | 上报体无 `file_changes` → backend 落 `file_changes=null` + `file_changes_capability="tool_only"` → 前端显示**「仅工具编辑」降级卡**；全树**不出现**「本轮无改动」（`queryByText(/无改动/) === null` 已锁）。无 `timing` → 模型泳道回落**单色**并标**「近似（无 TTFT 采样）」**。 |
| **老平台 × 新 daemon（0.2.0）** | 老 backend 的 `InteractiveRunResultRequest` 没有这三个字段，pydantic `BaseModel` 默认 `extra="ignore"` → 新字段被**静默忽略**，旧读模型与旧端点响应形状零变化（同 `cache_*_tokens` 当年被静默丢弃的先例）。会话不受影响。 |
| **新平台 × 新 daemon** | 快照 → 卡片（`full`）；timing → 模型泳道按 attempt 切分。**注意**：当前前端按「有 timing → 真实占用口径」出条并标「真实占用」，而 daemon 自标 `basis="approx"`——「真实占用」文案在 0.2.0 下仍是**近似**口径（task-12 遗留：逐条标注需给 `TrajectorySpan` 加 `basis` 字段，未接线），勿据此判断测量精度。 |
| **半程缺失** | 只有快照无 timing（或反之）各自独立降级，不互相拖累：`capability` 与 `timing` 是**两个独立字段**。 |
| **快照降级态** | `partial`（超时 / 截断 / 队列溢出）**不是错误态**：卡片照出、行级 +/− 显示破折号；`failed` / `unavailable`（非 git 仓 / 无 git）走前端降级卡。 |

- 老 daemon 的判定**只看字段有无**，前端不看版本号字符串：字段缺失 ≠ 本轮无改动。
- **回退方式**：daemon 发版无法像前端那样「删文件即回退」；回退＝回到 0.1.x daemon，平台侧自动走 `tool_only` 降级链（E8）。发版前请保留上一版 bundle 以便回装。

---

## 四、构建与验证记录（2026-10-21，worktree `2026-10-20-session-page-dsh-alignment`）

| # | 命令 | 结果 |
|---|---|---|
| 1 | `node scripts/gen-build-id.mjs` | `BUILD_ID=accb539b-20261021173125`（旧 `5ff6414b-20261021130230`） |
| 2 | `pnpm build` | **exit 1**：corepack 版本冲突（`packageManager` 声明 pnpm@9.6.0，本机 pnpm v11.28.5）→ 按预案走 3 |
| 3 | `node node_modules/typescript/bin/tsc` | **exit 0**（`dist/cli.js` 重建） |
| 4 | `node dist/cli.js --version` | **`0.2.0`** |
| 5 | `node node_modules/typescript/bin/tsc --noEmit` | **exit 0**（基线 typecheck 已修复，无新增错误） |
| 6 | `node node_modules/vitest/vitest.mjs run tests/interactive/ tests/version.test.ts` | **83 files passed / 1338 passed, 1 skipped** |
| 7 | `node node_modules/vitest/vitest.mjs run tests/interactive/turn-file-changes-wire.test.ts` | **5 passed**（三段「有值才出现」） |
| 8 | `cd backend && uv run --frozen pytest -q --no-cov app/modules/daemon/tests/test_session_file_changes.py -k "tool_only or late_snapshot"` | **3 passed, 4 deselected**（`test_tool_only_when_no_snapshot_row` / `test_interactive_close_persists_snapshot_and_tool_only_fallback` / `test_late_snapshot_after_terminal_close_still_persists`） |
| 9 | `cd frontend && node node_modules/vitest/vitest.mjs run src/components/daemon/file-changes/__tests__/ src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx` | **4 files / 53 passed**（含 `tool_only` → 降级卡、全树无「本轮无改动」） |
| 10 | `cd frontend && node node_modules/vitest/vitest.mjs run src/components/daemon/trajectory/__tests__/` | **3 files / 61 passed**（`modelBasis="approx"` + 「近似（无 TTFT 采样）」标注） |

- 新增锁：`tests/version.test.ts` 加一例「`DAEMON_VERSION` 是合法 semver 且不低于 **0.2.0**」——把平台最低可用版本钉进 daemon 自己的测试，package.json 若被回退到 0.1.x 发版前即红。
- 产物纪律：`dist/` 与 `src/build-id.ts` 是构建产物（`src/build-id.ts` 已 gitignore，`dist/` 同样不入库），**不提交**；BUILD_ID 只作发布留痕。

---

## 五、发布检查清单

- [x] `sillyhub-daemon/package.json` version = `0.2.0`（只升 daemon，未动 frontend / backend 版本）
- [x] `node dist/cli.js --version` → `0.2.0`
- [x] BUILD_ID 重新生成并留痕
- [x] `tsc` 构建 / `tsc --noEmit` / `tests/interactive/` + `version.test.ts` 全绿
- [x] 版本门控两条链实测留痕（缺快照 → `tool_only` + 「仅工具编辑」；缺 timing → 「近似（无 TTFT 采样）」）
- [x] wire 级三段「有值才出现」断言绿
- [ ] 由发版负责人（主代理）统一提交并打版本留痕；bundle / 自更新产物按既有流程上传（本卡不产出发布通道）

---

## 六、遗留与风险

1. **R-16**：重脏仓（111 改动）p50 318ms 超 300ms 报警线，已登记；退档开关就绪但未切（designated 语料未超线）。
2. **R-08 共享工作区**：并行会话改动无法归属，`concurrentSessionsHint` 恒 `true`，卡片恒显「可能含并行会话改动」；不引入每会话 worktree。
3. **rename 不检测**：改名呈现为 delete + add 两条。
4. **approx 固有偏差**：TTFT 受 500ms partial flush 影响、`totalMs` 含排队窗口；`observed` 分支生产不可达，等驱动层补 `request_start`。
5. **老平台静默忽略依赖 pydantic 默认行为**：若未来某个 `InteractiveRunResultRequest` 改成 `extra="forbid"`，新 daemon 上报会 422（届时需同步发版顺序：先平台后 daemon）。
6. **最低可用版本目前只有文档口径 + capability 判据**，平台侧没有「daemon 版本低于 0.2.0」的显式提示条；如产品需要「请升级 daemon」提示，需另立项（前端读 `daemon_version` 做软提示）。
7. `pnpm build` 在本机因 corepack/pnpm 版本不一致不可用（环境问题，非本次改动引入）；CI/发版机若同样冲突，统一用 `node node_modules/typescript/bin/tsc` 或先把 `packageManager` 与 pnpm 版本对齐。
