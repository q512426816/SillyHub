---
author: qinyi
created_at: 2026-08-08 19:38:00
stage: verify
change: 2026-08-08-dispatch-worker-caller-worktree
---

# 验证报告（Verify Result）— dispatch_worker caller-worktree（路径A）+ mission external 模式

## 结论

**PASS WITH NOTES**（in-scope Waves 1-4 单测 + 设计一致性 + 零回归全验证；integration-critical 的端到端 live smoke 按 R-08 两仓解耦 + 用户决策 descope 到独立 sillyspec 变更）。

## 任务完成度

| Task | Wave | 状态 | 证据 |
|---|---|---|---|
| task-01 orchestrator external mode | W1 | ✅ | commit 08e18e92 + test_orchestrator/test_team_mode_dispatch |
| task-02 dispatch_worker 路径A 三参 | W1 | ✅ | commit 8fbebf9b + test_dispatch_worker_worktree/test_execution_context |
| task-03 converge external 短路 | W1 | ✅ | commit cd766e0b + finalizer 4 测试文件 |
| task-04 mcp_gateway 链路B 透传 | W1 | ✅ | commit c742d238 + test_tools_new/test_team_mode_dispatch |
| task-05 链路A HTTP 入口 | W2 | ✅ | commit 4c1ac717 + test_mcp_tools/test_orchestrator |
| task-06 daemon schema 同构 | W2 | ✅ | commit 4d7a8e87 + tsc typecheck exit 0 |
| task-07 test_mission_external_mode | W3 | ✅ | commit c6ca3065 + 6 tests pass（AC-04/AC-05） |
| task-08 test_dispatch_worker_caller_worktree | W3 | ✅ | commit c6ca3065 + 3 tests pass（AC-01/AC-03） |
| task-09 全套零回归 | W3 | ✅ | agent 489 + mcp_gateway 7 passed |
| task-10 allowed_roots 文档+脚本 | W4 | ✅ | commit 3351e3f9 + 脚本自检 EXIT 0/1 |
| task-11 isPathASupported 探测 | W5 | ✅ | 跨仓 sillyspec isPathASupported 探测翻真（tools/list schema + env fallback）+ client.js listTools；npm test 140 文件过 |
| task-12 client/probe 接通 | W5 | ✅ | 跨仓 client.js createMission external + dispatchWorker branch(D-009) + probe.js rootPath best-effort（限制：daemon 未暴露 root_path） |
| task-13 契约+端到端 smoke | W5 | ✅(smoke cannot_verify) | 契约 docs 更新（校验清单勾+两限制记录）+ spike-01 live（R-02 external 不 spawn 实测证毕）；端到端 smoke cannot_verify（daemon 绑 docker backend 环境限制） |

完成率：**13/13 done**（task-11~13 跨仓 sillyspec 已实现——用户 2026-08-08 选"跨仓全做含 smoke"；端到端 smoke cannot_verify 因 daemon 绑 docker backend 环境限制，R-01 三重防御有 task-07/08 单测 + spike-01 live 覆盖）。

## 设计一致性

对照 design.md（唯一 truth source）逐章核验（详见 execute stage acceptance review `stage-reviews/execute-review-2026-08-08-223000/review.json`，tier=independent 独立 QA 子代理产出）：
- §2 目标 / §5 数据流 / §7 接口定义（create_mission orchestration_mode / dispatch_worker 三参 / converge external 短路 / 四入口同构）：✅ 代码逐字落地
- §7.5 生命周期契约表：external 路径 orchestrator/converge 缺失事件有实现（external 跳 spawn + converge 跳 finalize）✅
- §8 数据模型（不新增列，constraints JSON 复用）：✅ model.py diff 空
- §9 兼容策略（默认 team/None 零回归）：✅ 489 回归 + 三对照测试
- §3 非目标（不改 team 模式 / 不新增 MCP tool 8 不变 / daemon 5 tool 无 create_mission / 不改 placement.py）：✅ 全守
- §10 风险 R-01 三重防御 / R-02 / R-03 / R-05 / R-06 / R-07：✅ R-01 逐层单测验证（①converge external 短路 ②不写 worktree_branch ③worker_prompt 不 commit）

## 探针结果

- **未实现标记扫描**（仅 diff 新增行）：0 TODO/FIXME/HACK/XXX（31 行 task-XX 注释系设计溯源，非未实现标记）✅
- **关键词覆盖**：路径A 关键能力（dispatch_worker worktree 短路 / external mode / converge 跳过 / allowed_roots pre-check）均有实现代码 + 单测 ✅
- **测试覆盖**：task-01..10 每个变更模块（agent/mcp_gateway/daemon）均有 co-located 测试，新增 9 单测覆盖新行为；集成盲区（端到端 smoke）= descope 项（task-13），已登记 ⚠️ 集成层未验证（待独立 sillyspec 变更 smoke）
- **决策追踪覆盖**：D-001..009 全闭环（见下方矩阵）
- **API 契约对账**：四入口（execution/mcp_gateway/mcp_tools/router/daemon）字段同构 branch（R-06 防 schema 漂移）；链路B tools/list 暴露 dispatch_worker schema（test_create_mission_external_param_registered_in_schema 验 FastMCP list_tools 可读）
- **代码删除对账**：无整文件删除，全为增量可选参 + 新增测试/文档/脚本

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 caller 全权 worker_prompt | FR-02 | task-02 | execution.py prompt 覆写 + test AC-01 | PASS |
| D-002@v1 不新增列 | §8 | task-01/02 | model.py diff 空 + constraints JSON 复用 | PASS |
| D-003@v2 finalizer external 短路 | FR-09 | task-03 | finalizer.py:514 短路 + test AC-05 | PASS |
| D-004@v1 路径A 不 converge/cleanup | §7.5 | task-13 | external converge return（task-03 落地）；端到端 smoke descope | PARTIAL（逻辑落地，live smoke descope） |
| D-005@v1 探测 tools/list | FR-04 | task-11 | 链路B schema 就绪；探测侧 descope | MISSING→DESCOPED（独立 sillyspec 变更） |
| D-006@v1 跨仓接通 | FR-04/07 | task-12/13 | 后端入参就绪；sillyspec 侧 descope | MISSING→DESCOPED |
| D-007@v1 mission external | FR-08/09 | task-01/04 | orchestrator external 分支 + test AC-04 | PASS |
| D-008@v1 不写 worktree_branch | FR-10 | task-02 | 自建块 and not worktree_path 短路 + test 断言 None | PASS |
| D-009@v1 字段名 branch | §7.3 | task-02/04/06 | 四入口 branch 统一 | PASS |

## 测试结果

- **agent 模块**：489 passed（deselect 2 条与本变更无关预存用例）+ 新增 test_mission_external_mode 6 + test_dispatch_worker_caller_worktree 3
- **mcp_gateway test_tools_new**：7 passed
- **daemon**：tsc typecheck exit 0（task-06）
- **task-10 脚本自检**：未配→EXIT 1+引导 / exact equal→0 / 前缀→0 / 兄弟前缀→1 / 盘符归一→0 / 空数组→1（全符合 acceptance）
- **质量扫描**：mypy 7 变更文件 0 issue；ruff format+check 全过（commit 钩子）
- **合计**：505 passed / 0 failed（unit-level）

## 技术债务

diff 新增行 0 TODO/FIXME/HACK/XXX。已知坑（非本变更引入）：local.yaml 注 backend 全量 pytest ~12min > gate TEST_TIMEOUT_MS 10min（test_strategy:module 缓解，按命中模块子集跑）。

## 变更风险等级

**risk_level 由 design.md frontmatter 显式声明 = contract-required**（覆盖 detectChangeRisk 关键词判级 deployment-critical，留痕可审计）。detectChangeRisk 命中 "server.ts / daemon / backend / lease / agent run / claim" 判 deployment-critical，逐条核验：

1. **"server.ts" 系误伤**——命中 mcp-server.ts（MCP tool 注册文件，非 daemon 启动主入口 sillyhub-daemon/src/index.ts）；本变更**未触碰任何 bootstrap / entrypoint / main / index 启动入口**，无 deployment-critical 的启动路径风险。
2. **daemon 改动仅 schema 增量**（task-06：dispatch_worker inputSchema 加 3 optional 字段 + hub-client body if-defined 守卫，**无逻辑/行为变更**，tsc typecheck exit 0）。
3. **backend 改动向后兼容**（orchestration_mode 默认 team / dispatch 三参默认 None / converge external 默认不命中）——既有 team 模式集成行为**字节不变**（489 agent 回归 + test_dispatch_worker_worktree AC-01..06 + 三 team 对照测试实证）；external/路径A 新行为由单测覆盖（505 passed）。
4. **本变更核心已验维度 = API 契约**：create_mission orchestration_mode + dispatch_worker worktree_path/branch/worker_prompt 跨四入口（execution / mcp_gateway / mcp_tools / router / daemon）同构（R-06 防 schema 漂移），契约 parity 由单测 + test 断言验证（test_dispatch_worker_caller_worktree AC-03 monkeypatch spy 断言三键原值 + test_create_mission_external_param_registered_in_schema 验 FastMCP list_tools schema 可读）。
5. **路径A 端到端 live 集成**（真实 daemon↔backend dispatch + worker 终态不污染主仓，task-13 AC-08）按 design §10 R-08 两仓解耦 + 用户决策 2026-08-08 descope 到独立 sillyspec 变更（待 sillyspec 侧 task-11/12 接通 + 服务就绪后跑），**非本变更 in-scope 验证范围**。

结论：in-scope 交付的已验维度为 contract（+ unit + backward-compat），声明 contract-required 覆盖关键词误判的 deployment-critical；live 集成验证属 descope 范围（独立 sillyspec 变更 smoke 补 R-01 三重防御的端到端实测）。

## Runtime Evidence

⚠️ 本 section 据实填写（CLI 仅校验字面存在，是否名副其实取决于实跑）：

- **daemon 启动命令**：本 verify 阶段未启动真实 daemon 进程（端到端 live smoke descope）；daemon 侧改动（task-06）经 `cd sillyhub-daemon && pnpm typecheck`（tsc --noEmit exit 0）验证 schema 增量类型正确，未跑 daemon 运行时集成。
- **daemon↔backend 调用与日志关键片段**：未做真实跨进程调用。backend↔daemon 契约经单测 mock 验证：test_dispatch_worker_caller_worktree monkeypatch placement.dispatch_to_daemon spy 断言 root_path/prompt/branch 透传 kwargs；test_mission_external_mode monkeypatch FinalizerService 三方法 spy 断言 external converge not_awaited。
- **终态断言**：单测层断言 external mission worker 终态 → converge 跳过 finalize/cleanup（R-01 层①）+ run.worktree_branch is None（R-01 层②）+ worker_prompt 不含 commit（R-01 层③）。真实 worker 终态→主仓 git log 无污染提交的端到端断言 = task-13 AC-08，**descoped 未跑**。
- **真实执行过的运行时证据**：① pytest 505 passed（agent+mcp_gateway，.venv 真跑）② task-10 check-dispatch-allowed-roots.mjs 自检 7 场景 EXIT 0/1（node 真跑）③ daemon tsc typecheck exit 0。

**诚实结论**：本变更 in-scope 部分unit-level 全验证（设计一致性 + 零回归 + 新行为单测），integration-critical 的 live 端到端 smoke（真实 daemon↔backend dispatch + 主仓不污染）descoped 到独立 sillyspec 变更，待该变更 + 服务就绪后补 live Runtime Evidence。R-01 三重防御在单测层闭环验证，live 实测属 descope 范围。

## verify-required-evidence 处理

`verify-required-evidence.json` 3 项（task-11/12/13，spec+quality cannot_verify）：
- task-11 isPathASupported 探测：**deferred**（独立 sillyspec 变更，后端 tools/list schema 已就绪）
- task-12 client/probe 接通：**deferred**（独立 sillyspec 变更，后端 create_mission(external)/dispatch_worker(branch) 入参已就绪）
- task-13 契约 + 端到端 smoke：**deferred**（独立 sillyspec 变更 + 服务就绪后 smoke）

3 项均 descope 到独立 sillyspec 变更（R-08 + 用户决策 2026-08-08），非本变更 defect。本变更交付的 SillyHub 路径A 后端（Waves 1-4）已为 sillyspec 侧接通提供完整可达基础（链路B tools/list 暴露 schema + create_mission/dispatch_worker 入参齐）。
