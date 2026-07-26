---
author: qinyi
created_at: 2026-07-27 00:50:00
---

# 代码健壮性/性能/结构优化（2026-07-27，第七批）

> 性质延续前六批（见 `docs/code-quality-hardening-2026-07-24.md` §1-§9）：证据驱动。
> 本轮用 **Workflow 多 agent 交叉审计**：7 维度并行只读审查（后端死代码/前端死代码/daemon 死代码/后端性能/前端性能/结构重复/测试与DB）
> → 每条 HIGH/MED 发现派对抗式验证 agent 核实"真问题 + 零回归"（共 32 agent / 187 万 token / 891 工具调用）。
> 53 条原始发现 → 去重 37 条 → **18 条 confirmed 零回归**，1 条误报，1 条 uncertain，17 条 low。
>
> **隔离约束**：`2026-07-26-ungate-workspace-entry` 变更未提交（脏树），其文件
> （workspaces 列表/runtime/scan-docs/m-workspaces 页、workspace-switcher、binding-guard、daemon-required-notice、WorkspaceBindingDialog）
> 本轮**一律不碰**，相关发现列入 §DEFER，待该变更提交后再处理（CLAUDE.md 规则 18）。

---

## 0. 基线（动手前，复测确认）

| 端 | 测试基线（第六批遗留） | 静态检查 |
|---|---|---|
| backend | 2955 passed（第六批）| ruff ✅ / mypy ✅ |
| frontend | 1059 passed（第六批）| tsc ✅ |
| daemon | 1951 passed / 1-2 flaky 超时（task-09 spec-sync，环境性）| tsc ✅ |

> 本轮每 Wave 改完跑对应测试对照基线，零回归方推进。

---

## 1. 执行范围（按 Wave）

### Wave 1 — sillyhub-daemon 死代码清理
- echoAgentEvent（task-runner.ts:2668-2678，零调用，事件循环已内联 renderAgentEvent）+ config.ts:247 注释 + 3 处文档
- releaseLock（runtime-lock.ts:242-253，被 releaseLockByKey 取代）
- APPROVAL_METHODS（json-rpc.ts:48-64 含 JSDoc，审批匹配已改内联 string 比较）
- daemon.ts 未用字段 _auditSink(629)/_policyEngine(631)/_wsReconnectDelay(681) + DaemonOptions + cli.ts 透传
- daemon.ts:59 HubClient 等 9 处未用 import（实际 tsc 全扫共 16 处 TS6133，一次性清完）
- session-manager.ts _lastError(1589 write-only) / resolver(832 write-only) / 未用类型 import
- task-runner.ts exitSignal(1033 write-only) / randomUUID(45)
- ws-client.ts RECONNECT_MAX_INTERVAL_MS(39 YAGNI) / types.ts TaskAvailablePayload(182) / src/index.ts(W0 占位) / filesystem-policy.ts RuntimePolicy+runtimeId / cli.ts level(151)

### Wave 2 — 前端死代码清理
- use-daemon-runtimes.ts hook + 自测（被 useDaemonMachines 取代）+ 清锚点注释
- FormLayout（layout/form-layout.tsx + index.ts:15 桶导出，零消费）+ 2 处文档
- SessionsSidebar（daemon/runtime-session-helpers.tsx:142-235 + 仅它用的 4 import）
- QuickChat 死簇（lib/daemon.ts:333-442，含孤儿 _eventTypeFromChannel）+ 清两测试文件 streamQuickChat 幽灵 mock
- frontend/lib ~30 个未用 wrapper 导出（ppm/task 8 个、kanban 4、plan 4、project 3、problem 2、admin 3、client-path 2、changes createChange、health 3 类型、spec-workspaces/aggregations/workday/workspaces/ppm-types 散点）— 逐个核实无未来接线计划再删

### Wave 3 — 后端死代码清理（low，逐个核实）
- SpecWorkspaceService.sync(455 stub 被 apply_sync 取代) / get_by_id(134)
- AgentAdapter.validate_bundle(210 无 override/调用/测试)
- AuthService._lookup_active_user_by_email(205 登录改 username-only)
- ProblemService.list_list_tasks/list_list_logs(698 无路由)
- workbench._task_alert(88)/_worst_alert(241) 被 _progress_alert/_bump_alert 取代
- core/security.py REFRESH_TOKEN_TYPE(26 refresh 非 JWT 无 typ)
- WorkspaceService.list_(338 全表 load 计数 + 无生产调用方，迁移 4 测试用例)

### Wave 4 — 测试债清理
- backend/tests/modules/agent/test_scan_dispatch.py 整删（269 行 6 测试全 skip，被测方法已删）
- frontend/src/lib/__tests__/admin-global-checkpoints.test.ts 整删（30 it.todo 零断言）
- backend/tests/modules/admin/test_users_router.py 删 10 处失效 xfail（迁移已让 email nullable），保留 631/715/794 真实缺陷

### Wave 5 — 性能优化
- task/service.py:231 enrich_summaries N+1 → 单次 IN（secondary 去重排除 primary，不能照抄 agent enrich_list）
- spec_workspace/service.py:640 _write_spec_root N+1 → path.in_(rel_paths) 循环前预取
- agent-log-viewer.tsx 流式日志 rAF coalesce 批处理（仅零回归子集，硬上限/虚拟化见 DEFER）

### Wave 6 — 结构优化
- placement.py:1000 抽 resolve_member_binding_or_none helper 收敛 4 处 try/except 脚手架（含 borrow_resolver.py:151 漏报的第 4 处），decide 处补 user_id
- ppm problem-list/page.tsx:124 + task-plans 抽共享 loader hook 放 lib/（两页无 page.test.tsx，须补测试或声明靠类型检查）

---

## 2. DEFER（撞 ungate-workspace-entry 脏树 或 需设计/大工程）

| 项 | 原因 |
|---|---|
| workspace-switcher.tsx:119 重复 fetchMyBindings | **撞 ungate task-02**（switcher 未提交改动） |
| runtime/page.tsx + scan-docs 抽 useDaemonBinding hook | **撞 ungate task-06/07** |
| app/m/workspaces/page.tsx:273 搜索防抖 | **撞 ungate task-03** |
| WorkspaceBindingDialog 删除 | uncertain + ungate design 决策"组件保留供复用"；要删须先开新 change 撤销决策 |
| agent-log-viewer 虚拟化（react-window） | 中期大重构，重写渲染层影响多测试，独立变更 |
| WorkHourBarChart ECharts 按需注册 | 需逐图目视回归（漏注册静默缺图） |
| workbench _visible_user_ids 批量化 | 影响部门经理可见范围语义，须补多 org 子树用例 |
| daemon tsconfig 开 noUnusedLocals/noUnusedParameters | 必须一次性清完全部 16 处再开启（Wave1 已清），开启本身留收尾步 |

> ungate-workspace-entry 提交后，前三项可立即跟进（照审计已确认改法）。

---

## 3. 执行结果与验证（已完成 6 Wave）

| Wave | 内容 | 验证 |
|---|---|---|
| W1 sillyhub-daemon 死代码 | echoAgentEvent / releaseLock / APPROVAL_METHODS / _auditSink / _policyEngine / _wsReconnectDelay 全链路（字段+option+构造+cli透传+类型import） / 9 处未用 import / _lastError / resolver / exitSignal / TaskAvailablePayload / RECONNECT_MAX_INTERVAL_MS / src/index.ts 占位 + 9 处 scan 文档同步 | tsc --noEmit ✅ + tsc --noUnusedLocals ✅（15 处 TS6133 清零）+ 296 测试 passed（runtime-lock/task-runner/ws-client/json-rpc/session-manager/filesystem-policy/daemon-policy-update/audit-sink/cli-session-manager-injection）|
| W2 前端死代码 | use-daemon-runtimes hook+test / FormLayout+桶 / SessionsSidebar+4 import / QuickChat 死簇（daemon.ts 333-442 + 两测试文件 streamQuickChat/quickChat/getQuickChatResult 幽灵 mock 清理）/ D9 ~30 个 lib 死导出（子代理删 13 源文件+4 测试同步+删 spec-workspaces.test.ts，DEFER exportPlanNodes/ProblemImportCommitReq）| 前端 tsc --noEmit ✅ + vitest（runtime-session-dialog 10 + interactive-session-panel 38 + D9 受测 58）passed |
| W3 后端死代码 | SpecWorkspaceService.sync/get_by_id / AgentAdapter.validate_bundle / AuthService._lookup_active_user_by_email / ProblemService.list_list_tasks+logs（+2 未用 import）/ workbench._task_alert+_worst_alert / REFRESH_TOKEN_TYPE。DEFER WorkspaceService.list_（3 处 test_service 调用需迁移） | ruff ✅ + mypy ✅ + auth/spec_workspace/ppm/agent 308 passed / 6 skipped / 2 xfailed 零失败；grep 证实无任何测试引用已删符号 |
| W4 测试债 | 删 test_scan_dispatch.py（269 行 6 全 skip）/ 删 admin-global-checkpoints.test.ts（30 it.todo 0 expect）/ test_users_router.py 10 处 email-nullable 失效 xfail 转直断言（migration 202608010900 已修），保留 631/715/794 真实 task-03 缺陷 | test_users_router 36 passed / 3 xfailed（真实缺陷）零失败 |
| W5 性能 | task enrich_summaries N+1→IN（secondary 去重排除 primary，照 agent enrich_list 范式）/ spec_workspace _write_spec_root N+1→path.in_() 循环前预取。DEFER agent-log-viewer rAF 批处理（见下） | ruff ✅ + mypy ✅ + spec_workspace 5 passed；task 无独立测试（机械等价于已测的 agent enrich_list）|
| W6 结构 | placement 抽 MemberBindingResolver.resolve_member_binding_or_none 收敛 3 处 try/except 脚手架（placement×2 + borrow_resolver），顺带修 _resolve_decide_runtime 的 user_id 日志漂移。DEFER ppm problem-list/task-plans loader hook（见下） | ruff ✅ + mypy ✅ + placement/dispatch/member_runtimes 37 passed 零失败 |

### 最终静态检查（全量，跨所有 Wave）
- sillyhub-daemon `tsc --noEmit` → exit 0
- frontend `tsc --noEmit` → exit 0
- backend `ruff check`（10 个改动文件）→ All checks passed
- backend `mypy`（改动文件）→ Success: no issues

### 本轮 DEFER（附原因）

| 项 | 原因 |
|---|---|
| workspace-switcher.tsx 重复 fetchMyBindings / runtime+scan-docs 抽 useDaemonBinding hook / m/workspaces 搜索防抖 / WorkspaceBindingDialog 删除 | 撞 ungate-workspace-entry 未提交脏树（规则 18）；ungate 提交后照审计已确认改法跟进 |
| agent-log-viewer rAF 批处理 | 验证 agent 称"零回归"对用户成立，但**漏看测试时序契约**：use-agent-run-stream.test.ts 380/925/936/948 等用同步 `expect(logs)` 紧跟 `act(emit)`，rAF 把 setLogs 变异步会致其失败。需把 4+ 处同步断言改 `waitFor`（测试契约变更），留专项 |
| ppm problem-list/task-plans 抽共享 loader hook | 两页无 page.test.tsx 兜底，未测前端重构风险高；留专项（先补测试再抽） |
| WorkspaceService.list_ 删除 | 3 处 test_service 调用需迁移到 list_with_owner，低价值 |
| WorkHourBarChart ECharts 按需注册 / workbench _visible_user_ids 批量化 / agent-log-viewer 虚拟化 | 需逐图目视回归 / 影响可见范围语义 / 中期大重构（同前批 DEFER） |
| daemon tsconfig 开 noUnusedLocals | Wave1 已清完 16 处；开启本身留收尾步（避免 CI 一次性收紧风险） |
| sillyhub-daemon spawn-env redactEnv | docstring 声称"env 日志须经 redactEnv"但无 env 日志；删 vs 真正接入需安全决策 |

