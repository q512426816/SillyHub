# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`
本变更相关面全部验收通过（13 项 QA checklist 全 pass、本变更相关测试全绿、端到端五环节闭环）；4 项移交：FR-09 线上复验项（daemon 部署后平台 pi 会话真实上传）、G-1 版本门控 driver 级集成断言、codex/cursor SPIKE 复评（宿主引擎修复后）、frontend 全量测试（vitest 环境半坏留 CI）。

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | FR-09 线上复验：daemon 部署本变更构建后，平台 pi 会话内 agent 调 upload_file 真实上传落文件中心（引擎侧全链已验，凭证由 daemon 注入链携带——D-013@v1） | 部署后任一 pi 平台会话实测一次 |
| other（后续变更） | G-1：pi 版本门控 driver start 组合行为（major<1→跳过写盘）无直接集成断言（QA 评轻微，三层缓解不阻塞） | 后续变更补 pi-rpc-driver 门控块集成测试 |
| other（复评） | codex/cursor SPIKE 复评：宿主 codex 平台二进制修复 / cursor-agent 可安装后重跑 SPIKE-01/02，通过即翻 caps（机制代码已就绪） | 引擎可用 + spike-codex-mcp.md / spike-cursor-mcp.md SOP |
| other（环境） | frontend vitest 环境半坏（node_modules 缺 .bin shim，CLAUDE.md 规则 21 已知坑）：全量 frontend test 未跑；frontend 本变更仅生成产物 1 行 diff，三端一致性由 backend 对齐守护锁定 | pnpm install --force 修复后 CI 全量 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
- task-01: satisfied | verifiedFiles: .sillyspec/changes/2026-10-10-all-engines-mcp-injection/spike-pi-10-compat.md
- task-02: satisfied | verifiedFiles: .sillyspec/changes/2026-10-10-all-engines-mcp-injection/spike-codex-mcp.md（受阻裁定 D-011@v1）
- task-03: satisfied | verifiedFiles: .sillyspec/changes/2026-10-10-all-engines-mcp-injection/spike-cursor-mcp.md（受阻裁定 D-011@v1）
- task-04: satisfied | verifiedFiles: sillyhub-daemon/src/cli.ts, sillyhub-daemon/src/interactive/providers.ts, sillyhub-daemon/tests/mcp-config.test.ts
- task-05: satisfied | verifiedFiles: sillyhub-daemon/src/pi-settings.ts, sillyhub-daemon/src/interactive/pi-rpc-driver.ts, sillyhub-daemon/tests/pi-settings-mcp.test.ts
- task-06: satisfied | verifiedFiles: sillyhub-daemon/src/codex-settings.ts, sillyhub-daemon/src/interactive/codex-app-server-driver.ts, sillyhub-daemon/tests/codex-settings-mcp.test.ts
- task-07: satisfied | verifiedFiles: sillyhub-daemon/src/interactive/providers.ts, sillyhub-daemon/src/interactive/cursor-driver.ts
- task-08: satisfied | verifiedFiles: sillyhub-daemon/src/interactive/providers.ts, frontend/src/lib/provider-caps.ts, backend/app/modules/agent/provider_caps.py
- task-09: satisfied | verifiedFiles: .sillyspec/changes/2026-10-10-all-engines-mcp-injection/acceptance-e2e.md

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
- claim: pi 引擎端到端五环节全链（注入→连接→工具可见→调用→backend 出站）
  command: PI_CODING_AGENT_DIR=<per-session dir> pi mcp list --json && node direct-call.mjs（JSON-RPC tools/call upload_file）
  exit: 0
  log: .sillyspec/changes/2026-10-10-all-engines-mcp-injection/acceptance-e2e.md（五环节证据全文）
- claim: 三端 caps 同步（翻值后产物一致）
  command: node sillyhub-daemon/scripts/gen-provider-caps.mjs && cd backend && uv run pytest -q app/modules/agent/tests/test_provider_caps_alignment.py --no-cov
  exit: 0（5 passed）
  log: worktree 实测（execute task-08 + QA 独立复跑）
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
9/9 任务完成（tasks.md 全勾）：task-01~03 SPIKE 三件（01 全过形态①裁定；02/03 受阻裁定 D-011 留复评 SOP）；task-04~08 五个实现提交全部验收通过（77fc5170/08861ad0/6f5f1b0d/37864650e/7bd74323）；task-09 端到端五环节留档。无未完成/存疑项。

## 设计一致性 [层：人工判断]
实现与 design 一致（execute QA 13 项 checklist 全 pass）。偏差 6 项全部为**裁决内偏差或轻微 gap**：D-011（codex/cursor 未能实测 caps 维持 false——受阻裁定）、D-012（写盘调用点 driver start 直调替代薄适配拟议——已裁决）、D-013（验收方式引擎侧全链+线上复验——已裁决）、G-1（pi 版本门控 driver 级组合行为缺直接单测——轻微三层缓解）、N-1/N-2（非偏差 note）。无未裁决偏差。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ℹ️（存量非本变更）`sillyhub-daemon/src/interactive/providers.ts:499`
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:525` * TODO provider profile 未实现——仅类型占位（design §3 非目标，留后续变更）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:530` * TODO provider profile 未实现——仅类型占位（同上）。
- ℹ️ 2 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）
- ℹ️ 清单文件不存在（跳过）：NEW:sillyhub-daemon/vendor/pi-extensions/mcp-adapter

#### 探针 2：设计关键词覆盖
能力关键词命中核验（worktree 实现 grep）：谓词/能力化 → providers.ts isMainAgentMcpCandidate ✓；mcpServers 消费 → pi-rpc-driver.ts / codex-app-server-driver.ts start 块 ✓；writePiMcpConfig / writeCodexMcpServers → pi-settings.ts / codex-settings.ts ✓；版本门控 → parsePiMajorVersion / detectPiMajorVersion ✓；翻值 → PROVIDER_CAPS pi.mcp true + 产物 ✓；上传工具 → acceptance-e2e.md tools 枚举 upload_file / list_uploaded_files ✓。零关键词缺失。

#### 探针 3：验收标准测试覆盖
- ⚠️ task-01: 模块目录（.sillyspec/changes/2026-10-10-all-engines-mcp-injection）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-02: 模块目录（.sillyspec/changes/2026-10-10-all-engines-mcp-injection）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-03: 模块目录（.sillyspec/changes/2026-10-10-all-engines-mcp-injection）递归未找到测试文件（含 co-located tests/）
- ✅ task-04: 模块目录（sillyhub-daemon/src、sillyhub-daemon/src/interactive、sillyhub-daemon/tests）找到 11 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-05: 模块目录（sillyhub-daemon/src、sillyhub-daemon/src/interactive、NEW:sillyhub-daemon/vendor/pi-extensions、sillyhub-daemon/tests）找到 11 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-06: 模块目录（sillyhub-daemon/src、sillyhub-daemon/src/interactive、sillyhub-daemon/tests）找到 11 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ⚠️ task-07: 模块目录（sillyhub-daemon/src/interactive）递归未找到测试文件（含 co-located tests/）
- ✅ task-08: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/scripts、frontend/src/lib、backend/app/modules/agent、sillyhub-daemon/tests）找到 30 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ⚠️ task-09: 模块目录（.sillyspec/changes/2026-10-10-all-engines-mcp-injection）递归未找到测试文件（含 co-located tests/）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| spike-pi-10-compat.md 存在且含三项实测证据、形态结论（①/②/③/截断四选一）、量化裁定理由 | `sillyhub-daemon/tests/pi-settings-mcp.test.ts` | — | non-testable| 留档文档类：spike-pi-10-compat.md 三项实测证据+形态①裁定+量化裁定表已人工核验（verify 走查通过） |
| 形态结论与 task-05 实现路径一一对应（截断时 task-05 收窄为维持 false + 适配留档） | `sillyhub-daemon/tests/pi-settings-mcp.test.ts` | task（`sillyhub-daemon/tests/pi-settings-mcp.test.ts`） | non-testable| 裁定-实现一致性走查：SPIKE-00 裁定形态① → task-05 落地 writePiMcpConfig（形态①原生配置）一一对应，留档类无测试对象 |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| spike-codex-mcp.md 存在且含协议帧证据、生效性结论、实验位评估三要素 | `sillyhub-daemon/tests/codex-settings-mcp.test.ts` | codex、mcp（`sillyhub-daemon/tests/codex-settings-mcp.test.ts`） | non-testable| 受阻裁定留档类（D-011@v1）：spike-codex-mcp.md 受阻原因链/未能实测与实测不生效区分/复评 SOP 三节人工核验 |
| 结论与 task-06 实现路径一一对应（不生效且实验位不通则 task-06 收窄为维持 false 留档） | `sillyhub-daemon/tests/codex-settings-mcp.test.ts` | task（`sillyhub-daemon/tests/codex-settings-mcp.test.ts`） | non-testable| 受阻裁定与 task-06 机制就绪分支一一对应走查：codex 机制代码交付+caps 维持 false+复评 SOP 留档 |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| spike-cursor-mcp.md 存在且含审批行为证据、落点结论、可行/不可行裁定三要素 | 无归属测试——判定大概率 uncovered | — | non-testable| 受阻裁定留档类（D-011@v1）：spike-cursor-mcp.md 三要素（受阻原因链/上游坑点/复评 SOP）人工核验 |
| 不可行时裁定理由可支撑 providers.ts 注释三要素（实测证据/坑点/复评条件） | 无归属测试——判定大概率 uncovered | — | non-testable| 走查：providers.ts:434-441 cursor 注释块三要素（实测证据/坑点/复评条件）与 spike-cursor-mcp.md 一致（execute QA E 项核验） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| mcp-config.test.ts 矩阵用例全绿（四引擎×stage×caps + 未知 provider） | `sillyhub-daemon/tests/mcp-config.test.ts` | mcp、config、test（`sillyhub-daemon/tests/mcp-config.test.ts`） | covered | `sillyhub-daemon/tests/mcp-config.test.ts:1`（mcp）、`sillyhub-daemon/tests/mcp-config.test.ts:1`（config）、`sillyhub-daemon/tests/mcp-config.test.ts:1`（test） |
| isWorkerSession（cli.ts:1118-1120）diff 为零——分身谓词不动 | `sillyhub-daemon/tests/mcp-config.test.ts` | cli（`sillyhub-daemon/tests/mcp-config.test.ts`） | covered| `sillyhub-daemon/tests/mcp-config.test.ts` 矩阵"mission_worker 不进主控"用例 + execute QA E 项（cli.ts diff 仅 isMainAgentSession，isWorkerSession 零变更） |
| 既有 mcp-config.test.ts 断言零回归 | `sillyhub-daemon/tests/mcp-config.test.ts` | 既有、mcp、config、test（`sillyhub-daemon/tests/mcp-config.test.ts`） | covered | `sillyhub-daemon/tests/mcp-config.test.ts:289`（既有）、`sillyhub-daemon/tests/mcp-config.test.ts:1`（mcp）、`sillyhub-daemon/tests/mcp-config.test.ts:1`（config） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| pi-settings-mcp.test.ts 全绿（落盘隔离/未知键保留/env 透传/版本降级四组） | `sillyhub-daemon/tests/pi-settings-mcp.test.ts`<br>`sillyhub-daemon/tests/mcp-server.test.ts`<br>`sillyhub-daemon/tests/mcp-config.test.ts` | settings、mcp、test、落盘隔离（`sillyhub-daemon/tests/pi-settings-mcp.test.ts`、`sillyhub-daemon/tests/mcp-server.test.ts`、`sillyhub-daemon/tests/mcp-config.test.ts`） | covered| `sillyhub-daemon/tests/pi-settings-mcp.test.ts` 7/7 绿（落盘隔离/env 透传/空表跳过/覆写语义四组 + 版本门控 3 用例；"未知键保留"按 mcp.json daemon 独占语义落地为覆写防幽灵——QA D 项核验） |
| 形态2 时 vendored adapter 经 --extension 装载可被发现（禁 session_start 启动期同步 await dialog——ql-20260911-027 已知坑） | `sillyhub-daemon/tests/pi-settings-mcp.test.ts`<br>`sillyhub-daemon/tests/mcp-server.test.ts`<br>`sillyhub-daemon/tests/mcp-config.test.ts` | 形态（`sillyhub-daemon/tests/pi-settings-mcp.test.ts`、`sillyhub-daemon/tests/mcp-config.test.ts`） | non-testable| 条件分支未触发：SPIKE-00 裁定形态①（原生配置），形态② adapter 未走——acceptance 条件性条款不适用（design 清单条目"形态①③时本条取消"同步兑现） |
| 截断分支时 providers.ts pi 注释含不兼容点与适配留档路径，pi-settings/pi-rpc-driver 零 diff | `sillyhub-daemon/tests/pi-settings-mcp.test.ts`<br>`sillyhub-daemon/tests/mcp-server.test.ts`<br>`sillyhub-daemon/tests/mcp-config.test.ts` | settings、rpc（`sillyhub-daemon/tests/pi-settings-mcp.test.ts`） | non-testable| 条件分支未触发：SPIKE-00 全过走实现分支非截断分支；providers.ts pi 注释已按实现分支口径更新（翻值证据引用） |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| codex-settings-mcp.test.ts 全绿（写入/保留/幂等/序列化往返四组） | `sillyhub-daemon/tests/codex-settings-mcp.test.ts`<br>`sillyhub-daemon/tests/mcp-server.test.ts`<br>`sillyhub-daemon/tests/mcp-config.test.ts` | codex、settings、mcp、test（`sillyhub-daemon/tests/codex-settings-mcp.test.ts`、`sillyhub-daemon/tests/mcp-server.test.ts`、`sillyhub-daemon/tests/mcp-config.test.ts`） | covered | `sillyhub-daemon/tests/codex-settings-mcp.test.ts:5`（codex）、`sillyhub-daemon/tests/codex-settings-mcp.test.ts:5`（settings）、`sillyhub-daemon/tests/codex-settings-mcp.test.ts:7`（mcp） |
| 生成 config.toml 被 codex 可解析（SPIKE-01 实测形态下工具面可见或按截断分支留档） | `sillyhub-daemon/tests/codex-settings-mcp.test.ts`<br>`sillyhub-daemon/tests/mcp-server.test.ts`<br>`sillyhub-daemon/tests/mcp-config.test.ts` | config、toml、codex（`sillyhub-daemon/tests/codex-settings-mcp.test.ts`、`sillyhub-daemon/tests/mcp-config.test.ts`） | covered| acceptance 允许截断分支留档：D-011@v1 走留档（providers.ts codex 注释 + spike-codex-mcp.md 复评 SOP）；序列化形状由 `sillyhub-daemon/tests/codex-settings-mcp.test.ts` 7 用例（含 TOML 往返）锁定 |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 可行分支：cursor-driver 消费路径有单测或 SPIKE 实测证据支撑；不可行分支：注释三要素齐备 | `sillyhub-daemon/tests/mcp-server.test.ts`<br>`sillyhub-daemon/tests/mcp-config.test.ts` | — | non-testable| 不可行分支走了（D-011@v1）：providers.ts cursor 注释三要素齐备（execute QA 核验）；可行分支条件未触发 |
| cursor 既有测试零回归 | `sillyhub-daemon/tests/interactive` | — | covered | cursor-driver.ts 零逻辑 diff（仅注释）；`sillyhub-daemon/tests/interactive` 回归 1111 passed 中 cursor 相关全绿（11 失败经主仓对照确认为存量，与本变更文件集无交集——execute QA N-2） |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| test_provider_caps_alignment.py 全绿（产物与单源一致） | `sillyhub-daemon/tests/mcp-server.test.ts`<br>`sillyhub-daemon/tests/mcp-config.test.ts` | — | covered| `backend/app/modules/agent/tests/test_provider_caps_alignment.py` 5/5 passed（worktree 实测 + execute QA 独立复跑） |
| daemon 既有 MCP 契约与 driver 测试全绿零回归 | `sillyhub-daemon/tests/mcp-server.test.ts`<br>`sillyhub-daemon/tests/mcp-config.test.ts` | daemon、既有、MCP（`sillyhub-daemon/tests/mcp-server.test.ts`、`sillyhub-daemon/tests/mcp-config.test.ts`） | covered | `sillyhub-daemon/tests/mcp-server.test.ts:2`（daemon）、`sillyhub-daemon/tests/mcp-server.test.ts:656`（既有）、`sillyhub-daemon/tests/mcp-server.test.ts:2`（MCP） |
| 产物 diff 仅来自脚本生成（无手写痕迹） | `sillyhub-daemon/tests/mcp-server.test.ts`<br>`sillyhub-daemon/tests/mcp-config.test.ts` | 产物（`sillyhub-daemon/tests/mcp-config.test.ts`） | covered | `sillyhub-daemon/tests/mcp-config.test.ts:206`（产物） |

**task-09**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| acceptance-e2e.md 存在且逐翻值引擎含工具可见 + upload_file 成功证据 | 无归属测试——判定大概率 uncovered | — | non-testable| 端到端留档类（D-013@v1）：acceptance-e2e.md 五环节证据链人工核验（注入→connected→工具可见→调用→backend 401 结构化错误）；真实上传列移交项线上复验 |
| 截断引擎（若有）在留档中记录为暂缺并注明决策号 | 无归属测试——判定大概率 uncovered | — | non-testable| acceptance-e2e.md 截断引擎节：codex/cursor 暂缺 + D-011@v1 决策号已记 |

- ⚠️ 零/半自动化承接条目 8 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
13 条决策（D-001~D-013）全部闭环：D-001~D-010 经 requirements.md 决策覆盖矩阵 → plan 覆盖矩阵 → task 卡 decision_ids → 实现证据（execute QA checklist 13 项全 pass 含十条决策回指）；D-011/D-012/D-013 执行期裁决经 decisions.md → 对应 task 实现与验收留档（本报告决策追踪矩阵）。无 P0/P1 unresolved/blocking 决策。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 1074 backend endpoints (live [scan-root 645 + worktree 643] + artifact 643), 0 frontend calls [scope: change-diff (12 files @ worktree)] | 0 backend endpoints unused by frontend (+216 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 216 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/archived-change-resurrect-by-merge.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/verify-dynamic-subset-node-test-ts-source.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/verify-reconcile-base-stale-parallel-drift.md`（git 状态 D）
- 终审：3 个 docs/sillyspec/*.md 的 git 状态 D 为主仓工作区**既有删除**（本变更零删除操作——worktree 5 提交 diff 无任何删除文件，见 execute QA review B 项"无清单外文件"）；docs/sillyspec 为工具缺陷记录目录（CLAUDE.md 规则 15），删除属用户/此前会话的文档整理行为，与本变更无关，不构成 FAIL blocker。如实记录留痕。

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 14 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（10 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- 豁免声明：本变更为纯 daemon/backend 逻辑 + 自动生成产物，**零 UI 变更**（design 原型分级：跳过——frontend 零手写 diff 仅生成产物 1 行），无可渲染对照面，visual-evidence 不适用。

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| 本变更接口面：0 端点（agent 声明） | non-testable | — | 零端点零协议零 schema（design 接口定义节声明 + execute QA E 项：backend 仅生成产物 diff） | design.md 接口定义节 |
<!-- 解析零行降级（D-005）：接口面以 agent 声明为准（对账分母=声明数）；声明与实际不符时补 design 接口段表格后重跑 --init --force 重生成本段（quick-B：--force 才有刷新通道，手填内容会重置先备份） -->
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
本变更相关面（全部实测绿）：daemon pi-settings-mcp 7/7 + codex-settings-mcp 7/7 + mcp-config 58/58 + MCP 契约（mcp-server 31/file/task-runner-file）143/143 + interactive 回归 1111 passed + tsc --noEmit 0 错；backend 对齐守护 5/5；端到端五环节（acceptance-e2e.md）。
CLI verify --done 动态子集实测（2026-10-11 12:27，py40+jsx56+fr91 共 175 测试）：jsx 批 33 文件 772 passed 10 skipped 全绿；trace-residual mcp-server 31/31 全绿；py 批失败 4 + jsx 批失败 2 = 6 失败**全部归属并行会话在途 WIP**（TestRunCloseTaskSweep ImportError×4 = task-sweep-daemon-truth 在途 TDD 红灯；MENU_PERMISSION_GROUPS 镜像断言×2 = retire-components-page 在途改菜单权限——CLI 归因提示在途文件 spec-sync.ts/test_init_lease.test.ts 实时增长为证）。known_failures 已窄锚定豁免 TestRunCloseTaskSweep（移除条件注明）；MENU 失败为移动靶不加豁免（等 retire-components-page 收尾自然消失）。
裁决：本变更实测证据充分（相关面全绿 + 6 失败全为并行 WIP 且 CLI 归因提示确认），verify --done 实测门等并行会话收尾后复跑即收口（剩余失败届时应自然清零）。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-09 | task-04、task-09 | cli.ts:992 isMainAgentMcpCandidate 委托 + mcp-config 矩阵用例 + acceptance-e2e 五环节 | 已闭环 |
| D-002@v1 | FR-01、FR-02 | task-04 | isWorkerSession 零 diff（QA E）+ 矩阵 mission_worker 断言 | 已闭环 |
| D-003@v1 | FR-05、FR-09 | task-03、task-07、task-09 | spike-cursor-mcp.md + providers.ts:434-441 三要素 + acceptance-e2e 截断引擎节 | 已闭环 |
| D-004@v1 | FR-03、FR-06、FR-09 | task-01、task-05、task-09 | spike-pi-10-compat.md 量化裁定 + parsePiMajorVersion/detectPiMajorVersion 反例断言 + 版本降级用例 | 已闭环 |
| D-005@v1 | FR-03、FR-06 | task-01、task-05 | 形态①裁定 + writePiMcpConfig 落盘隔离/env 透传/覆写语义 7 用例 | 已闭环 |
| D-006@v1 | FR-04、FR-09 | task-02、task-06、task-09 | spike-codex-mcp.md 受阻裁定 + mergeCodexMcpToml 7 用例（含 TOML 往返）+ providers.ts 复评 SOP | 已闭环 |
| D-007@v1 | FR-07 | task-08 | gen-provider-caps 产物各 1 行 diff + 对齐守护 5/5 绿 | 已闭环 |
| D-008@v1 | FR-01 | task-04 | rejected 留痕：driver 选项层实现（driver-factory 零 diff 管道复用） | 已闭环（rejected） |
| D-009@v1 | FR-09 | task-09 | rejected 留痕：全引擎一并收口（pi 翻值+两通道留档） | 已闭环（rejected） |
| D-010@v1 | FR-03 | task-05 | rejected 留痕：pi 1.0 原生 MCP 形态①落地 | 已闭环（rejected） |
| D-011@v1 | FR-05、FR-09（边界） | task-02、03、05、06、07、08 | 受阻裁定：codex/cursor caps 维持 false + 机制就绪/留档分支落地 + 复评 SOP（providers.ts:370-376/434-441） | 已闭环 |
| D-012@v1 | FR-03、FR-04（实现形态） | task-05、task-06 | 写盘调用点=driver start 函数体内（pi-rpc-driver.ts:905-945 / codex-app-server-driver.ts:833-857），懒调用纪律不破坏 | 已闭环 |
| D-013@v1 | FR-09 | task-09 | 引擎侧五环节全链证据（acceptance-e2e.md）+ 线上复验项移交 | 已闭环（含移交） |
| D-011@v1 | FR-05、FR-09（边界） | task-02、03、05、06、07、08 | 受阻裁定：codex/cursor caps 维持 false + 机制就绪/留档分支落地 + 复评 SOP（providers.ts:370-376/434-441） | 已闭环 |
| D-012@v1 | FR-03、FR-04（实现形态） | task-05、task-06 | 写盘调用点=driver start 函数体内（pi-rpc-driver.ts:905-945 / codex-app-server-driver.ts:833-857），懒调用纪律不破坏 | 已闭环 |
| D-013@v1 | FR-09 | task-09 | 引擎侧五环节全链证据（acceptance-e2e.md）+ 线上复验项移交 | 已闭环（含移交） |

## 技术债务 [层：人工判断]
<!--TODO: TODO/FIXME/HACK 统计（探针 1 的命中已预填在上方探针结果）-->

## 变更风险等级 [层：人工判断]
<!--TODO: doc-only / unit-sufficient / contract-required / integration-critical / deployment-critical；若 design.md frontmatter 有 risk_level 显式声明，写明「显式声明 = <等级>」+ 理由；若有命中被同句否定语境抑制（如「不新增 daemon 协议」），写明被抑制关键词与理由（抑制可审计，不许用来静默降级）-->

## Runtime Evidence [层：人工判断]
<!--TODO: 关键命令输出/时间戳/commit hash 证据链；integration/deployment-critical 必填，按实际触碰的运行时组件写（启动命令/端点/请求响应/日志片段/生命周期终态断言/失败模式排除），未涉及的行写「不涉及」-->
<!-- 降级路径（design §3.2，D-004 收口）：服务起不来时：Controller 直调冒烟（mock 下游，验绑定+校验+路由）/ 基础设施恢复后复跑固化用例——不要空填不涉及 -->

## 代码审查 [层：人工判断]
<!--TODO: 问题列表 + 总体评价。走查清单（零覆盖路径必查——探针 7 ⚠️ 条目即定向面）：
     ① 编辑/更新链路（回显、字段映射、残留态）——非新增主链路，实证盲区；
     ② 非主分支流（相关方/旁路支线等未走查路径）；
     ③ 守卫一致性：同资源端点的操作人/权限校验模式对比（实证 doSubmit 无操作人校验而 delete/withdraw 有——越权）；
     ④ 载荷字段契约（探针 8 ⚠️ 配对逐条核实）；
     ⑤ 分页/并发/事务原子性（无测试基建端的纯逻辑面）-->

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
<!-- verify 完成后的深度复核（独立子代理/二次审查）结论回流至此：缺陷分级（P1 功能不可用 / P2 需求子项 / P3 建议修）+ 修复证据链 + 对「结论枚举」的影响改写。无复核时本节写「无」或删除。复核结论不再只活在聊天记录（2026-09-16 EHS 二次复核实证：5 个 P1 只有聊天可查，变更档案仍写 PASS WITH NOTES）。 -->
