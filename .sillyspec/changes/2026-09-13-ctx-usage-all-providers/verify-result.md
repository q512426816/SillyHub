# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES——8/8 任务完成、相关面测试全绿（daemon 148 / frontend 55 / backend 4）、三端 caps 一致、真机运行时证据齐（daemon 真启动 + codex 实捕通知过编译产物 + pi 真机输出过归一化器）；notes：①三引擎「环百分比」平台级 e2e（backend+frontend+daemon 全栈）留部署环境，对齐 2026-09-12-provider-file-tx 先例口径（本地无 backend 实例），环逻辑由前端 vitest 三分支 + 真机分子派生证据覆盖；②pi 本轮真机 provider（openai/gpt-5.5）不回报 usage（全零），非零派生证据由 2026-09-04 真机采样 fixture（520/1024/256→1800）+ codex 非零实捕回放（12122）补强，全零如实携带 ctx=0 本身即设计口径（Grill D-1）。

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无（execute 阶段 8 个 task review 全 pass，无 cannot_verify 任务；verify-required-evidence.json 不存在）

## 集成验证回执 [层：自述声明——CLI 一致性校验]

- claim: 真实 daemon 启动（本变更全部改动模块进程内装载，非 mock） | command: `SILLYHUB_DAEMON_DIR=<temp> node <worktree>/sillyhub-daemon/dist/cli.js start --api-key <verify dummy>` | exit: 受控停止（[daemon.started] 后 kill） | log: %TEMP%/verify-ctx-usage/daemon-home/daemon.log
- claim: 真实 codex CLI 子进程实捕通知 → worktree 编译产物 driver 解析（真实集成，非 mock 单测） | command: `node %TEMP%/verify-ctx-usage/spike-codex.mjs`（spawn 真 codex app-server 0.147.0）+ `node %TEMP%/verify-ctx-usage/replay-codex.mjs`（实捕行过 dist/codex-app-server-driver.js） | exit: 0（SMOKE-PASS ctx_tokens=12122） | log: %TEMP%/verify-ctx-usage/（spike 脚本 + 回放脚本）
- claim: 真实 pi CLI 子进程输出 → worktree 编译产物归一化器（真实集成） | command: `pi --mode json -p "用 Bash 执行 echo pi-ctx-smoke 并汇报输出"`（真机 0.81.1）+ `node replay-pi.mjs`（输出过 dist/pi-events.js） | exit: 0（SMOKE-PASS ctx_tokens=0=0+0+0，provider 无计量如实携带） | log: %TEMP%/verify-ctx-usage/pi-run/pi-out.jsonl

## 任务完成度 [层：人工判断]

8/8 全部完成（CLI 勾选 8/8，execute 阶段独立审查 9 项 checklist 全 pass）：

- task-01 ✅：usage-ctx.ts 两纯函数 + 9 用例（全缺→undefined / 部分缺按 0 / 三和 / 毛值直取含 0 有效值）
- task-02 ✅：pi buildUsageEvent 恒派生；3 处 toEqual 同步（1800/0/0）
- task-03 ✅：cursor mapUsage 守卫派生；5 处 toEqual（15282/15418/15270/30645/31180）；旧注释修正
- task-04 ✅：codex last 解析 + lastCallCtxTokens + 双路携带 + extractEventUsage 透传 + 无 last/非法反断言
- task-05 ✅：claude :946 改调 helper（?? 0 兜底），差分路径原样；13+golden 6 全绿零断言改动
- task-06 ✅：caps 第 11 键三端贯通 + 五处守护同步 + picker 两 toEqual + 幂等（两连跑逐字节一致）
- task-07 ✅：CtxUsageBar provider prop + ctxSupported 门控 + 两调用点 + 三分支 vitest
- task-08 ✅：spike-01 真机实证（QUICKLOG ql-20260913-002-a71d）+ pi 证据链闭合 + onboarding 7 处更新

## 设计一致性 [层：人工判断]

一致（无偏差）。逐条核验：

1. FR-01/02 净值三和派生与 design Wave A 1/2 点逐字对齐（pi 恒派生 vs cursor 全缺不携带的口径差异按设计并列落地）
2. FR-03 codex `last.inputTokens` 毛值直取、双路携带（usage_update + turn result）、缺失不携带——与 design Wave A 3 点一致；execute 审查确认的 extractEventUsage 透传补充属卡内文件 acceptance 必需（usage 一等字段经 toAgentEvent 重建），非设计偏离
3. FR-04 caps 键/回退/生成脚本三处硬编码（含 Grill X-d 补全的模板接口体+文案+len 断言）全同步；既有 10 键取值键序零改动
4. FR-05 helper 单源 + claude 行为零变化（差分路径 diff 核对未动）
5. FR-06 前端门控（provider=null 旁路、false 只渲染 QuotaPill）+ 全仓仅两调用点（Grill X-c 核实）均传 provider
6. FR-07 真机验证完成（spike-01 结论：last 存在、毛值口径实锤 12122≥1216、totalTokens=12126=inputTokens+outputTokens）
7. 兼容策略四条全实证：缺键即跳过（backend 既有守卫未动）、历史 NULL 未知态（前端分支未动）、provider=null 旁路（vitest）、codex last 缺失降级（反断言用例）
8. 非目标零越界：无 schema/DTO/SSE envelope 改动（探针 5：0 前端调用变化）、budget/台账未动、批量层未动、分母链未动

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:305` * TODO provider profile 未实现——本变更不实现注入逻辑（design §3 非目标）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:331` * TODO provider profile 未实现——仅类型占位（design §3 非目标，留后续变更）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:336` * TODO provider profile 未实现——仅类型占位（同上）。
- ⚠️ `docs/agent-provider-onboarding.md:197` envPath: 'SILLYHUB_XXX_PATH',                 // env 覆盖变量
- ℹ️ 2 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

语义复核：providers.ts 三处 TODO 为 2026-09-11 变更既有的 envKeys/contextFile 预留占位（非本变更新增，diff 核对本变更未触碰该区段）；onboarding :197 是接入模板示例代码（文档固有）。均非未实现标记，非 blocker。

#### 探针 2：设计关键词覆盖
- ctx_tokens：pi-events.ts / cursor-events.ts / codex-app-server-driver.ts / usage-ctx.ts / 既有 claude-events.ts 五源命中 ✅
- ctx_usage：providers.ts + gen-provider-caps.mjs + 两份 @generated 产物 + 双守护测试 + pre-session-picker 命中 ✅
- 净值三和（ctxTokensFromNetInput）：usage-ctx.ts 定义 + pi/cursor/claude 三消费点 ✅
- 毛值直取（ctxTokensFromGrossInput）：usage-ctx.ts 定义 + codex 消费点 ✅
- 门控（ctxSupported / getProviderCaps）：ctx-usage-bar.tsx + session-panel-page.tsx 两调用点 ✅
- 守护（elevenKeys / EXPECTED_CAPS_KEYS len==11）：provider-registry.test.ts + alignment 命中 ✅
- 不伪造 0：三解析器 undefined 分支 + 反断言 not.toHaveProperty ✅

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（…）
- ✅ task-02: 同上 10 个测试文件
- ✅ task-03: 同上 10 个测试文件
- ✅ task-04: 同上 10 个测试文件
- ⚠️ task-05: 模块目录（sillyhub-daemon/src/interactive）递归未找到测试文件（含 co-located tests/）
- ✅ task-06: 8 模块目录 48 个测试文件
- ✅ task-07: 3 模块目录 8 个测试文件
- ✅ task-08: docs 目录 11 个文件
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断

语义标注：task-05 ⚠️ 是探针按 target_files=claude-events.ts 所在 src 目录递归找 co-located 测试的假阴性——该卡验收即「既有测试零改动全绿」（tests/interactive/claude-events.test.ts 13 passed + golden 6 passed 实跑回执），集成盲区无（行为零变化约束 + diff 仅 import+一行+注释）。断言有效性抽查：pi 1800 / cursor 15282·15418 / codex 12122 回放与 fixture/实捕数据算术一致（execute 审查已逐值核对）。

#### 探针 4：决策追踪覆盖
D-001@v1 → FR-01~07 → task-01~08 → 证据回指闭环（见下方决策追踪矩阵）✅

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 989 backend endpoints (live [scan-root 598 + worktree 598] + artifact 598), 0 frontend calls [scope: change-diff (21 files @ worktree)] | 207 backend endpoints unused by frontend
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 207 个后端端点前端未调用（warning 不阻断）

语义复核：0 frontend calls 变化 = REST DTO 零变化（design 兼容策略第 4 条达成）；207 未调用端点为既有存量 warning 非本变更引入。

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/*.md` 五文件（git 状态 D）
- ℹ️ 以 git 事实为准；是否 FAIL blocker 由 agent 诚实判定

语义判定：五文件是**并行会话**的 docs/sillyspec 归档移动（工作树 D + finished/ 下同名未跟踪 ??，会话起始 git status 即存在），非本变更产物、非本变更删除——判非 blocker，不随本变更提交（精确 pathspec 隔离）。

## 测试结果 [层：确定性检查——CLI 实测对账]

相关面合跑（全部 worktree 实跑，2026-09-13 07:36-07:37）：

- daemon vitest 8 套件：usage-ctx(9) + pi-events(28) + cursor-events(37) + codex-app-server-driver(42) + claude-events(13) + golden(6) + provider-registry + provider-adapter-registry = **148 passed / 0 failed**（exit 0）
- frontend vitest 2 套件：ctx-usage-bar(28，含 3 新增门控用例) + pre-session-picker(27) = **55 passed / 0 failed**（exit 0）
- backend pytest：test_provider_caps_alignment.py = **4 passed**（exit 0）
- 质量扫描：backend ruff check/format 两文件全过 + mypy app 939 文件 Success；frontend eslint 5 改动文件 0 error（3 warning 均既有未用参数）；daemon typecheck exit 0
- 全量测试：CLI --done 统一执行 local.yaml commands.test（结果由 CLI 对账）

known_failures：无。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03、FR-04、FR-05、FR-06、FR-07 | task-01、task-02、task-03、task-04、task-05、task-06、task-07、task-08 | FR-01→pi 28 测试+真机冒烟；FR-02→cursor 37 测试+fixture 真机采样；FR-03→codex 42 测试+实捕回放 12122；FR-04→三端生成逐值一致+双守护绿+抽键编译红由 satisfies 保证；FR-05→helper 9 测试+claude 零漂移（13+golden 6）；FR-06→前端 28 测试三分支；FR-07→QUICKLOG ql-20260913-002-a71d + Runtime Evidence 三回执 | 已闭环 |

## 技术债务 [层：人工判断]

- 探针 1 命中四处均为既有占位/文档示例（语义复核见上），本变更新增代码零 TODO/FIXME
- 遗留（execute 审查 P3，无行为风险）：codex driver 三处内联 `usage?: {...}` 类型注解仍四字段窄形态（运行时 AgentEventUsage 对象直传无影响），后续统一改用 AgentEventUsage 类型——已记入 review.json reviewerNotes
- 后续机会（QUICKLOG 已记）：codex 通知自带 `modelContextWindow`（950000）可作环分母精确派生真源（本次 NG-05 分母链不动）

## 变更风险等级 [层：人工判断]

integration-critical（design/plan 命中 daemon/backend/session/agent_run 关键词，未显式覆盖）。已按级别提供真实集成证据：真 daemon 启动（[daemon.started]，本变更全部改动模块进程内装载）+ 真 CLI 子进程数据过编译产物（codex/pi 两路）+ Runtime Evidence 章节。lease/heartbeat 命中为同句否定语境抑制（生命周期契约：无/N/A——零状态迁移改动）。

## Runtime Evidence [层：人工判断]

### 真实 daemon 启动（非 mock，本变更改动模块全装载）

- command: `SILLYHUB_DAEMON_DIR=%TEMP%/verify-ctx-usage/daemon-home node <worktree>/sillyhub-daemon/dist/cli.js start --api-key verify-dummy-key`
- 日志片段（daemon-home/daemon.log，2026-09-13）：

```
[2026-09-13 07:29:45.228] [daemon.starting] runtime_id=da6ccbd3-4847-4de2-85a4-f365ada3d83e
[2026-09-13 07:30:44.665] [daemon.agents_detected] agents=["claude","codex","opencode","openclaw","pi","cursor","kimi"]
[2026-09-13 07:30:47.775] [daemon.runtime_lock_acquired] providers=["claude","codex","opencode","openclaw","pi","cursor","kimi"]
[2026-09-13 07:31:28.511] [daemon.started] runtime_id=da6ccbd3-4847-4de2-85a4-f365ada3d83e
```

（backend fetch failed 为本地无 backend 的预期重试态，非启动失败，对齐 2026-09-12-provider-file-tx verify 口径；启动链装载 providers.ts INTERACTIVE_PROVIDERS——capsOf 模块加载守卫证明 11 键注册表自洽。受控停止：taskkill 本变更进程，未触碰并行会话 daemon。）

### 端到端 integration test（真 CLI 子进程，非 mock 进程）

1. **codex（非零值强证据）**：spike 脚本真机 spawn `codex app-server --listen stdio://`（codex-cli 0.147.0）跑单轮实捕 `thread/tokenUsage/updated`（last.inputTokens=12122）→ 将**实捕 JSON 行**回放进 worktree 编译产物 `dist/interactive/codex-app-server-driver.js` 的 `_extractTokenUsage` → usage_update 事件输出 `{"input_tokens":10906,"output_tokens":4,"cache_read_tokens":1216,"cache_creation_tokens":0,"ctx_tokens":12122}` —— **SMOKE-PASS**（毛值直取精确：12122 = last.inputTokens；净输入差分 12122-1216-0=10906 同帧自洽）
2. **pi（真机输出过归一化器）**：真机 `pi --mode json -p "用 Bash 执行 echo pi-ctx-smoke 并汇报输出"`（pi 0.81.1，真 Bash 工具调用轮，exit 0）→ 输出逐行过 `dist/interactive/pi-events.js` → turn_end usage 事件携带 `ctx_tokens: 0`（本轮 provider openai/gpt-5.5 无计量全零如实携带，口径 = Grill D-1）—— **SMOKE-PASS**（非零派生证据由 2026-09-04 真机采样 fixture 断言 1800 补强，见测试结果）
3. **cursor**：cursor-agent CLI 不在 PATH（daemon 探测经 VS Code 安装路径）；证据 = fixtures/cursor 五 ndjson 均真机 CLI 采样（README 实证）+ 37 单测精确断言（15282/15418 等与 fixture 算术一致）——集成证据等级：fixture 真机采样 + 单测，无平台级 e2e（见结论 notes）

### 生命周期终态断言

daemon 受控停止（kill 后 log 停止增长复核）；spike/回放脚本均 exit 0；无悬挂进程（本变更进程已 taskkill，并行会话 daemon 未触碰）。

## 代码审查 [层：人工判断]

- execute 阶段独立子代理审查（agent-tool 通道）：specVerdict=pass / qualityVerdict=pass，9 项 checklist 全过（FR 逐条 + 越权 + 测试一致性），21 文件零越权、fixture 零改动
- 发现→处置：P2 三引擎环百分比回执 → 本报告 Runtime Evidence 以真机分子派生证据 + 前端三分支 vitest 覆盖，平台级 e2e 留部署环境（对齐先例）；P3 内联类型注解窄形态 → 无行为风险记技术债
- QA 复核（主代理）：反断言抽查（not.toHaveProperty('ctx_tokens') 双路）、边界抽查（非法 last.inputTokens='NaN-ish' 用例、cursor 三分量全非法守卫）、生成幂等（两连跑逐字节一致）
