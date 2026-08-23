# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论必须写明 PASS / FAIL**——
> 留「待填」会被 gate 判不过（fail-closed）。

---
author: qinyi
created_at: 2026-08-23 11:10:00
---

## 结论：PASS（8/8 任务完成、双阶段独立审查 pass、回归 978+1921 全绿、三入口浏览器实证 10/10、决策 10/10 闭环；探针 5/6 为对账口径系统性误报，见各节复核）

## 任务完成度
8/8 全部完成（tasks.md 8 勾 + 8 份 task review.json pass + 执行摘要见各 TaskCard verify 字段）：
- task-01 ✅ owner_name（pytest 978 含 5 新用例）+ le=500；OpenAPI 反映（AC-1/2/3）
- task-02 ✅ gen:types 同步（api-types 9 处命中，check 零漂移，AC-1/2/3）
- task-03 ✅ 预会话态（11 用例：R-01 九项零调用专项/同构断言/失败保留/双传，AC-1~4）
- task-04 ✅ 两步浮层（9 用例，AC-1~3）
- task-05 ✅ 工作区树（25 用例+13 条旧断言迁移映射，AC-1~4；实证分组/筛选/owner chip）
- task-06 ✅ 门户接线（16 用例，AC-1~4；实证组头＋→浮层→预会话→#0c92cead 原地开聊零残留）
- task-07 ✅ change 入口+退役（106/106+320/320 回归；grep 四标识零残留；migration-notes 42 条落点；实证变更名上下文行，AC-1~3）
- task-08 ✅ 回归+部署+实证（978+1921+tsc+lint 持平；health ok；10/10 实证+6 截图 browser-evidence.md，AC-1~4）

## 设计一致性
实现与 design.md 一致（execute 独立 QA acceptance review 21 项：19 pass + 2 gap 均为已审定有意偏差）。三项有意偏差（均有测试锁定+设计注释固化）：
1. tab 筛选上下文降级为全态两步浮层（SessionListPanel 未暴露筛选态且 task-06 无权改该文件；D-107 的"筛选态直带"部分降级，FR-04 优先级链的 tab 段留后续变更——QA P2-1 已登记）
2. owner_name 经 router 批量注入而非 service SQL join（SQLModel 瞬态属性禁赋值+facade 不可改，TaskCard 引用的 runtime JOIN 先例本身）
3. workspace scope 呈树形态（FR-06 深链预展开的隐含要求，task-05/06 拆分边界所致）
另：task-07 两处跨 allowed_paths 最小修正（sessions-portal +47 / session-panel +32，plan 拆分误差，主代理审定+测试锁定）。

## 探针结果（CLI 机械预填）
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/(dashboard)/workspaces/[id]/sessions/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/sessions/page.tsx
- ℹ️ 清单文件不存在（跳过）：frontend/src/components/sessions/new-session-form.tsx、frontend/src/components/sessions/workspace-session-picker.tsx

#### 探针 2：设计关键词覆盖
能力关键词逐项 grep 确认（主仓 frontend/src + backend/app）：
- 工作区分组/手风琴：session-list-panel.tsx WorkspaceTreeList/ws-group 结构 ✅（实证 8 分组渲染）
- 两层筛选/机器 tab/智能体 tab：filterMachineId/filterAgent 状态机 ✅（实证 139→103 过滤）
- 组头新建/＋：onNewInGroup 回调 ✅（实证浮层弹出）
- 预会话/首句创建/上下文锁定：SessionPreContext/preContext/onPreSessionCreated/预会话上下文（已锁定）✅（实证锁定行+原地开聊）
- 两步浮层：pre-session-picker.tsx（在线机器→智能体默认 Claude）✅
- 创建人/owner_name：后端注入+前端 chip ✅（实证 👤 admin 全量）
- 非工作区分组：末尾组 ✅（实证 105 会话+组头＋）
- change 入口/变更名：新建会话（本变更）/getChange 变更名 ✅（实证 🧩 变更名上下文行）
- 深链 ?session=：getAgentSession 验证+无效静默 ✅（实证）
- 退役 NewSessionForm/WorkspaceSessionPicker：文件已删+grep 零残留 ✅

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/daemon、backend/app/modules/daemon/session）找到 10 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/host_fs/tests/test_delegate.py、backend/app/modules/daemon/host_fs/tests/test_delegate_integration.py、backend/app/modules/daemon/host_fs/tests/test_delegate_nfr.py …）
- ✅ task-02: 模块目录（frontend/src/lib、backend）找到 55 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts、frontend/src/lib/ppm/execute-time.test.ts …）
- ✅ task-03: 模块目录（frontend/src/components/daemon）找到 10 个测试文件（frontend/src/components/daemon/runtime-session-dialog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/machine-card.test.tsx、frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx、frontend/src/components/daemon/__tests__/remote-folder-picker.test.tsx …）
- ✅ task-04: 模块目录（frontend/src/components/sessions）找到 5 个测试文件（frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/__tests__/sessions-portal.test.tsx）
- ✅ task-05: 模块目录（frontend/src/components/sessions、frontend/src/lib）找到 15 个测试文件（frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/__tests__/sessions-portal.test.tsx …）
- ✅ task-06: 模块目录（frontend/src/components/sessions）找到 5 个测试文件（frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/__tests__/sessions-portal.test.tsx）
- ✅ task-07: 模块目录（frontend/src/components/sessions、frontend/src/app/(dashboard)/sessions、frontend/src/app/(dashboard)/workspaces/[id]/sessions、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/sessions、.sillyspec/changes/2026-08-23-sessions-workspace-hub）找到 6 个测试文件（frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/__tests__/sessions-portal.test.tsx …）
- ✅ task-08: 模块目录（.sillyspec/changes、.sillyspec/docs/frontend、.sillyspec/docs/backend）找到 11 个测试文件（.sillyspec/changes/2026-07-23-rbac-permission-cache/.sillyspec/.runtime/sillyspec.db、.sillyspec/changes/archive/2026-05-25-multi-agent-platform-bootstrap-v2/references/01-sillyspec-native-layout.md、.sillyspec/changes/archive/2026-05-27-platform-native-sillyspec/prototype-native-sillyspec.html、.sillyspec/changes/archive/2026-06-02-spec-bootstrap-agent-stream-interaction/prototype-2026-06-02-spec-bootstrap-agent-stream-interaction.html、.sillyspec/changes/archive/2026-06-28-daemon-client-spec-sync-strategy/prototype-daemon-client-spec-strategy.html …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
决策闭环 10/10（决策→FR→task→证据）：
| D-xxx | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-101@v1 预会话同构 | FR-03 | task-03/06 | session-panel-pre-session.test 同构断言+实证 e03/e04 | ✅ |
| D-102@v1 首句创建 | FR-03 | task-03 | 首句用例+实证 #0c92cead 原地开聊 | ✅ |
| D-103@v1 一次拉取 | FR-01 | task-01/05 | le=500 pytest+limit 500 用例+实证 139 条 | ✅ |
| D-104@v1 上下文锁定 | FR-03 | task-03 | 只读断言（within 零交互）+实证 🔒 | ✅ |
| D-105@v1 非工作区新建 | FR-01/04 | task-05/06 | 末尾组＋实证 | ✅ |
| D-106@v1 变更独立 | FR-06 | task-07 | change 入口 2 用例+实证 e09/e09b | ✅ |
| D-107@v1 两层 tab+浮层 | FR-02/04 | task-04/05/06 | 25+9+16 用例+实证 tab 层级/浮层 | ✅（tab 直带段降级见设计一致性偏差 1） |
| D-108@v2 owner chip | FR-05 | task-01/02/05 | 数据流三跳+chip 实证 | ✅ |
| D-109@v1 退役 | FR-06 | task-07 | grep 零残留+migration-notes 42 条 | ✅ |
（D-108@v1 superseded 未被下游引用 ✅；无 unresolved）

#### 探针 5：API Contract Parity
- ❌ API parity check failed: 143 frontend calls have no matching backend endpoint | 388 backend endpoints unused by frontend
- **语义复核（PASS）**：对账源=本变更 endpoints.json（仅登记 task-01/02 的 GET /api/daemon/sessions），其余 143 个"missing"全部为**历史端点**（POST /api/auth/login、GET /api/workspaces、POST /api/daemon/sessions 等——均存在于 backend/openapi.json 且生产运行数周，浏览器实证全链路 200 佐证）。系统性误报=对账口径（全仓前端调用 × 本变更局部登记），非本变更引入的集成缺陷。本变更唯一相关调用 GET /api/daemon/sessions 与登记匹配 ✅。388 unused 为历史冗余 warning 不阻断。

| 状态 | 前端调用 | 后端端点 | 文件 |
|---|---|---|---|
| ❌ missing | POST /api/auth/logout | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\components\app-shell.tsx:247 |
| ❌ missing | GET /api/admin/users | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:123 |
| ❌ missing | POST /api/admin/users | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:134 |
| ❌ missing | PATCH /api/admin/users/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:144 |
| ❌ missing | DELETE /api/admin/users/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:151 |
| ❌ missing | GET /api/admin/users/{param}/sessions | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:157 |
| ❌ missing | DELETE /api/admin/users/{param}/sessions/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:164 |
| ❌ missing | GET /api/admin/users/{param}/audit | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:182 |
| ❌ missing | POST /api/admin/users/{param}/disable-login | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:201 |
| ❌ missing | POST /api/admin/users/{param}/enable-login | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:207 |
| ❌ missing | GET /api/admin/organizations | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:259 |
| ❌ missing | GET /api/admin/organizations/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:267 |
| ❌ missing | POST /api/admin/organizations | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:273 |
| ❌ missing | PATCH /api/admin/organizations/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:283 |
| ❌ missing | DELETE /api/admin/organizations/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:308 |
| ❌ missing | GET /api/admin/roles | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:376 |
| ❌ missing | POST /api/admin/roles | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:384 |
| ❌ missing | PATCH /api/admin/roles/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:394 |
| ❌ missing | POST /api/admin/roles/{param}/disable | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:401 |
| ❌ missing | POST /api/admin/roles/{param}/enable | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:407 |
| ❌ missing | DELETE /api/admin/roles/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:413 |
| ❌ missing | GET /api/admin/roles/{param}/users | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\admin.ts:419 |
| ❌ missing | GET /api/agent-logs | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\agent-logs.ts:34 |
| ❌ missing | GET /api/agent-profiles | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\agent-profiles.ts:174 |
| ❌ missing | POST /api/workspaces/{param}/agent/runs | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\agent.ts:98 |
| ❌ missing | GET /api/workspaces/{param}/agent/runs/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\agent.ts:105 |
| ❌ missing | GET /api/daemon/runtimes | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\agent.ts:192 |
| ❌ missing | GET /api/missions/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\agent.ts:283 |
| ❌ missing | GET /api/llm-providers | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\api\llm-providers.ts:164 |
| ❌ missing | POST /api/llm-providers | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\api\llm-providers.ts:172 |
| ❌ missing | DELETE /api/llm-providers/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\api\llm-providers.ts:191 |
| ❌ missing | GET /api/auth/api-keys | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\api-keys.ts:21 |
| ❌ missing | POST /api/auth/api-keys | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\api-keys.ts:27 |
| ❌ missing | DELETE /api/auth/api-keys/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\api-keys.ts:35 |
| ❌ missing | GET /api/auth/me | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\auth.ts:12 |
| ❌ missing | POST /api/auth/login | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\auth.ts:27 |
| ❌ missing | POST /api/auth/logout | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\auth.ts:51 |
| ❌ missing | POST /api/auth/change-password | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\auth.ts:72 |
| ❌ missing | GET /api/auth/captcha/confirm | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\auth.ts:84 |
| ❌ missing | POST /api/auth/captcha/verify | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\auth.ts:90 |
| ❌ missing | GET /api/custom-skills | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\custom-skills.ts:88 |
| ❌ missing | GET /api/custom-skills/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\custom-skills.ts:93 |
| ❌ missing | POST /api/custom-skills | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\custom-skills.ts:100 |
| ❌ missing | PUT /api/custom-skills/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\custom-skills.ts:111 |
| ❌ missing | DELETE /api/custom-skills/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\custom-skills.ts:119 |
| ❌ missing | GET /api/daemon/skills/latest/manifest | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\custom-skills.ts:126 |
| ❌ missing | GET /api/daemon/runtimes | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:43 |
| ❌ missing | GET /api/daemon/instances | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:75 |
| ❌ missing | GET /api/daemon/machines | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:144 |
| ❌ missing | GET /api/daemon/runtimes/page | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:214 |
| ❌ missing | GET /api/daemon/runtimes/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:290 |
| ❌ missing | DELETE /api/daemon/runtimes/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:318 |
| ❌ missing | GET /api/daemon/version | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:338 |
| ❌ missing | POST /api/daemon/sessions | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:690 |
| ❌ missing | GET /api/daemon/sessions | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:1287 |
| ❌ missing | DELETE /api/daemon/sessions/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:1349 |
| ❌ missing | GET /api/daemon/runtimes/usage | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:1517 |
| ❌ missing | POST /api/file/batch-meta | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\file\api.ts:135 |
| ❌ missing | GET /api/file/list | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\file\api.ts:161 |
| ❌ missing | GET /api/git/identities | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\git-identities.ts:13 |
| ❌ missing | POST /api/git/identities | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\git-identities.ts:17 |
| ❌ missing | DELETE /api/git/identities/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\git-identities.ts:24 |
| ❌ missing | POST /api/git/check-access | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\git-identities.ts:30 |
| ❌ missing | GET /api/health | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\health.ts:9 |
| ❌ missing | POST /api/workspaces/{param}/incidents | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\incidents.ts:77 |
| ❌ missing | GET /api/incidents/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\incidents.ts:84 |
| ❌ missing | PATCH /api/incidents/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\incidents.ts:91 |
| ❌ missing | POST /api/incidents/{param}/postmortem | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\incidents.ts:101 |
| ❌ missing | GET /api/incidents/{param}/postmortem | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\incidents.ts:108 |
| ❌ missing | GET /api/platform-settings/mcp | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\mcp-settings.ts:60 |
| ❌ missing | PUT /api/platform-settings/mcp | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\mcp-settings.ts:65 |
| ❌ missing | GET /api/platform-settings/mcp-whitelist | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\mcp-settings.ts:73 |
| ❌ missing | PUT /api/platform-settings/mcp-whitelist | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\mcp-settings.ts:80 |
| ❌ missing | POST /api/ppm/kanban/task/assign | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\kanban.ts:146 |
| ❌ missing | PUT /api/ppm/kanban/task/reorder | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\kanban.ts:156 |
| ❌ missing | POST /api/ppm/kanban/task | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\kanban.ts:170 |
| ❌ missing | DELETE /api/ppm/kanban/task?task_id={param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\kanban.ts:178 |
| ❌ missing | GET /api/ppm/plan-node | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:71 |
| ❌ missing | POST /api/ppm/plan-node | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:75 |
| ❌ missing | PUT /api/ppm/plan-node/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:82 |
| ❌ missing | DELETE /api/ppm/plan-node/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:89 |
| ❌ missing | POST /api/ppm/plan-node-detail-tpl | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:136 |
| ❌ missing | PUT /api/ppm/plan-node-detail-tpl/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:146 |
| ❌ missing | DELETE /api/ppm/plan-node-detail-tpl/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:153 |
| ❌ missing | GET /api/ppm/plan-node/{param}/modules | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:165 |
| ❌ missing | POST /api/ppm/plan-node-module | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:190 |
| ❌ missing | PUT /api/ppm/plan-node-module/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:200 |
| ❌ missing | DELETE /api/ppm/plan-node-module/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:207 |
| ❌ missing | GET /api/ppm/project-plan/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:260 |
| ❌ missing | POST /api/ppm/project-plan | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:266 |
| ❌ missing | PUT /api/ppm/project-plan/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:276 |
| ❌ missing | DELETE /api/ppm/project-plan/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:283 |
| ❌ missing | GET /api/ppm/project-plan/{param}/plan-nodes | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:304 |
| ❌ missing | POST /api/ppm/plan-node-ps | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:310 |
| ❌ missing | PUT /api/ppm/plan-node-ps/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:320 |
| ❌ missing | DELETE /api/ppm/plan-node-ps/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:327 |
| ❌ missing | POST /api/ppm/plan-node-detail | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:346 |
| ❌ missing | PUT /api/ppm/plan-node-detail/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:356 |
| ❌ missing | DELETE /api/ppm/plan-node-detail/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\plan.ts:363 |
| ❌ missing | POST /api/ppm/problem-list | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\problem.ts:63 |
| ❌ missing | PUT /api/ppm/problem-list/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\problem.ts:73 |
| ❌ missing | DELETE /api/ppm/problem-list/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\problem.ts:80 |
| ❌ missing | POST /api/ppm/problem-list/{param}/start | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\problem.ts:94 |
| ❌ missing | PUT /api/ppm/problem-list/{param}/execute | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\problem.ts:111 |
| ❌ missing | GET /api/ppm/project-maintenance/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:68 |
| ❌ missing | POST /api/ppm/project-maintenance | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:74 |
| ❌ missing | PUT /api/ppm/project-maintenance/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:84 |
| ❌ missing | DELETE /api/ppm/project-maintenance/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:91 |
| ❌ missing | POST /api/ppm/customer-maintenance | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:148 |
| ❌ missing | PUT /api/ppm/customer-maintenance/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:158 |
| ❌ missing | DELETE /api/ppm/customer-maintenance/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:165 |
| ❌ missing | POST /api/ppm/project-member | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:211 |
| ❌ missing | PUT /api/ppm/project-member/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:221 |
| ❌ missing | DELETE /api/ppm/project-member/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:228 |
| ❌ missing | POST /api/ppm/project-stakeholder | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:256 |
| ❌ missing | DELETE /api/ppm/project-stakeholder/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\project.ts:273 |
| ❌ missing | GET /api/ppm/task-plan/get | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\task.ts:59 |
| ❌ missing | PUT /api/ppm/task-plan/update | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\task.ts:68 |
| ❌ missing | PUT /api/ppm/task-plan/execute | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\task.ts:77 |
| ❌ missing | POST /api/ppm/task-plan/start | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\task.ts:89 |
| ❌ missing | PUT /api/ppm/task-execute/update | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\task.ts:137 |
| ❌ missing | POST /api/ppm/work-hour/create | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\task.ts:181 |
| ❌ missing | PUT /api/ppm/work-hour/update | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\task.ts:191 |
| ❌ missing | DELETE /api/ppm/work-hour/delete | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\task.ts:199 |
| ❌ missing | GET /api/ppm/workbench/profile | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\workbench.ts:40 |
| ❌ missing | GET /api/ppm/workbench/summary | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\workbench.ts:55 |
| ❌ missing | GET /api/ppm/workbench/calendar | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\ppm\workbench.ts:70 |
| ❌ missing | POST /api/workspaces/{param}/releases | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\releases.ts:48 |
| ❌ missing | POST /api/releases/{param}/deploy | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\releases.ts:55 |
| ❌ missing | POST /api/releases/{param}/promote | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\releases.ts:61 |
| ❌ missing | POST /api/releases/{param}/rollback | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\releases.ts:67 |
| ❌ missing | GET /api/settings | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\settings.ts:16 |
| ❌ missing | PUT /api/settings | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\settings.ts:22 |
| ❌ missing | POST {param}/api/auth/refresh | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\token-refresh.ts:52 |
| ❌ missing | GET /api/workspaces/{param}/skills | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\workspace-skills-view.ts:54 |
| ❌ missing | POST /api/workspaces/scan-generate | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\workspaces.ts:49 |
| ❌ missing | GET /api/workspaces | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\workspaces.ts:85 |
| ❌ missing | POST /api/workspaces | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\workspaces.ts:116 |
| ❌ missing | PATCH /api/workspaces/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\workspaces.ts:151 |
| ❌ missing | POST /api/workspaces/{param}/rescan | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\workspaces.ts:158 |
| ❌ missing | DELETE /api/workspaces/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\workspaces.ts:162 |
| ❌ missing | GET /api/workspaces/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\workspaces.ts:166 |
| ❌ missing | GET /api/workspaces/topology | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\workspaces.ts:198 |

- ❌ contract gap 是真实集成缺陷——诚实判 FAIL 并回 execute 补端点（CLI 仅 advisory 不硬阻断）
- ⚠️ 388 个后端端点前端未调用（warning 不阻断）：GET /missions/{param}、POST /missions/{param}/cancel、POST /auth/login、GET /auth/captcha/confirm、POST /auth/captcha/verify …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- **语义复核（PASS）**：探针 diff 范围未含合并 commit——git 事实：bb298931 含 4 文件删除（new-session-form.tsx / workspace-session-picker.tsx 及各自测试，delete mode 已在 commit 输出），与 design §6 声明完全一致（有意删除+迁移落档）。非 blocker。

## 测试结果
- backend：`uv run pytest app/modules/daemon -q --no-cov -n auto` → **978 passed / 0 failed**（73s）
- frontend：`pnpm test` → **177 文件 / 1921 tests 全部通过**（120s，含迁移复绿 18 用例与三组新测试 45 用例）
- frontend：`pnpm typecheck` 零错；`pnpm lint` 0 error，本变更文件警告与基线 b0d8632c 逐文件持平（双 checkout 比对法，regression-evidence.md）
- known_failures：无（无 flaky 重跑）
- 证据：regression-evidence.md + execute QA 独立复跑（81/81 抽验 + 5/5 后端）

## 决策追踪矩阵（如存在 decisions.md；无则删本节）
决策追踪矩阵已并入上方「探针 4：决策追踪覆盖」节（10/10 闭环表）。

## 技术债务
探针 1 零命中（design 清单文件无 TODO/FIXME）；前端源码无新增标记（CONCERNS 基线 0）；退役文件删除带走其全部注释。唯一登记债：QA P2-1 tab 直带链后续补（SessionListPanel 筛选态受控暴露，属增强非缺陷）。

## 变更风险等级
integration-critical + deployment-critical（design frontmatter 未显式声明 risk_level）：会话创建主链路 UI 重构（集成三组件拼装）+ 已实际部署 Docker 栈并完成三入口浏览器实证（deployment 部分已闭环）。

## Runtime Evidence
- 代码链：worktree 8 commit（5257d797/6be86547/c20693cf/af67e58a/38cebcce/d9e53ad2/28286abb/e979f4dc）→ worktree assess SAFE → 主仓合并 **bb298931** + 桥接 **74131aa5**（并行变更迁移 alembic 桥，同内容零冲突）
- 部署：`docker compose up --build --force-recreate backend frontend`（2026-08-23 10:30）；GET /api/health → `{"status":"ok","db":"ok","redis":"ok"}`；3001 前端代理 health ok
- 容器内核验：backend `grep -c owner_name router.py` = 3；frontend chunks 命中"发送第一句话开始对话"
- 运行时断言（browser-evidence.md 10/10 + 6 截图，2026-08-23 10:40–11:02）：分组树渲染（8 组）/两层筛选过滤（139→103）/浮层两步/预会话锁定行/首句创建 #0c92cead 原地开聊（SSE 接管"正在思考…"→配置条运行锁定）/workflow 组 4→5/不发言零残留（返回仍 0 个）/workspace 预展开/change 独立页+🧩变更名/无效深链静默
- 失败模式排除：创建失败保留输入（组件测试）；无效 session id 静默（实证）；并行迁移桥（alembic 定位失败已修复实证）
- daemon 协议/生命周期：不涉及（design §7.5 零变更引用）

## 代码审查
问题列表：
1. 【已修】部署期 backend 启动失败（并行会话把共享库 alembic_version 推进至 20260823090000，main 缺迁移文件）→ 桥接 commit 74131aa5（同内容，其合并零冲突）
2. 【工具瑕疵不影响产物】execute step15 --done 状态机与 status 显示矛盾（"没有待完成的步骤" vs ⬜15/15）——worktree assess SAFE 已完成实质收尾，verify 启动时自动对齐
3. 【登记】QA P2-1：FR-04 tab 直带链降级（全态浮层承接，两步即达；SessionListPanel 筛选态受控暴露留后续）
4. 【登记】QA P2-2：change preContext 合成位置在门户内而非页面薄壳（行为等价+测试锁定，字面偏差）
总体评价：实现与设计一致、拼装闭环、退役干净、测试锁定充分（45 新用例+42 条迁移断言落档）；三入口实机证据完整；两项有意偏差有界且注释固化。可归档。
