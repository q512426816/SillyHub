---
author: qinyi
created_at: 2026-10-09 09:58:48
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-10-09-workspace-init-skill-gate

## 背景

工作区初始化（init lease）当前的执行链路存在三个断点：

1. **初始化不写 skill 文件**。daemon 端 `runSillyspecInit` 以 `--no-skills` 调用 sillyspec CLI（sillyhub-daemon/src/spec-sync.ts:1848），该开关源于 2026-08-15-init-trigger-sillyspec-init 变更 D-004@v1「skills 只走 skill-manager 单渠道」。结果：初始化完成后，本地项目目录里没有任何 skill 文件；技能只在任务执行时由 skill-manager 拷到 `<workdir>/.claude/skills/` 单端目录（sillyhub-daemon/src/skill-manager.ts:754），机器上装了 codex/zcode 等其它 agent 时这些端拿不到技能。
2. **初始化操作后置且无引导**。创建工作区成功后前端仅关闭弹窗刷新列表（frontend/src/components/workspace-scan-dialog.tsx:93-98），用户必须自行进入详情页找到「初始化」按钮手动点击；未初始化时（`workspace_member_runtimes.init_synced_at` 为 NULL）详情页只有一枚琥珀徽标，没有"未初始化不能用"的行动引导。
3. **白名单落后于 CLI**。sillyspec CLI v3.32.2 的 `VALID_TOOLS` 已含 zcode 共 7 值（sillyspec 仓库 src/init.js:80），daemon 端 `SILLYSPEC_VALID_TOOLS` 仍为 6 值缺 zcode（sillyhub-daemon/src/task-runner/runner-types.ts:173-180，注释自述"CLI 新增工具时同步此表"）。

## 设计目标

- FR-01：初始化时按机器上探测到的 agent 类型写入对应格式的 skill 文件——多种 agent 全部写入（sillyspec init `--tool` 多值）、不在 CLI 支持列表内的 agent 自然跳过（同名交集过滤）、探测结果全不支持时兜底写 claude code 类型（现有 `['claude']` 兜底）。
- FR-02：daemon 端工具白名单与 CLI v3.32.2 对齐（补 zcode），版本门控从 ≥3.26.8 提升到 ≥3.32.2。
- FR-03：工作区详情页对"当前成员/机器未初始化"状态提供轻引导（Alert 文案 + 现有初始化按钮），后端不加硬门禁。
- FR-04：创建工作区成功且已绑定机器（daemon_id）时，前端自动串行调用初始化并在弹窗内展示进度直至完成；初始化失败不回滚创建。
- FR-05：init lease 失败时禁止回写 `init_synced_at`（成败门：`result.status != "failed"` 才回写）——消除"失败被标已初始化"的现状误报，是 FR-04 轮询语义成立的前置。

## 非目标

- 不改 skill-manager 链路（平台自定义技能仍走 skill-manager 单渠道写 `.claude/skills`，任务执行热路径零改动）。
- 不做后端硬门禁（未初始化不返回 409/403，派发与扫描校验零改动——D-002@v1 用户已确认）。
- 不改后端接口与数据模型（唯一后端改动是 complete 消费侧 init 回写段的成败门一处条件，见 FR-05）。
- 不做平台自定义技能（CustomSkill）的多端分发（那是 skill-manager 多端化课题，超出本次范围）。
- 不为存量已初始化工作区重跑初始化或回填多端 skill。

## 拆分判断

单变更收口三件事（skill 写入 / 引导 / 创建即初始化）：三者共享"初始化"同一条业务链路（init lease → init_synced_at），拆开会造成前端创建流程与引导文案两次改同一批组件、daemon 参数与门控两次动同一函数，合在一个变更里上下文最完整。不涉及其它变更的代码重叠，无需批量模式。

## 总体方案

三段施工（Wave 组织见 plan 阶段）：

**Wave 1 · daemon 端——恢复 skills 复制段 + 白名单/门控同步 + 失败不回写修复**

- `runSillyspecInit` 的 spawn 参数去掉 `'--no-skills'`（sillyhub-daemon/src/spec-sync.ts:1848）。sillyspec CLI 收到不带 `--no-skills` 的 init 后，将包内 21 个 `sillyspec-*` 技能复制到 `--tool` 各工具目录：claude→`.claude/skills`、codex→`.codex/skills`、openclaw→`.openclaw/skills`、opencode→`.opencode/skills`、zcode→`.zcode/skills`（sillyspec 仓库 src/init.js:474-499）。`--tool` 值链路不变：cli.ts 启动时 `AgentDetector.detectAgents()` 探测本机 agent → `mapDetectedToSillyspecTools` 取与 `SILLYSPEC_VALID_TOOLS` 的同名交集（sillyhub-daemon/src/cli.ts:1188-1196）→ 逗号拼接传 `--tool`；交集为空/探测失败时 `runSillyspecInit` 兜底 `['claude']`（spec-sync.ts:1840，现状保留）。FR-01 的三条语义（多写/跳过/兜底）由该链路天然满足。
- `SILLYSPEC_VALID_TOOLS` 补 `'zcode'`（runner-types.ts:173），与 CLI v3.32.2 对齐。
- `MIN_SILLYSPEC_VERSION_FOR_INIT` 从 `'3.26.8'` 提升到 `'3.32.2'`（spec-sync.ts:1675）。理由：zcode 技能复制的双层缺口（detectTools 不发现 + 显式 --tool 也拿不到）在 v3.32.2（sillyspec commit 016968bd，2026-10-09）才修复；老版本对 `--tool zcode` 静默忽略且 exit 0，会造成"init 成功但 zcode 端无技能"的暗坑。门控不满足时 init 失败并返回现有错误码 `sillyspec_init_cli_too_old`（spec-sync.ts:1831-1836，含升级指引）。
- **失败不回写修复（Grill UB-1，前置依赖）**：现状 `complete_lease` 的 init 回写段只判 `mode=='init'` 不分成败（backend/app/modules/daemon/lease/service.py:531-542）——daemon init 失败仍以 status='failed' 上报 complete（sillyhub-daemon/src/task-runner.ts:1070-1080 `_finish(..., result.ok=false, ..., 'failed', ...)`），后端照样写 `init_synced_at = now`，导致**失败被标"已初始化"**（现状手动初始化即有此误报）。修复：init 回写段增加 `result.get("status") != "failed"` 门——失败时跳过回写并 warn 日志 `init_lease_failed_no_synced`，`init_synced_at` 保持 NULL。这是 Wave 2 前端"轮询非空=成功、超时=失败"语义成立的前置条件，同时修掉现状手动初始化的同一误报。

**Wave 2 · 前端——创建即初始化（workspace-scan-dialog.tsx）**

创建流程状态机从 `idle → creating` 扩展为 `idle → creating → initializing → done | init_failed`：

1. `createWorkspace` 成功后：若本次提交带了 `daemon_id`（能定位机器，现状创建表单必选），紧接着调 `initDispatch(workspaceId)`（frontend/src/lib/spec-workspaces.ts:174 现有封装 → `POST /api/workspaces/{id}/init`）。
2. 之后每 2s 轮询 `fetchMyBinding(workspaceId)`（frontend/src/lib/workspace-binding.ts:20 现有封装）直到 `init_synced_at` 非空，5 分钟超时（复用 frontend/src/components/workspace-config-card.tsx:206-251 `handleInit` 的既有模式与参数）。
3. 弹窗 UI：两步进度指示（创建✓ → 初始化中 spinner → 完成✓）；初始化期间禁用取消/提交按钮；完成态提供「打开工作区」；失败/超时态明示"**工作区已创建成功，但初始化失败**，可稍后在详情页重新初始化"，提供「打开工作区」「稍后手动初始化」两个出口——**失败不回滚创建**（工作区行已落库，回滚无意义且现状 create 本就无事务伙伴）。
4. 未传 `daemon_id`（表单校验上不可达，防御分支）：跳过初始化直接走现状完成路径（notify + onCreated）。
5. 组件卸载时清理轮询定时器（对齐 config-card 现有清理模式）。

**Wave 3 · 前端——未初始化轻引导（workspace-config-card.tsx）**

`binding.initSyncedAt` 为空时（成员/机器维度，一台机器未初始化不影响另一台），在现有「未初始化」琥珀徽标下方新增一条引导 Alert（antd Alert，warning 态）：「当前机器尚未初始化这个工作区，初始化后才能正常使用。每台机器需要单独初始化（同一工作区在其它机器不受影响）。点击『初始化』将下发平台配置、拉取文档缓存，并按本机已有的 agent 写入对应 skill 文件。」已初始化态保持现状零改动（绿徽标 + 时间 + 版本）。交互原型见 `prototype-create-init-flow.html` 场景④⑤。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/spec-sync.ts | `runSillyspecInit` spawn 参数去 `--no-skills`；`MIN_SILLYSPEC_VERSION_FOR_INIT` `'3.26.8'`→`'3.32.2'`；同步块注释（D-004@v1 修订留痕 + 门控理由） |
| 修改 | sillyhub-daemon/src/task-runner/runner-types.ts | `SILLYSPEC_VALID_TOOLS` 补 `'zcode'`，注释同步（7 值对齐 CLI v3.32.2） |
| 修改 | backend/app/modules/daemon/lease/service.py | `complete_lease` init 回写段加 `result.get("status") != "failed"` 门：失败跳过回写 + warn 日志 `init_lease_failed_no_synced`（Grill UB-1 修复，Wave 2 语义前置） |
| 修改 | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | 补失败不回写用例：init lease 以 status='failed' complete → `init_synced_at` 保持 NULL；status='completed' → 正常回写（对照组） |
| 修改 | sillyhub-daemon/tests/run-sillyspec-init.test.ts | 断言反转：spawn 参数不再含 `--no-skills`；门控用例改为 3.32.2 通过 / 3.26.8 拒绝 |
| 新增 | NEW:sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts | `mapDetectedToSillyspecTools` 白名单用例：`[claude,zcode,copilot]`→`[claude,zcode]`（zcode 放行 + 无关 provider 过滤）；空数组→`[]`（兜底在 runSillyspecInit 层） |
| 修改 | frontend/src/components/workspace-scan-dialog.tsx | 两步状态机（creating→initializing→done/init_failed）+ initDispatch 串行调用 + 2s 轮询 + 三态 UI + 卸载清理 |
| 修改 | frontend/src/components/__tests__/workspace-scan-dialog.test.tsx | 新增用例：①创建+初始化全链路成功 ②初始化失败不回滚（弹窗出示警文案+出口按钮）③超时态 ④轮询清理 |
| 修改 | frontend/src/components/workspace-config-card.tsx | 未初始化时徽标下新增引导 Alert（warning 文案见 Wave 3），已初始化态零改动 |
| 修改 | frontend/src/components/workspace-config-card.test.tsx | 补未初始化态 Alert 文案断言（现有六状态分支用例扩展） |

## 接口定义

本变更接口面：0 端点（无接口变更）。前端复用现有端点：`POST /api/workspaces`（创建）、`POST /api/workspaces/{id}/init`（初始化派发，backend/app/modules/workspace/router.py:457）、`GET /api/workspaces/{id}/my-binding`（轮询 init_synced_at）。daemon 侧 `runSillyspecInit` 函数签名（`RunSillyspecInitParams`）不变，仅内部 spawn argv 变化。daemon→backend 的 complete 上报端点协议不变（status='failed' 是既有合法值，本变更是后端消费侧语义收紧：失败不回写 init_synced_at）。

## 生命周期契约

生命周期契约：无（编排面零变更——事件×发起方×接收方×状态流转不变）。init lease 的创建（backend/app/modules/agent/service.py:2030 start_init_dispatch）、claim 签发（backend/app/modules/daemon/lease/context.py:794）、complete 上报（backend/app/modules/daemon/lease/service.py:362 complete_lease）链路不变；变化仅三处非编排面：① lease 执行体内部 `sillyspec init` 子进程的 spawn argv（去掉一个 flag）；② 后端 complete 消费侧对 init lease 的回写条件收紧（失败不写 `init_synced_at`，字段语义反而修正为"仅成功初始化"）；③ 前端在创建成功后多发起一次对现有 `POST /init` 端点的调用（重复调用语义现状已支持，见 backend/app/modules/agent/service.py:2104 复用已有 spec workspace 的现状路径）。

## 数据模型

无 schema 变更。`workspace_member_runtimes.init_synced_at` / `init_synced_spec_version` 语义修正为"仅 init lease **成功** complete 路径写"（FR-05 成败门后失败不再写入；D-006@v1）。

## 兼容策略（brownfield 必填）

- **存量已初始化工作区**：不重跑、不回填；其本地目录缺少多端 skill，直到用户下次点「重新初始化」才享受新行为。可接受（未上线项目）。
- **老版本 sillyspec CLI 的机器**：门控提升到 3.32.2 后，这些机器 init 直接失败（错误码 `sillyspec_init_cli_too_old` 沿用），提示升级 CLI；升级后无需重启 daemon（门控每次 init 独立跑，spec-sync.ts:1655 注释语义）。
- **创建时未绑 daemon_id**：行为与现状完全一致（跳过自动初始化，等绑定后手动初始化）。
- **skill-manager 任务执行链路**：零改动；spawn 前 link 仍会把平台技能刷到 `.claude/skills`，与 init 写入的 `sillyspec-*` 后写覆盖（版本可能漂移，D-001@v1 故障面已接受）。
- **未初始化工作区的既有行为**：后端派发/扫描零改动（无新拦截），前端仅新增提示文案。
- **失败回写语义修正（FR-05）**：现状"init 失败也写 init_synced_at"的行为被收紧为失败不写；存量已被误标"已初始化"的绑定行不清洗（未上线项目，用户重新初始化即覆盖为正确状态，CLAUDE.md 规则 11）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 双渠道在 `.claude/skills/sillyspec-*` 后写覆盖，daemon 本地 npm 包与服务器 bundle 静态目录版本可能漂移 | P3 | D-001@v1 故障面已接受（内容同源，覆盖无害）；skill-manager 升级多端化时可回关 init 复制段 |
| R-02 | 门控提升 3.32.2 导致存量老版本机器 init 直接失败 | P2 | 失败信息含升级指引（sillyspec_init_cli_too_old）；失败经 FR-05 成败门不回写 init_synced_at，前端进入失败/超时态并提示"守护进程可能版本过旧，可稍后在详情页重新初始化"；项目未上线可接受强制升级（CLAUDE.md 规则 11） |
| R-03 | 创建弹窗初始化最长阻塞 5 分钟（daemon 离线/慢/失败等待超时） | P2 | 弹窗明示"已创建成功、可稍后手动初始化"双出口；关窗不中断后台 lease（lease 派发后由 daemon 异步执行，前端轮询只是观察者）；失败由 FR-05 保证不误报成功 |
| R-04 | 老版本 CLI 对 `--tool zcode` 静默忽略造成 zcode 端无技能 | P3 | 已被门控 3.32.2 消除（FR-02） |
| R-05 | init 失败后 `init_synced_at` 保持 NULL，用户重新点初始化前详情页持续显示"未初始化" | P3 | 这正是正确语义（未成功初始化）；重新点「初始化」会派发新 lease（start_init_dispatch 每次新建 lease 行），重试路径通畅 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 init 写 skill 走 sillyspec init 自带复制段（去 --no-skills，修订 2026-08-15 D-004@v1） | FR-01 / Wave 1 / 文件清单第 1 行 / R-01 | 已覆盖 |
| D-002@v1 门禁仅前端引导，后端不硬拦 | FR-03 / Wave 3 / 非目标第 2 条 | 已覆盖 |
| D-003@v1 创建完成后前端串行调用初始化 | FR-04 / Wave 2 / 兼容策略 | 已覆盖 |
| D-005@v1 方案A 最小链路（否决 B 工程化复用 / C skill-manager 多端） | 总体方案全篇 / 非目标 | 已覆盖 |
| D-004@v1 SILLYSPEC_VALID_TOOLS 补 zcode + 门控提升 3.32.2 | FR-02 / Wave 1 / R-02 / R-04 | 已覆盖 |
| D-006@v1 init lease 失败禁止回写 init_synced_at（Grill UB-1 修复） | FR-05 / Wave 1 第 4 条 / R-03 / R-05 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/生命周期契约/数据模型/兼容策略/风险登记/决策追踪）
- [x] frontmatter 字段齐全（author/created_at/scale=large：跨 backend + sillyhub-daemon + frontend 三端 10 文件，含 UI 流程变化与多测试面，需 Wave 编排）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-006 全部落决策追踪表）
- [x] 生命周期关键词（lease/claim/complete）已含「生命周期契约：无」紧邻豁免说明（编排面零变更）
- [x] UI 原型已生成：prototype-create-init-flow.html（五场景：创建弹窗初始化中/完成/失败 + 详情页未初始化引导/已初始化对照）
- [x] 无自审存疑项（Grill 独立审查增量复审 pass：specVerdict=pass / qualityVerdict=pass，review-2026-10-09-100326）
