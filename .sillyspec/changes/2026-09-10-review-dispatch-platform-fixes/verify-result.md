# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`——4 FR 全实现、9/9 任务过、定向测试 163 用例全绿（daemon 95 + backend 50 + frontend 18）+ 三端类型/零漂移门禁过、execute 期独立验收审查 pass/pass。NOTES：①活体回归（真派发 artifacts 非空、独立池生效）依赖远端部署环境，留给用户执行（design R-07）；②api-types 再生成物含并行变更 heartbeat ql_id 增量（R-05 预声明）；③探针 5 两处 missing 为基线既有模板字符串动态 URL，非本次缺口。

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无——9 个 task 的 per-task review.json 全部为 pass（execute 期主代理逐 hunk 审查升级），无 cannot_verify 残留。

## 集成验证回执 [层：自述声明——CLI 一致性校验]

无（risk_level=unit-sufficient，见「变更风险等级」节；真实派发集成回归为用户侧活体动作，见 Runtime Evidence 尾注）。

## 任务完成度 [层：人工判断]

9/9 完成（tasks.md 勾选 + CLI autoCheckPlanFromReviews 双路一致）：task-01/02/03/04/05/06/07/08 实现任务均「完成」（各自定向测试全绿 + per-task review.json pass）；task-09 纯验证任务「完成」（全部门禁绿且未跑全量）。无存疑项。

## 设计一致性 [层：人工判断]

一致，含一处**已留痕的范围扩展**：execute 期发现 frontend/src/lib/api/llm-providers.ts 的 formToCreate 硬编码 `agent_kind:"claude"` 会吞掉 pi（表单提交 pi 但 POST body 恒 claude，FR-03 端到端断裂）——主代理裁决扩 task-07 allowed_paths 并同步 design §6/plan/TaskCard 三处留痕后补刀修复（别名放宽 + 透传 + 消除 as 断言）。其余实现与 design §5.1-5.3 逐条一致（execute 独立验收审查 8 项 pass：门控四重/时序/容错/映射/批量查询/兼容四条/19 文件对账/api-types 三份一致）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：NEW:sillyhub-daemon/tests/hub-client-worker-done-session.test.ts、NEW:sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts、NEW:sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts、NEW:sillyhub-daemon/tests/credential-injector-pi.test.ts、NEW:backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py

#### 探针 2：设计关键词覆盖

设计能力关键词逐个 grep（worktree 实现）确认：turnFinalText（sillyhub-daemon/src/interactive/pi-rpc-driver.ts 5 处）/ workerDone opts.sessionId（sillyhub-daemon/src/hub-client.ts + sillyhub-daemon/src/daemon.ts ClientLike）/ mission_worker 门控（sillyhub-daemon/src/daemon.ts getProviderCaps(state.provider).mcp === false）/ kind=summary 复用（sillyhub-daemon/src/mcp-server.ts 契约描述未改，backend 零改动即复用 _worker_done_core）/ agent_kind pi（schema.py Literal + REGISTRY + openapi + 两份 api-types）/ auth_field pattern（schema.py 三处 ^[A-Z][A-Z0-9_]*$ + 前端同 pattern）/ ANTHROPIC_API_KEY 缺省（injector）/ default_agent + effective_agent + providers（tools.py 8 处）/ formToCreate 透传（lib/api/llm-providers.ts）。全部命中，无设计声明未落地项。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-02: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts …）
- ✅ task-03: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts …）
- ✅ task-04: 模块目录（backend/app/modules/llm_provider、backend/app/modules/llm_provider/tests）找到 8 个测试文件（backend/app/modules/llm_provider/tests/test_api_format.py、backend/app/modules/llm_provider/tests/test_fetch_models.py、backend/app/modules/llm_provider/tests/test_litellm_client.py、backend/app/modules/llm_provider/tests/test_llm_provider.py、backend/app/modules/llm_provider/tests/test_probe.py …）
- ✅ task-05: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts …）
- ✅ task-06: 模块目录（backend/app/modules/mcp_gateway、backend/app/modules/mcp_gateway/tests）找到 10 个测试文件（backend/app/modules/mcp_gateway/tests/conftest.py、backend/app/modules/mcp_gateway/tests/test_auth.py、backend/app/modules/mcp_gateway/tests/test_change_stage_tools.py、backend/app/modules/mcp_gateway/tests/test_get_or_issue.py、backend/app/modules/mcp_gateway/tests/test_model.py …）
- ✅ task-07: 模块目录（frontend/src/components/llm-providers、frontend/src/components/llm-providers/__tests__、frontend/src/lib/api）找到 8 个测试文件（frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx、frontend/src/components/llm-providers/__tests__/llmProviderPresets.test.ts …）
- ✅ task-08: 模块目录（backend、frontend/src/lib、sillyhub-daemon/src）找到 62 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ✅ task-09: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/src、backend/app/modules/llm_provider、backend/app/modules/mcp_gateway、frontend/src/components/llm-providers）找到 27 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、backend/app/modules/llm_provider/tests/test_api_format.py、backend/app/modules/llm_provider/tests/test_fetch_models.py、backend/app/modules/llm_provider/tests/test_litellm_client.py …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖

见下方「决策追踪矩阵」——D-001/D-002/D-003@v1 全部 accepted 且 FR→task→证据回指闭环，无 unresolved。

#### 探针 5：API Contract Parity
- ❌ API parity check failed: 2 frontend calls have no matching backend endpoint [scope: change-diff (19 files @ worktree)] | 1414 backend endpoints unused by frontend | 3 calls matched after mount-prefix alignment (artifact paths exclude include_router/app.use prefixes)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ℹ️ 3 处前端调用经挂载前缀对齐匹配（endpoints 提取不含 include_router/app.use 挂载点前缀，比对时剥除对齐——非契约缺口）

| 状态 | 前端调用 | 后端端点 | 文件 |
|---|---|---|---|
| ❌ missing | POST ${serverUrl.replace(/\/$/,  | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-09-10-review-dispatch-platform-fixes\sillyhub-daemon\src\sillyhub-daemon/src/hub-client.ts:2493 |
| ❌ missing | GET ${serverUrl.replace(/\/$/,  | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-09-10-review-dispatch-platform-fixes\sillyhub-daemon\src\sillyhub-daemon/src/hub-client.ts:2512 |

- ❌ contract gap 是真实集成缺陷——诚实判 FAIL 并回 execute 补端点（CLI 仅 advisory 不硬阻断）
- ⚠️ 1414 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果 [层：确定性检查——CLI 实测对账]

主代理在 worktree 直跑（2026-09-10 22:20-22:22）：①daemon `pnpm typecheck` 过；②daemon 定向 vitest 95 passed（pi-rpc-driver-turn-result 6 + hub-client-worker-done-session 6 + daemon-mission-worker-artifact 12 + credential-injector.test.ts 既有+pi 71）；③backend `uv run pytest test_llm_provider_pi_kind.py test_tools_new.py -q --no-cov` 50 passed（29+21）；④frontend vitest llm-provider-form 18 passed；⑤frontend `pnpm run typecheck` exit 0；⑥daemon `pnpm run gen:types:check` exit 0 零漂移。子代理另跑过回归集：pi-rpc-driver 73 / hub-client+mcp-server-worker-done 85 / daemon-interactive-bridge / test_api_format+test_fetch_models+test_router 65 / llm-provider-list 5。known_failures：无。CLI 最终 commands.test 对账另计。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01, FR-02 | task-01,02,03 | sillyhub-daemon/src/daemon.ts 代报分支（diff hunk）+ worker_done 端点复用（backend 零改动）+ pi driver result 字段；12+6+6 用例 | accepted/闭环 |
| D-002@v1 | FR-03 | task-04,05,07,08 | schema.py Literal+pi / REGISTRY pi / 表单+lib 透传 / 三份生成物；29+20+18 用例 + gen:types:check 0 | accepted/闭环 |
| D-003@v1 | FR-04 | task-06 | tools.py 三新键 + 批量 in 查询；21 用例（4 新增 + 既有零破坏） | accepted/闭环 |

## 技术债务 [层：人工判断]

- **lint 门 advisory 裁定（2026-09-10 22:50）**：CLI verify lint 实测失败于 `backend/app/modules/daemon/group/service/messages.py`（ruff format `Would reformat`）——该文件是主仓**另一并行会话的未提交改动**（worktree 内干净、不在本变更 19 文件清单、本变更 4 个 backend 文件 ruff check+format --check 全绿）。按工具审计通道 `SILLYSPEC_VERIFY_LINT_GATE=advisory` 放行（非本变更失败，不代跑他人文件的 formatter 以免动并行会话在途工作）。

- 探针 1 命中：0（变更文件无 TODO/FIXME/HACK/XXX 新增）。
- 既有债（非本次引入）：frontend/src/components/llm-providers/llm-provider-form.tsx 一处 no-unused-vars warning（基线 188 行=现 203 行，eslint exit 0）。
- 已文档化的 v1 边界（design §3/R-03）：pi 不支持 litellm_proxy/自定义 baseUrl env 形态（pi 不读 BASE_URL env，自定义端点走宿主 ~/.pi/agent/models.json）——消费指引见交付说明。
- 待用户侧动作（R-07/P1-3 运维半边）：远端工作区 PATCH default_agent=pi 或前端工作区详情页设置；活体回归口径见交付说明。

## 变更风险等级 [层：人工判断]

risk_level 由 design frontmatter 显式声明 = unit-sufficient（覆盖关键词判级）。理由：本变更是纯逻辑增量且全部可用注入假件的单测覆盖（daemon 三处改动均为事件/参数级逻辑、backend 为 DTO 值域与只读聚合端点、前端为表单/组装层）——虽触碰 daemon/session/lease 关键词面，但不改协议形状、不改启动路径、零 DDL；真实跨进程集成（daemon↔backend worker_done 实流量、pi 子进程凭证注入实效）依赖远端部署环境（远端 daemon + 独立 key + 活体 agent），本机不可达，已列为用户侧活体回归（R-07），非静默降级。无依赖否定语境抑制的命中。

## Runtime Evidence [层：人工判断]

- 长驻进程启动命令：不涉及（unit-sufficient，未启动 uvicorn/daemon 常驻进程；无 PID 需登记回收）。
- 触碰的服务端点：不涉及本机实流量。worker_done 端点行为依据既有 backend 测试契约 + 源码核读（backend/app/modules/agent/mcp_tools.py _worker_done_core :2171-2300），未本机起服务打真请求。
- 触发核心路径的请求：不涉及（由 vitest/pytest 以假件等价驱动：daemon-mission-worker-artifact.test.ts 以 fake client 断言 workerDone 实参与时序；credential-injector-pi.test.ts 以纯函数断言 env 产出）。
- 进程日志关键片段：不涉及。
- 生命周期终态断言：单测层覆盖（turn 收敛→result 携带全文→代报恰一次于 notifyRunResult 之后→失败仅 warn 不阻塞）。
- 失败模式排除：409/422/网络错误的代报失败路径有专门用例（仅 warn、onTurnResult 照常 resolve）；未配 pi 凭证时 spawn-env 第 0 层跳过（injector 只在 provider_config 命中时生效）。
- 尾注：真实派发活体回归（用户口径：review-dispatch --status 走到 completed 且 get_worker_result artifacts 非空可提取 review JSON；本地配额耗尽时段平台派发仍能跑）需在远端部署环境执行，属 R-07 预登记的用户侧动作。

## 代码审查 [层：人工判断]

四轮独立审查留痕：①brainstorm design Grill（独立子代理 24 项 checklist，pass/pass，4 gap 已修订进 design）；②plan review（独立子代理 10 项，pass/pass，连带测试债已并入 task-05）；③execute per-task review（主代理逐 hunk diff 审查，9/9 pass）；④execute 验收审查（独立子代理 8 项 FR/兼容/对账，pass/pass）。总体评价：改动面克制（19 文件，全部增量式，无删改既有行为路径），门控/时序/容错三处关键语义均有测试锚定；唯一 execute 期返差点（lib 组装层吞 pi）已被抓出并按流程修复留痕。探针 5 的两处 missing 经核为基线既有动态 URL 模式（agent-logs 系），1414 unused endpoints 为全仓存量面（advisory）。
