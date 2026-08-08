---
author: qinyi
created_at: 2026-08-08 20:23:27
change: 2026-08-08-dispatch-worker-caller-worktree
source_of_truth: git diff (multi-agent-platform HEAD + working tree; sillyspec 跨仓 working tree)
module_map_refs:
  - .sillyspec/docs/multi-agent-platform/modules/_module-map.yaml
  - .sillyspec/docs/backend/modules/_module-map.yaml
  - .sillyspec/docs/sillyhub-daemon/modules/_module-map.yaml
---

# 模块影响分析（Module Impact）— dispatch_worker caller-worktree + mission external 模式

> 真相源：真实 `git diff`（声明 design §6 / 任务 tasks.md 仅作旁证，**冲突以 git diff 为准**）。
> 三重交叉验证（声明范围 / 任务范围 / 真实 git diff）一致，无漂移。
> 范围：SillyHub `dispatch_worker` 增可选 `worktree_path`/`branch`/`worker_prompt` + `create_mission` 增 `orchestration_mode="external"`，让外部 caller（SillySpec）提供自己的 worktree 派 worker；converge 检测 external 跳过 finalize/cleanup（不 merge caller 主仓）。

## 1. 模块影响矩阵（multi-agent-platform 仓）

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend / `agent`（子模块）| 逻辑变更 + 接口变更 + 新增 | `backend/app/modules/agent/execution.py` | `dispatch_worker` 加 `worktree_path`/`branch`/`worker_prompt` 三可选参；`worktree_path` 非空 → 短路 `git_worktree_add` + 作 daemon `root_path`；**路径A 不写 `run.worktree_branch`**（D-008，防 finalize 误 merge）；`worker_prompt` 非 None → 覆写 `render_worker_prompt`（+42 行）| 否 |
| backend / `agent`（子模块）| 逻辑变更 | `backend/app/modules/agent/orchestrator.py` | `team_mission_entry` 支持 `orchestration_mode="external"`：跳过 orchestrator run/lease spawn，`constraints={"orchestration_mode":"external"}`（D-007，R-02）| 否 |
| backend / `agent`（子模块）| 逻辑变更 | `backend/app/modules/agent/finalizer.py` | `converge_mission_for_completed_run` 检测 `mission.constraints.orchestration_mode=="external"` → 跳过 `finalize_execute_mission`/`cleanup_mission`（R-01 根解层①，D-003@v2）（+18 行）| 否 |
| backend / `agent`（子模块）| 接口变更 | `backend/app/modules/agent/router.py` | `create_mission` HTTP 端点（链路A）：`orchestration_mode` 并入 `constraints` + team 门控扩展（external 也进 `team_mission_entry`，不落 GLM planner）+ 透传（+16 行）| 否 |
| backend / `agent`（子模块）| 接口变更 | `backend/app/modules/agent/mcp_tools.py` | `DispatchWorkerRequest` 加 `worktree_path`/`branch`/`worker_prompt` + `dispatch_worker` HTTP 端点透传 execution（链路A）（+13 行）| 否 |
| backend / `agent`（子模块）| 接口变更 | `backend/app/modules/agent/mission_schema.py` | `MissionCreateRequest` 加 `orchestration_mode: Literal["team","external"]\|None=None`（+6 行）| 否 |
| backend / `agent`（子模块）| 新增（测试）| `backend/app/modules/agent/tests/test_dispatch_worker_caller_worktree.py` | caller-worktree 分支单测：传 `worktree_path` → 不调 `git_worktree_add` + `root_path` 透传 + 不写 `worktree_branch` + `worker_prompt` 进 prompt（341 行）| 否 |
| backend / `agent`（子模块）| 新增（测试）| `backend/app/modules/agent/tests/test_mission_external_mode.py` | external mode 单测：create_mission external → 无 orchestrator run + constraints 含 mode；converge external → 跳过 finalize（351 行）| 否 |
| backend / `mcp_gateway`（子模块，⚠️ 未登记）| 接口变更 | `backend/app/modules/mcp_gateway/tools.py` | 链路B（公开 MCP gateway）：`create_mission` 加 `orchestration_mode` 参 + `dispatch_worker` 加3参透传 execution（字段名 `branch` 对齐跨仓契约 D-009）（+58 行）| **是**（子模块未在 backend/_module-map.yaml 登记）|
| sillyhub-daemon / `mcp-server`（子模块）| 接口变更 | `sillyhub-daemon/src/mcp-server.ts` | 链路A daemon stdio：`dispatch_worker` inputSchema/handler 加 `worktree_path`/`branch`/`worker_prompt`（snake_case）。★`createMission` 不存在于 daemon stdio（仅 5 tool），故无对应改动（+34 行）| 否 |
| sillyhub-daemon / `client`（子模块，alias hub-client）| 调用关系变更 | `sillyhub-daemon/src/hub-client.ts` | `dispatchWorker` HTTP body 加 `worktree_path`/`branch`/`worker_prompt`（snake_case）透传 backend（+18 行）| 否 |
| sillyhub-daemon（顶层；语义属 `protocol` 子模块）| 逻辑变更（**顺手修预存 bug，非本 change 主线**）| `sillyhub-daemon/tests/protocol-session-contract.test.ts` | MSG 总数断言 18→19（db90fa17 加 `PROVIDER_CONFIG_CHANGED` 未更新计数测试，阻塞 verify daemon 套件）。**protocol.ts 源文件不在本 diff**，仅修测试计数；用户授权 2026-08-08（±4 行）| **是**（预存 bug 顺手修 + 被测源文件 protocol.ts 不在 diff，仅测试侧计数）|
| docs（顶层模块）| 新增 | `docs/integrations/sillyspec-dispatch.md` | 路径A 部署集成指引：workspace `root_path`=仓根 + daemon `allowed_roots` 两源（本地 config `assertWithinAllowedRoots` / backend runtime overlay `PolicyEngine`）+ 配置 JSON 示例 + 守卫触发点排查（R-03）（215 行）| 否 |
| sillyspec（顶层模块，本 change spec 自身）| 新增 | `.sillyspec/changes/2026-08-08-dispatch-worker-caller-worktree/{proposal,design,tasks,requirements,decisions}.md` + `plan.md` + `tasks/task-01..13.md` + `verify-required-evidence.json` + `verify-result.md` | 本 change 的 SillySpec 流程产物（四件套 + plan + 13 task 卡 + verify 记录）；属流程文档，非产品代码 | 否 |
| `scripts`（顶层目录，⚠️ 未登记模块）| 新增 | `scripts/check-dispatch-allowed-roots.mjs` | smoke 前置硬校验脚本：仓根不在 daemon `allowed_roots` → `EXIT 1` + 中文引导（fail-closed，复刻 `file-rpc.ts under` 语义，R-03）（306 行）| **是**（根 `scripts/` 无对应顶层模块）|

主线影响（按变更权重）：**backend `agent` 子模块**（6 源文件逻辑/接口变更 + 2 新单测，是本 change 核心）> **backend `mcp_gateway`**（链路B 接口透传）> **sillyhub-daemon**（链路A daemon stdio schema + HTTP client 透传）> 新增 docs / scripts / 测试。

## 2. 跨仓 sillyspec（归属本 change，但在 sillyspec 仓）

> sillyspec 是独立 git 仓，multi-agent-platform 的 `_module-map.yaml` 不覆盖；此处单列。变更归属本 change（design §6 / tasks T15-T19），在 `C:/Users/qinyi/IdeaProjects/sillyspec` 仓工作区。

| 模块（sillyspec 仓路径域）| 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| `sillyhub-mcp` 客户端 | 接口变更 | `src/sillyhub-mcp/client.js` | `createMission` 加 `orchestrationMode`（路径A 传 `"external"`，跳 orchestrator spawn，FR-08/D-007）+ `dispatchWorker` 传 `branch`（字段名对齐 D-009，round-1 `worktree_branch` 漂移已统一）| 否 |
| `dispatch` 路径A 探测（backend）| 逻辑变更 | `src/dispatch/backends/sillyhub-mcp.js` | `isPathASupported()` 翻真（task-11，D-005 + R-04）：读 probe.js 预热的 `tools/list` 探测缓存——`dispatch_worker.inputSchema.properties` 含 `worktree_path`+`worker_prompt` → supported；新增 `setPathAProbeResult`/`clearPathAProbeCache` 缓存；**保持 `isPathASupported` sync 签名**不改 strategy.js/execute.js 调用点 | 否 |
| `dispatch` 探测预热 + 校验 | 逻辑变更 | `src/dispatch/probe.js` | `probeSillyHub` 预热：daemon 可达后 best-effort 调 `client.listTools()` 查 dispatch_worker schema 写缓存；`rootPath` 校验（R-08 best-effort，未传则从 daemon `getRootPath` 拿）+ worktree 越界（`worktreePath` 越界 root → `worktree-outside-root`）| 否 |
| 跨仓契约文档 | 新增 / 配置变更 | `docs/sillyspec/sillyhub-path-a-contract.md` | 跨仓契约更新：路径A 落地状态（已落地）+ 字段名 `branch` + external mode + 校验清单打勾 | 否 |
| 测试 | 新增 | `test/dispatch/path-a-probe.test.mjs` | path-a probe 单测（436 行，untracked）| 否 |

## 3. 未匹配文件（_module-map glob 未覆盖 / 模块未登记）

| 文件 | 现状 | 说明 / 建议 |
|---|---|---|
| `backend/app/modules/mcp_gateway/**`（本次改 `tools.py`）| **子模块未登记** | `backend/_module-map.yaml`（generated_at 2026-07-27）的 `last_change` 列举的实际业务目录**漏 `mcp_gateway`**；实际目录存在（`__init__.py`/`auth.py`/`model.py`/`router.py`/`server.py`/`service.py`/`sse.py`/`tools.py`/`tests/`）。顶层 `backend/**` 覆盖，子模块级未匹配。**建议 Step3 doc-syncer 补登 `mcp_gateway` 子模块**（含 paths/entrypoints/main_symbols）|
| `scripts/check-dispatch-allowed-roots.mjs` | **顶层无对应模块** | `multi-agent-platform/_module-map.yaml` 无 `scripts` 模块；既有 `scripts/` 目录（如 `scan-drift-check.py`）历史上也未匹配。**Step3 决定是否加 `scripts` 顶层模块**（倾向加，避免后续每次 smoke 脚本都落未匹配；与 2026-08-07 scan-doc-drift-gate archive 同类遗留）|
| `sillyhub-daemon/tests/protocol-session-contract.test.ts` | **子模块 glob 未覆盖** | `sillyhub-daemon/_module-map.yaml` 所有子模块 `paths` 仅指向 `src/**`，`tests/` 不在任何子模块 glob 内。语义属 `protocol` 子模块（测 `protocol.ts` 的 MSG 契约），顶层 `sillyhub-daemon/**` 覆盖。无需补 map（测试文件归顶层模块即可）|

## 4. 三重交叉验证结论

- **声明范围（design §6 文件清单，17 行）** vs **任务范围（tasks.md T1-T22 + task-01..13.md）** vs **真实 git diff**：一致。
- multi-agent-platform 真实改动 14 个产品/测试文件（+1439 / -24）+ sillyspec 流程文档（change 自身）；sillyspec 跨仓 4 改 + 1 新测试。
- design §6 与 git diff 的偏差仅「行数/操作类型」微观差异（如 design 标「修改」的 task 卡实际是「新增」），不影响模块归属。
- 主线 = backend `agent`（execution/orchestrator/finalizer/router/mcp_tools/mission_schema 逻辑+接口变更）+ `mcp_gateway`（接口变更）+ sillyhub-daemon（schema 增量）；`protocol-session-contract.test.ts` 是顺手修预存 bug（db90fa17），明确标注非主线。
- 无声明的文件「未落地」、也无 git diff「多出未声明文件」（产品代码层面）。

## 5. 文档同步结果（Step3 sync-module-docs，2026-08-08 archive）

> 本变更归档时的模块文档落地结果。补登 scan 漏登模块 + 更新受影响卡片。跨仓 sillyspec 不在本仓 _module-map 补登（铁律）。

| 影响项 | 同步目标 | 操作 |
|---|---|---|
| backend `agent` 子模块（6 源文件 + 2 新测试）| `docs/backend/modules/agent.md` | 更新（契约摘要 + 关键逻辑：dispatch_worker caller-worktree 三参 + 不写 worktree_branch / mission external 模式 / converge 跳 finalize，R-01 三重防御）|
| backend `mcp_gateway` 子模块（⚠️ scan 漏登，§3 行1）| `docs/backend/modules/_module-map.yaml: mcp_gateway` + `docs/backend/modules/mcp_gateway.md` | **补登**（paths `app/modules/mcp_gateway/**` + 新建卡片；含链路B create_mission orchestration_mode + dispatch_worker 三参透传）|
| sillyhub-daemon `mcp-server` 子模块（链路A，§1 行10）| `docs/sillyhub-daemon/modules/_module-map.yaml: mcp-server`（已登记，卡片此前"尚未创建"）+ `docs/sillyhub-daemon/modules/mcp-server.md` | **新建卡片**（解 scan 遗留"尚未创建"债 + 记 dispatch_worker inputSchema 三参，★无 createMission）|
| sillyhub-daemon `client`（alias hub-client，链路A，§1 行11）| `docs/sillyhub-daemon/modules/client.md` | 更新（契约摘要加 dispatchWorker + 注意事项加 D-009 branch 跨仓契约）|
| 顶层 `scripts`（⚠️ scan 未登记，§3 行2）| `docs/multi-agent-platform/modules/_module-map.yaml: scripts` + `docs/multi-agent-platform/modules/scripts.md` | **补登**（paths `scripts/**` + 新建卡片，含 check-dispatch-allowed-roots.mjs）|
| 顶层 `docs` 模块（§1 行14，docs/integrations/sillyspec-dispatch.md）| `docs/multi-agent-platform/modules/docs.md` | 未改（既登记，卡片粒度不到单文件）|
| 顶层 `sillyspec` 模块（§1 行15，本 change 流程产物）| — | 本 change 自身，不更新卡片 |
| sillyhub-daemon `protocol-session-contract.test.ts`（§1 行12，顺手修预存 bug）| — | 测试文件归顶层 sillyhub-daemon 模块，无需补 map（§3 行3 已说明）|
| 跨仓 sillyspec（§2，sillyhub-mcp / dispatch path-a / probe）| — | 另一仓 `_module-map`，不在本仓补登（铁律）|
