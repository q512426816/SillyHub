# task-06 端到端验证证据（e2e verification with evidence）

- 变更：`2026-09-20-knowledge-effect-panel` / task-06（P0，verification）
- 验证时间：2026-09-20 23:14 ~ 23:35（本地时间）
- 验证执行人：验证工程师 agent（不改业务源码；仅新增本证据文件）
- worktree：`.sillyspec/.runtime/worktrees/2026-09-20-knowledge-effect-panel`（HEAD=`f38033461`，task-01~05 五提交齐备）
- 覆盖决策：D-007（行 sha256 幂等）、D-008@v3（使用率榜 per_task 口径）、D-009（覆盖率/死条目/密度口径）
- 覆盖需求：FR-01~FR-06（自动化面覆盖服务层，浏览器渲染面留 M 清单）

## 0. 环境与数据口径说明

真实数据源：主仓 `.sillyspec/.runtime/knowledge-hits.jsonl`（daemon 活跃追加中的文件）。

- 任务卡撰写时为 **2749 行**，本次验证执行时已增长至 **2827 行**（daemon 持续追加，属正常）。本证据全部以执行时刻快照 N=2827 为准，如实记录不粉饰。
- 快照方式：本机 python（系统与 venv 均）`open()` 原路径报 `FileNotFoundError`（`os.stat` 可见、`ls`/`cmd dir`/git bash 读正常，疑似安全软件对该活跃文件的干扰；两解释器一致复现）。改用 git bash `cp` 快照到 `%TEMP%\knowledge-hits-snapshot.jsonl`，**sha256 逐字节比对一致**：
  - 原文件（git bash sha256sum）：`6329e05c3a3818a5f1d0e8fab361636aa058b1a5384cb6ef36a7b823dcc088d9`
  - 快照（python hashlib）：同值。
- 快照画像（脚本内独立统计）：

| 项 | 值 |
| --- | --- |
| 总行数 / 合法 JSON / 坏行 | 2827 / 2827 / 0 |
| 行 sha256 去重后 | 2827（文件内零重复行） |
| type 分布 | inject=2809、fr-inject=14、fr-supersede=2、fr-duplicate-warning=1、fr-unreferenced=1（无 classify 行，白名单已含） |
| 带 `at` 字段 / 带 `matchedFiles` | 2827 / 2809（fr-inject 行携带 domains/count，无 matchedFiles——实测形态） |
| 锚点形态 | `文件#slug` 锚 17983 次 / 裸文件锚 2583 次 |
| `at` 日期跨度 | 2026-09-14 → 2026-09-20（7 天，远小于 90 天死条目窗） |

## 1. 测试面（全部真实执行，worktree 内）

### 1.1 backend knowledge 模块全量

**内容**：knowledge 模块（含 task-01 新增 hits 数据底座测试）全量 pytest。
**命令**（worktree `backend/`）：

```bash
uv run pytest app/modules/knowledge -q
```

**输出摘录**：

```
123 passed, 18 warnings in 44.06s
```

（warnings 均为 starlette `HTTP_422_UNPROCESSABLE_ENTITY` DeprecationWarning，与本变更无关。）

**结论**：通过（123 passed / 0 failed）。

### 1.2 daemon 新面测试 + 全量 typecheck

**内容**：task-02 新增上报面 `knowledge-hits-upload.test.ts` + 改动的 `hub-client.test.ts`；全量 `tsc --noEmit`。全量 4449 用例回归按任务卡约定留给收尾 task-07，不重复跑。
**命令**（worktree `sillyhub-daemon/`）：

```bash
pnpm test -- tests/knowledge-hits-upload.test.ts tests/hub-client.test.ts
pnpm typecheck
```

**输出摘录**：

```
✓ tests/hub-client.test.ts (67 tests) 29ms
✓ tests/knowledge-hits-upload.test.ts (14 tests) 163ms
Test Files  2 passed (2)
     Tests  81 passed (81)
=== TYPECHECK ===  (> tsc --noEmit，退出码 0)
```

上报链关键单测名（挂点/500 不阻塞/断点，如实引用）：

- `splitCompleteLines（R-01 完整行断点，纯函数）` 4 例：`"a\nb\n" → ["a","b"]`、无换行尾行是半行留下轮、空文件 → []、空行也是完整行原样保留（服务端 skipped_bad 计数）
- `uploadKnowledgeHitsIfNeeded`：
  - `hits 文件不存在 → 静默 no-op`
  - `首轮全量上报 + offset 前进；append 后只报新行（增量）`
  - `尾行不完整（无换行）不报，补齐换行后的下一轮才报（R-01）`
  - `端点 500 → 不抛、offset 不进、warn 一次；恢复后原样重报`
  - `分批 ≤2000 行：2005 行 → 2000+5 两批；批级 offset 前进`
  - `状态文件损坏/形状不符 → 视为 offset=0 全量重报（服务端去重兜底）`
  - `offset 超前 → 钳到当前行数不误报`
  - `client 未实现 postKnowledgeHitsBatch（旧客户端）→ 静默 no-op 零日志`
- `postSpecSync 成功汇聚点挂点（task-02 / R-05）`：
  - `postSpecSync 成功（首同步 tar 路径）→ 触发 hits 上报一次；同步返回值不受影响`
  - `hits 上报端点 500 → 同步主流程照常完成不抛`
- `HubClient — postKnowledgeHitsBatch（task-02 hits 上行）`：`POST /api/workspaces/{ws}/knowledge/hits/batch，body 带 register 记住的 daemon_local_id + lines`

**结论**：通过（81 passed；tsc 0 错误）。

### 1.3 frontend knowledge 面 vitest + tsc

**内容**：`src/components/knowledge/__tests__/`（含 task-04 `ops-dashboard.test.tsx` 6 例、task-05 `entry-card-list.test.tsx` 15 例）+ `knowledge-page.test.tsx`（22 例，含新挂载/双 tab 分发用例）+ 同目录其余组件测试一并求全。
**命令**（worktree `frontend/`）：

```bash
pnpm test -- src/components/knowledge "src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx"
pnpm typecheck
```

**输出摘录**：

```
Test Files  8 passed (8)
     Tests  96 passed (96)
=== TSC ===  (> tsc --noEmit，退出码 0)
```

新增面关键 describe（引用）：`ops-dashboard.test.tsx` 的「四指标卡渲染（FR-02 / D-009）」「死条目内嵌清单开合」「使用率榜（FR-03 / D-008@v3）」「三态：空态 / 错误态（不白屏）」；`knowledge-page.test.tsx` 的「运营仪表盘挂载（task-04）」「卡片/原文双 tab 分发（task-05 / FR-04 / D-004@v2）」。

**结论**：通过（96 passed；tsc 0 错误）。

## 2. 真实数据端到端（核心证据）

一次性脚本 `%TEMP%\e2e_hits_task06.py`（不入仓；backend 测试基建 SQLite 内存库，镜像 `backend/conftest.py` 的 `db_engine` 模型注册；工作区 spec_root 指主仓真实 `.sillyspec`，parser 只读）。运行命令（worktree `backend/`）：

```bash
uv run python "%TEMP%\e2e_hits_task06.py"
```

分批大小 2000 行/批（与 daemon `HITS_BATCH_MAX_LINES` 及 backend R-06 边界同值），模拟 daemon 真实分批协议。

### 2.1 第一遍全量喂入

**输出摘录**：

```
pass1 batch#1: 2000 行 → ingested=2000 duplicates=0 skipped_bad=0
pass1 batch#2:  827 行 → ingested=827 duplicates=0 skipped_bad=0
pass1 合计: {'ingested': 2827, 'duplicates': 0, 'skipped_bad': 0} | 表行数=2827
[PASS] A1 第一遍全量落库: ingested=2827 (期望 2827), duplicates=0, skipped_bad=0
[PASS] A2 表行数=快照行数: 2827 == 2827
```

**结论**：真实全量 2827 行两批全部落库，零坏行零重复，表行数=文件行数。

### 2.2 第二遍全量重报（offset 丢失场景，D-007 幂等实证）

**内容**：同批参数再喂全量 2827 行（等价 daemon 状态文件损坏/丢失后 `offset=0` 全量重报的攻击面）。
**输出摘录**：

```
pass2 合计: {'ingested': 0, 'duplicates': 2827, 'skipped_bad': 0} | 表行数=2827
[PASS] B1 重报幂等（D-007）: ingested=0 (期望 0), duplicates=2827 (期望 2827), skipped_bad=0
[PASS] B2 重报后表行数不变: 2827 == 2827 == 2827
```

**结论**：重报 `ingested=0`、`duplicates=2827`、表行数不变——行 sha256 幂等（D-007）在真实数据全量规模下成立；与 daemon 单测「状态文件损坏 → offset=0 全量重报（服务端去重兜底）」形成两端口径闭环。

### 2.3 stats 四指标 + 榜 + 文件计数（真实数据）

**输出摘录**：

```
coverage: used=135 total=322 pct=0.4193
density: per_task_avg=367.25
freshness: recent_new=88 recent_used=88
dead_entries: 187
usage_board top10:
  fr/styles.md                       per_task=38.3333  total=115   tasks=1
  patterns.md#monorepo-三服务架构     per_task=28.8571  total=1616  tasks=22
  known-issues.md#-docker-backend-容器不热重载… per_task=23.1607 total=1297 tasks=13
  patterns.md#backend-模块组织        per_task=22.75    total=1274  tasks=12
  …（前 10 完整见脚本输出）
entry_counts top10:
  known-issues.md 8109 / patterns.md 4078 / conventions.md 3851 / sillyspec-gotchas.md 1665
  / decisions/backend.md 1054 / decisions/daemon.md 820 / testing-gotchas.md 280
  / decisions/frontend.md 263 / decisions/change.md 169 / fr/host-fs-handler.md 146
```

**结论**：四指标、榜（slug 锚与裸文件锚混排、fr zone 条目居榜首）、文件计数在真实数据上产出合理量级（覆盖率 41.93%、密度 367.25 锚/任务、死条目 187、近 30 天新增 88 全被命中）。

### 2.4 指标对拍（独立重算，不经 HitsService.stats）

**内容**：脚本直接查 `knowledge_hits` 表（type∈{inject,fr-inject} 行的 matched_anchors 逐行拆锚点）+ 直接调 `parser.parse_knowledge_entries`（条目全集 322：top 98 + decisions 175 + fr 11 + generated 38），独立复算全部指标与 stats 输出对照。
**输出摘录**：

```
[PASS] D1 coverage.total: 322 == 322
[PASS] D2 coverage.used: 135 == 135（覆盖率 135/322 = 41.93%）
[PASS] D3 dead=总条目-命中条目: 187 == 322-135 = 187（前提：最新命中 2026-09-20，跨度 7 天 << 90 天窗）
[PASS] D4 density: 367.25 == 20566/56 = 367.25（inject 锚点总数/任务去重数）
[PASS] D5 榜条目数=命中锚点数: 62 == 62
[PASS] D6 榜 total 与独立锚点计数全量一致: 62 锚点逐一相等
[PASS] D7 entry_counts 与独立文件计数全量一致: 14 文件逐一相等（榜头 known-issues.md 8109 次）
[PASS] D8 榜按 per_task 降序: top3=[38.3333, 28.8571, 23.1607]
```

**过程如实记录**：对拍首轮 D2/D3 FAIL（stats=135 vs 脚本=56）——定位为**验证脚本自身口径误用**（拿锚点去重集合计数，漏了 decisions/fr 同文件多 `##` 条目共享文件级锚点的「逐条目」口径），非业务缺陷；按 hits.py 口径修正脚本后 16/16 全过。业务实现与 design D-009 口径（覆盖分子=逐条目）一致。

**结论**：四指标 + 榜 + 文件计数与独立重算**全量一致**（8/8 对拍项通过）。

### 2.5 slug 归一化生效（救命项 Grill CLK-02）

**输出摘录**：

```
[PASS] E1 手册 slug 锚点命中数>0（slug 归一化生效）:
  命中 slug 锚 53 个（17983 次），其中 47 个精确落在条目全集（手册小节锚 98 条）
  （slug 锚未落在全集的 6 个：条目后来改名/删除所致，如
   known-issues.md#-daemon-pnpm-overrides-把-claude-agent-sdk-8-平台二进制硬钉-0.3.181 等）
[PASS] E2 裸文件两形态共存: 裸文件锚 9 个（2583 次）；zone 分布 {'top': 98, 'decisions': 175, 'fr': 11, 'generated': 38}；fr/ 裸锚 2 个
```

**结论**：`slugify_anchor` 与 CLI 注入侧锚点形态在真实数据上对齐——53 个命中 slug 锚中 47 个精确落进 parser 条目全集（其余 6 个对应已改名/删除的小节，属数据演化非归一化误差）；两形态（`#slug` 小节级 / 裸文件级）混排聚合正常。

### 2.6 脚本总览

```
共 16 项，失败 0 项（快照完整性 1 + 落库 2 + 幂等 2 + 对拍 8 + 归一化/形态 3）
```

## 3. daemon 全量回归（不重复跑，留给 task-07）

按任务卡与指令约定：daemon 全量 4449 用例不在本卡重复执行（新面 81 例已绿），全量回归留收尾 task-07 统一跑。此处如实登记为「本卡未覆盖，转 task-07」。

## 4. 部署期 manual verify 清单（不可自动化项）

以下项需 dev 栈/服务器 + 真实 daemon + 浏览器，超出本卡自动化范围，**如实登记为待部署期验证**，不视作已通过（照 knowledge-precipitation task-09 evidence §6 先例格式）：

| # | 验证项 | 需求/风险 | 建议部署期步骤 | 预期 |
| --- | --- | --- | --- | --- |
| M1 | 浏览器四指标卡渲染：覆盖率 %（分子/分母）、密度 锚/任务、近 30 天新增、死条目卡与内嵌清单开合 | FR-02 / D-009 | ① 起栈后进某有真实 hits 的工作区知识库页，等运营仪表盘加载；② 核对四卡数值与本证据 §2.3 同量级；③ 点开死条目清单核对锚点样式与条数 | 四卡数值非零且与 §2.3 口径一致；死条目清单可开合、锚点可读；无 4xx/5xx、无白屏 |
| M2 | 使用率榜 % 格式：per_task 以百分比展示、降序、fr/裸文件锚混排 | FR-03 / D-008@v3 | ① 打开使用率榜；② 核对前 3 行与 §2.3 榜头（fr/styles.md、patterns.md#monorepo-三服务架构、known-issues.md#docker-…）；③ 核对百分比格式（如 38.33%）与升沉箭头/徽标 | 榜头锚点与 per_task 降序和 §2.3 一致；% 格式正确不显示原始小数 |
| M3 | 三形态卡片流：手册小节卡（标题+文件来源）、decisions 条目卡（去 ID 段标题+徽标）、FR 条目卡；榜/清单/分组树互跳 | FR-04 / task-05 | ① 在知识库列表切卡片视图；② 抽查三种 zone 各一张卡（top/decisions/fr）；③ 从使用率榜点锚点跳对应条目卡片，再从卡片跳原文 | 三形态渲染正确、徽标（superseded/implemented 等）可见；互跳落点正确（slug 锚落小节、裸文件落文件级条目） |
| M4 | fr 组渲染 + 卡片/原文双 tab：fr zone 独立分组、原文 tab 展示 md 源文 | FR-04 / D-004@v2 / D-005@v1 | ① 分组树展开 fr 组（本证据实测 fr 条目 11 条、fr/ 裸锚命中 2 个文件）；② 点任一卡片「原文」tab | fr 组条目数与 §2.5 zone 分布一致；原文 tab 展示文件源文（含 frontmatter），卡片 tab 可切回 |
| M5 | 真实 daemon 在线同步触发上行：postSpecSync 成功挂点 → hits 增量上行 → 平台侧行数增长；offset 断点与 500 不阻塞 | FR-01 / D-007 / R-05 | ① 服务器起升级后 daemon，触发一次同步（或跑任意 agent 任务产生 inject）；② 查后端 `knowledge_hits` 表行数较同步前增长、`daemon_local_id` 为该 daemon 实例；③ 触发第二轮同步无新增重复行（幂等）；④ （可选）临时停 backend 再同步，daemon warn 不抛、恢复后原样重报成功 | 同步成功且 hits 上行一次；第二轮 ingested=0；daemon 日志无未捕获异常 |
| M6 | 未升级 daemon 空态：老 daemon 不上报 → stats 零命中 → 前端「暂无使用数据」态 | D-009 兼容策略 / acceptance 第 4 条 | ① 用未升级 daemon 挂一个新 workspace（零 hits 行）；② 打开该工作区知识库页运营仪表盘 | 四卡显示零值/空态文案（「暂无使用数据」类），页面零报错不白屏（与单测「三态：空态」一致的浏览器实证） |

## 5. 总结表

| # | 验证项 | 面向 | 结论 |
| --- | --- | --- | --- |
| 1 | backend knowledge 模块全量 pytest | 后端 | 通过（123 passed） |
| 2 | daemon 新面（hits 上报 + hub-client）+ 全量 typecheck | daemon | 通过（81 passed；tsc 0 错误） |
| 3 | frontend knowledge 面 vitest + tsc | 前端 | 通过（96 passed；tsc 0 错误） |
| 4 | 真实 2827 行全量分批喂入 | D-007 前置 | 通过（ingested=2827 / dup=0 / bad=0 / 表行数=2827） |
| 5 | 第二遍全量重报幂等 | D-007 | 通过（ingested=0、duplicates=2827、行数不变） |
| 6 | stats 四指标 + 榜 + 文件计数（真实数据） | D-008@v3 / D-009 | 通过（覆盖 135/322=41.93%、密度 367.25、死 187、fresh 88/88；榜头 fr/styles.md per_task=38.33） |
| 7 | 指标独立重算对拍（直接查表 + parser 条目全集） | D-009 口径 | 通过（8/8 全量一致；首轮 2 项 FAIL 为验证脚本自身口径误用，已修正，非业务缺陷） |
| 8 | slug 归一化 + 两形态锚 | Grill CLK-02 | 通过（命中 slug 锚 53 个/47 个精确落条目全集；裸文件锚 9 个） |
| 9 | daemon 全量回归（4449） | 回归 | 本卡未跑，按约定转 task-07 |
| M1-M6 | 浏览器渲染 / 真实 daemon 在线上行 / 老 daemon 空态 | FR-02~FR-04 / FR-01 / D-007 | 待部署期验证（步骤与预期见 §4） |

自动化面（1-8）全部通过，无业务失败项；M1-M6 为部署期人工验证项。业务源码零改动。
