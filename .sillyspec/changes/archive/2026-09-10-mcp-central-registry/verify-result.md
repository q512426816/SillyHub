# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`（13/13 task 完成、7 条全局 AC 与 51 条卡级 acceptance 全实证、真实 PG+uvicorn 集成回执 ALL_PASS；集成实测抓出并已修复一个 PG 方言 bug（render 整行 DISTINCT）；3 条 NOTES 见「代码审查」与「技术债务」——均为预存环境问题或非阻断遗留，不构成本变更缺陷）

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
- claim: 真实 PG 种子行→registry 渲染→真实 uvicorn HTTP 三案取证（无 user_id 200 三键形状含种子 server / 伪造 user_id 404 lease 归属拦截 D-010 / 管理列表 200），种子清理无残留，ALL_PASS | command: uv run python .sillyspec/.runtime/verify-integration-mcp-registry.py（worktree backend，真实 dev PG + uvicorn 127.0.0.1:8907 + Bearer JWT） | exit: 0 | log: .sillyspec/.runtime/verify-integration-stdout.log

## 任务完成度 [层：人工判断]
13/13 全部完成（tasks.md 13/13 勾选 + execute 阶段逐 task review pass + 独立验收审查 AC1-7 实证 + 51 条卡级 acceptance 逐卡核验）。无未完成/存疑项。

## 设计一致性 [层：人工判断]
与 design.md 一致，两处实现期裁决均已落决策记录并在 review 留痕：
1. task-08 三包装未命中回退 400（按 TaskCard 权威，与协调提示的「整体视为 server map」相左——用例钉死）
2. task-11 菜单权限放开 permissions:[]（D-001 双层可见性要求普通用户可见私有库入口；主代理裁决，对齐 skills 先例）
集成实测发现并修复一处偏差：render `_injection_rows`/`_platform_bound_rows` 原用整行 DISTINCT，PG json 列无等值算子报错（design 未指定该 SQL 形态，属实现选择缺陷）——改 Python 按 id 去重（commit 3adf56d53），SQLite 153 单测回归 + 真实 PG 渲染实证。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：NEW:backend/app/modules/mcp_registry/__init__.py、NEW:backend/app/modules/mcp_registry/model.py、NEW:backend/app/modules/mcp_registry/schema.py、NEW:backend/app/modules/mcp_registry/service.py、NEW:backend/app/modules/mcp_registry/router.py、NEW:backend/app/modules/mcp_registry/render.py、NEW:backend/app/modules/mcp_registry/importer.py、NEW:backend/app/modules/mcp_registry/templates.py、NEW:backend/app/modules/mcp_registry/tests、NEW:backend/migrations/versions/20260910140000_add_mcp_registry_tables.py、NEW:frontend/src/lib/api/mcp-registry.ts、NEW:sillyhub-daemon/tests/daemon-mcp-user-id-wiring.test.ts、NEW:frontend/src/components/mcp-registry、NEW:.sillyspec/docs/backend/modules/mcp_registry.md

#### 探针 2：设计关键词覆盖
全覆盖：workspace-scan(3b/1f)、import-json(4b/3f)、templates(7b/3f)、diagnostics(5b/2f)、encrypted_env(14b/2f)、user_id(13b/2f)（b=backend f=frontend 命中文件数）；「加密/绑定/导入/模板/诊断/归一化/双 tab/白名单」均双端命中，无 ⚠️ 未实现关键词。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules、backend/migrations）找到 58 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-02: 模块目录（backend/app/modules）找到 48 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-03: 模块目录（backend/app/modules/mcp_registry、backend/app）找到 55 个测试文件（backend/app/modules/mcp_registry/tests/test_importer_json.py、backend/app/modules/mcp_registry/tests/test_importer_workspace.py、backend/app/modules/mcp_registry/tests/test_model_schema.py、backend/app/modules/mcp_registry/tests/test_render.py、backend/app/modules/mcp_registry/tests/test_router.py …）
- ✅ task-04: 模块目录（backend/app/modules/mcp_registry）找到 7 个测试文件（backend/app/modules/mcp_registry/tests/test_importer_json.py、backend/app/modules/mcp_registry/tests/test_importer_workspace.py、backend/app/modules/mcp_registry/tests/test_model_schema.py、backend/app/modules/mcp_registry/tests/test_render.py、backend/app/modules/mcp_registry/tests/test_router.py …）
- ✅ task-05: 模块目录（backend/app/modules/daemon/router、backend/app/modules/daemon/tests）找到 10 个测试文件（backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py …）
- ✅ task-06: 模块目录（backend/app/modules/daemon/lease、backend/app/modules/daemon/tests、sillyhub-daemon/src、sillyhub-daemon/tests）找到 23 个测试文件（backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py、backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py …）
- ✅ task-07: 模块目录（backend/app/modules/daemon/tests、sillyhub-daemon/tests）找到 20 个测试文件（backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py …）
- ✅ task-08: 模块目录（backend/app/modules/mcp_registry）找到 7 个测试文件（backend/app/modules/mcp_registry/tests/test_importer_json.py、backend/app/modules/mcp_registry/tests/test_importer_workspace.py、backend/app/modules/mcp_registry/tests/test_model_schema.py、backend/app/modules/mcp_registry/tests/test_render.py、backend/app/modules/mcp_registry/tests/test_router.py …）
- ✅ task-09: 模块目录（NEW:backend/app/modules/mcp_registry、backend/app/modules/mcp_registry）找到 7 个测试文件（backend/app/modules/mcp_registry/tests/test_importer_json.py、backend/app/modules/mcp_registry/tests/test_importer_workspace.py、backend/app/modules/mcp_registry/tests/test_model_schema.py、backend/app/modules/mcp_registry/tests/test_render.py、backend/app/modules/mcp_registry/tests/test_router.py …）
- ✅ task-10: 模块目录（backend/app/modules/mcp_registry）找到 7 个测试文件（backend/app/modules/mcp_registry/tests/test_importer_json.py、backend/app/modules/mcp_registry/tests/test_importer_workspace.py、backend/app/modules/mcp_registry/tests/test_model_schema.py、backend/app/modules/mcp_registry/tests/test_render.py、backend/app/modules/mcp_registry/tests/test_router.py …）
- ✅ task-11: 模块目录（frontend/src/app/(dashboard)/settings、frontend/src/components、frontend/src/lib/api、frontend/src/lib、backend）找到 72 个测试文件（frontend/src/app/(dashboard)/settings/mcp/page.test.tsx、frontend/src/app/(dashboard)/settings/providers/__tests__/page.test.tsx、frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx、frontend/src/components/agent/borrowed-solution-files-panel.test.tsx、frontend/src/components/agent/borrowed-solution-files.test.tsx …）
- ✅ task-12: 模块目录（frontend/src/app/(dashboard)/settings、frontend/src/components、NEW:frontend/src/lib/api）找到 13 个测试文件（frontend/src/app/(dashboard)/settings/mcp/page.test.tsx、frontend/src/app/(dashboard)/settings/providers/__tests__/page.test.tsx、frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx、frontend/src/components/agent/borrowed-solution-files-panel.test.tsx、frontend/src/components/agent/borrowed-solution-files.test.tsx …）
- ✅ task-13: 模块目录（backend/app/modules/settings、backend、frontend/src/lib、.sillyspec/docs/backend/modules）找到 61 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
闭环：D-001→FR-01/02→task-01/02/03/11（权限矩阵+加密单测+集成 case-c）；D-002→FR-03→task-01/02（binding 约束单测）；D-003→FR-04→task-05/13（旧端点删除+KV 不再读断言）；D-004→FR-05~09→task-08/09/10/12（54 导入/模板用例）；D-005→FR-01→task-01/02（stdio-only 写路径单测）；D-007→task-03/05/13（白名单留 settings 实测）；D-008@v2→FR-05→task-05/06（claim 透传 U1-U4 + wiring 三态）；D-010→FR-03→task-05/07（授权三态单测 + 集成 case-b 真实 404）；D-011→FR-08→task-04/12（五项诊断单测 + 面板渲染用例）。无未闭环决策；无 unresolved。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 7975 backend endpoints (live [scan-root 572 + worktree 584] + artifact 7592), 11 frontend calls [scope: change-diff (51 files @ worktree)] | 2524 backend endpoints unused by frontend | 11 calls matched after mount-prefix alignment (artifact paths exclude include_router/app.use prefixes)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ℹ️ 11 处前端调用经挂载前缀对齐匹配（endpoints 提取不含 include_router/app.use 挂载点前缀，比对时剥除对齐——非契约缺口）
- ⚠️ 2524 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果 [层：确定性检查——CLI 实测对账]
CLI --done 统一对账（local.yaml commands.test 按变更命中模块子集）；本会话实测底账：backend（mcp_registry+daemon mcp 端点+settings）183 passed；daemon（mcp-config+wiring+budget 回归）56→60 passed；frontend（mcp 页 11 + menu 38 + permission 21）全绿；ruff/mypy/tsc/typecheck 全过。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001 | FR-01/02 | 01,02,03,11 | 权限矩阵单测 + 集成 case-c + 菜单放开 | 闭环 |
| D-002 | FR-03 | 01,02 | binding 双 partial unique + 归属校验单测 | 闭环 |
| D-003 | FR-04 | 05,13 | 旧端点删除 grep 零残留 + KV 不读断言 | 闭环 |
| D-004 | FR-05~09 | 08,09,10,12 | 54 个导入/模板用例 + 前端三入口用例 | 闭环 |
| D-005 | FR-01 | 01,02 | stdio-only 写路径 422 单测 | 闭环 |
| D-007 | FR-01 | 03,05,13 | whitelist 留 settings 实测（端点响应 whitelist 键） | 闭环 |
| D-008@v2 | FR-05 | 05,06 | claim U1-U4 + daemon wiring 三态 URL 断言 | 闭环 |
| D-009 | 全 FR | 全部 | 四件套 + 原型 + 13 卡 | 闭环 |
| D-010 | FR-03 | 05,07 | 授权三态单测 + 集成 case-b 真实 404 | 闭环 |
| D-011 | FR-08 | 04,12 | 五项诊断单测 + 面板用例 | 闭环 |

## 技术债务 [层：人工判断]
变更文件 TODO/FIXME/HACK/XXX 零命中（探针 1 + grep 双确认）。非阻断遗留三件（均已记录归属）：① sillyhub-daemon/src/api-types.ts 生成物滞后（旧端点死引用，daemon typecheck/运行时不受影响，归档阶段随 daemon 子项目联动再生成）；② 501 惰性桩死分支清理（router.py 内 ImportError 兜底已达目的，纯卫生）；③ R-09 secret 键名启发式提醒（P2，独立 quick 跟进）。

## 变更风险等级 [层：人工判断]
integration-critical（CLI 关键词判级，无显式声明覆盖）。理由成立：变更触碰 daemon claim 链（context.py/daemon.ts）与 daemon 拉取端点（跨进程契约）——集成证据已按门控要求提供（下方 Runtime Evidence + 集成验证回执，真实进程实测）。

## Runtime Evidence [层：人工判断]
- 长驻进程启动命令：uv run python .sillyspec/.runtime/verify-uvicorn-launcher.py（worktree backend 代码，commit 15a3e36ee9fe 起分支，修复后含 3adf56d53；127.0.0.1:8907，PID 41230 已登记 verify-services pids 文件，CLI 收尾回收）
- 触碰的服务端点：GET /api/daemon/mcp/config（无/有 user_id 两态）、GET /api/mcp-servers?scope=platform、GET /api/health
- 触发核心路径的请求：Bearer JWT（真实 admin 用户，真实 JWT 签发）→ 端点真实响应：case-a 200（platform_default.mcpServers 含种子 verify-integration-probe，PROBE_MODE=integration 回填，whitelist 键在=三键形状）；case-b 404（伪造 user_id lease 归属拦截）；case-c 200（列表含种子行）
- 进程日志关键片段：verify-integration-server.log（app.start + uvicorn 访问日志三条请求行）；修复前同一链路 503 + MASTER_KEY_MISSING/json equality 错误——修复后消除
- 生命周期终态断言：种子行 insert→断言→delete（PG 行数归零验证）；uvicorn PID 已登记，CLI verify --done 收尾自动回收
- 失败模式排除：渲染异常→503（task-05 单测 + 修复前实测负例）；解密失败→整 server 降级不炸渲染（task-04 单测）；daemon fetch 失败→本地回落（mcp-config.test.ts 503/网络错用例）；无 user_id 旧调用行为 golden 整包 == 锁定
- 不涉及：真实 daemon 进程长跑（claim→daemon 消费链由 backend 集成测试 + daemon wiring 测试双层覆盖，真机 E2E 留部署后）；部署编排（deploy compose 未变更）

## 代码审查 [层：人工判断]
问题列表（集成实测抓出并已修复）：render 整行 DISTINCT 在 PG 报 json 无等值算子（SQLite 单测不暴露）——commit 3adf56d53 修复（Python 按 id 去重）+ 真实 PG 复验。这例证明了 integration-critical 门控与真实进程取证的价值：153 个 SQLite 单测全绿仍漏 PG 方言 bug。
NOTES（预存环境问题，非本变更引入，建议用户处置）：
1. dev backend/.env 的 SILLYSPEC_MASTER_KEY 畸形（62 hex=31 字节，crypto 要求 32 字节）——本环境下一切 CredentialCipher 路径（含既有 llm_provider 加密读写）运行时都会 503/抛错；且 dev 库有 9 行 llm_provider 密文依赖某把历史 key，修复需用户决策（重新生成 key 则旧密文需重录）。本取证用一次性 v9 key 注入 verify 进程绕开，未动用户 .env。
2. McpRegistryService.__init__ 饿汉式初始化 cipher（service.py:172）——纯读路径也被 master key 配置扣死（畸形 key 时列表 503）。建议后续 lazy 化（cipher 仅写/解密路径需要）；已记为独立优化项。
3. daemon 端点渲染异常 503 时未记结构化日志（daemon_rpc.py:596 except 直接 raise，异常细节只进了 HTTPException from 链）——排障时只能复现，建议补 log.warning。已记为独立优化项。
总体评价：实现与设计高度一致，测试金字塔完整（183 backend/60 daemon/70 frontend 相关用例），跨进程契约（claim 透传/端点三键/授权三态）三层覆盖（单测+wiring+真实进程），预存环境缺陷未被本变更放大。可归档。
