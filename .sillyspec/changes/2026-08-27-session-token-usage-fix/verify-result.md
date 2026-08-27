# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论必须写明 PASS / FAIL**——
> 留「待填」会被 gate 判不过（fail-closed）。

## 结论：PASS
（9/9 任务完成、6 探针无阻断项、变更相关测试 115 用例全绿、独立 QA 验收 pass/pass；唯一未执行项为"部署后真实会话集成冒烟"——本地 Docker 跑的是旧镜像，属部署动作非代码缺陷，已列变更风险等级的待部署确认项）

## 任务完成度
| task | 状态 | 证据 |
|---|---|---|
| task-01 spike | ✅ | spike-r09.md（7 会话 28 轮降级实证，结论：维持权威覆盖不预置 fallback） |
| task-02 daemon | ✅ | session-manager.ts turn 级计数器 13 处符号；主仓 grep 核验 |
| task-03 daemon 测试 | ✅ | turn-usage.test.ts 7 例（23/23 绿含回归） |
| task-04 列+迁移 | ✅ | model.py ctx_tokens + 迁移 20260827230000（dev PG 往返验证） |
| task-05 backend 接线 | ✅ | service.py 18 处 / router.py 3 处（提取/写回/publish/SessionRead） |
| task-06 backend 测试 | ✅ | test_run_sync_ctx_tokens.py 7 例 + endpoint 1 例（49 passed 含回归） |
| task-07 类型链 | ✅ | api-types/openapi/daemon.ts（envelope+SessionRunRead 镜像，执行期补录） |
| task-08 前端环 | ✅ | session-panel 13 处（reduceRight 逆序）/ctx-usage-bar 可空/turn-timeline 字段 |
| task-09 前端测试 | ✅ | 24 用例新 + page.test fixture 修正（43/43 绿） |

## 设计一致性
与 design.md 一致，三处已备案偏差（均有依据非偏离）：
1. task-03 四类断言整合进新文件 session-manager-turn-usage.test.ts（原计划扩三个既有文件；覆盖等价、既有文件零改动零回归）
2. task-07 执行期补录 daemon.ts SessionRunRead 镜像跳（卡面未列，QA 发现类型链缺口后主代理授权补齐）
3. task-09 扩 page.test.tsx（fixture 补 ctx_tokens 一行；design §6 已补行 + 卡 allowed_paths 已扩，主代理批准）
另：QA 非阻断观察 flushedUsage 轮边界未重置——跳过条件为四字段全等（语义自洽的去重跳过，非缺陷），不改码记档。

## 探针结果（CLI 机械预填）
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：sillyhub-daemon/tests/interactive

#### 探针 2：设计关键词覆盖
逐词 grep 主仓实现命中：ctx_tokens（daemon/backend/frontend 全链）、turn 级计数器（turnInput/turnOutput 13 处）、轮边界清零（_onResult 清 main 桶）、last-write-wins（backend 直接赋值 + 测试断言 100→50）、逆序最新非 null（reduceRight + ?? 链）、未知态（pct=null「—」分支 + 测试）、终态不覆盖（close 零触碰 + 测试 reload 断言）。全部命中，无未实现关键词。

#### 探针 3：验收标准测试覆盖
- ⚠️ task-01: 模块目录（.sillyspec/changes/2026-08-27-session-token-usage-fix、sillyhub-daemon/src/interactive）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-02: 模块目录（sillyhub-daemon/src/interactive）递归未找到测试文件（含 co-located tests/）
- ✅ task-03: 模块目录（sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-mcp-kill-cleanup.test.ts …）
- ✅ task-04: 模块目录（backend/app/modules/agent、backend/migrations/versions）找到 15 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-05: 模块目录（backend/app/modules/daemon/run_sync、backend/app/modules/daemon）找到 11 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/host_fs/tests/test_delegate.py、backend/app/modules/daemon/host_fs/tests/test_delegate_integration.py、backend/app/modules/daemon/host_fs/tests/test_delegate_nfr.py …）
- ✅ task-06: 模块目录（backend/app/modules/daemon/tests）找到 10 个测试文件（backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py、backend/app/modules/daemon/tests/test_allowed_roots_policy_push.py …）
- ✅ task-07: 模块目录（frontend/src/lib、backend）找到 57 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts、frontend/src/lib/ppm/execute-time.test.ts …）
- ✅ task-08: 模块目录（frontend/src/components/daemon、frontend/src/components/sessions）找到 15 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx、frontend/src/components/daemon/__tests__/attachment-chips.test.tsx …）
- ✅ task-09: 模块目录（frontend/src/components/sessions/__tests__、frontend/src/components/daemon/__tests__、frontend/src/app/(dashboard)/sessions/__tests__）找到 16 个测试文件（frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/__tests__/sessions-portal.test.tsx …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
D-001@v2→FR-02→task-01/02/05→spike-r09+轮级计数器+权威覆盖 ✅；D-002@v1→FR-01→task-04/05/08→列+SSE+环读取 ✅；D-003@v1→FR-01→task-08/09→null 未知态用例 ✅；D-004@v1→FR-02→task-02/08→徽标本轮语义（turn-timeline 仅加字段） ✅；D-005@v1→FR-03→task-05/07→usage 附带管线全链 ✅；D-006@v1→FR-01→task-02/03→main 桶限定+子桶无键用例 ✅。D-001@v1 superseded 不计。无未闭环决策、无 P0/P1 unresolved。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2350 backend endpoints (live [scan-root 505] + artifact 2020), 0 frontend calls [scope: change-diff (32 files @ scan-root)] | 700 backend endpoints unused by frontend
- ⚠️ 700 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果
- daemon：`pnpm test -- --run` 4 文件（turn-usage/usage-cache/budget/subagent-shrink）→ 23/23 passed
- backend：`uv run pytest -q --no-cov` 5 文件（ctx_tokens/endpoint/cache-parse/sse/close-model-error）→ 49 passed
- frontend：`pnpm test -- --run` 3 文件（ctx-usage-bar/session-panel-ctx-tokens/page）→ 43/43 passed
- 静态：daemon `pnpm typecheck` 0 错；frontend `tsc --noEmit` 0 错；backend ruff All passed + mypy 0 issues
- known_failures 豁免（4 例，均有基线取证）：frontend 全量套件 4 个失败在 HEAD=ddf42787 基线（临时基线 worktree，无本变更任何改动）逐字节复现——session-panel-variant（建流 3 参断言过时：HEAD 代码已传 {cursor,initialSync} 第三参）、session-panel-dialog-attachments ×2（附件入口 title 断言过时）、session-panel-ux-fixes（/team 回填断言过时）。均属其它已提交/在途变更的测试债，与本变更 diff 零交集（本变更未触碰建流调用/附件 title/team 回填路径）。已按 local.yaml known_failures 机制登记豁免并实证（frontend 全量输出 383 个"失败行"全部命中豁免、judge=passed）：真实失败 4 行按文件名模式豁免；其余 379 行为工具缺陷假阳性（vitest 输出中 ✓ 通过行/stderr 噪声块/汇总行/退出横幅/jsdom 告警/断言详情行被 PER_TEST_FAIL_RE 误判，ANSI 色码还会拆散多词模式）。清单偏宽（judge 提示人工复核），local.yaml 注释已按 A 工具缺陷 workaround / B 预存债两类标注临时性与收缩条件；缺陷按规则 15 记录于 docs/sillyspec/verify-known-failures-pass-line-false-positive.md（修复建议：✓ 前缀剔除/结构化解析/SUMMARY_LINE_RE 增补）。归属变更收尾修复 4 个过时测试后应整体收缩。
- 集成冒烟（plan 全局验收 4）未执行：本地 Docker 为旧镜像（见风险等级节）。

## 决策追踪矩阵（如存在 decisions.md；无则删本节）
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v2 | FR-02, FR-03 | 01/02/05 | spike-r09.md；session-manager 轮级计数；close 权威覆盖 | closed |
| D-002@v1 | FR-01 | 04/05/08 | AgentRun.ctx_tokens 列 + 环读取链 | closed |
| D-003@v1 | FR-01 | 08/09 | 全 null「—」未知态 + 测试 | closed |
| D-004@v1 | FR-02 | 02/08 | 轮级实时值 + 徽标终态定格（turn-timeline 仅加字段） | closed |
| D-005@v1 | FR-03 | 05/07 | usage 附带管线 13 跳无 dormant（QA 核验） | closed |
| D-006@v1 | FR-01 | 02/03 | ctx 仅 main 桶 + 子桶无键断言 | closed |

## 技术债务
探针 1 零命中。遗留观察（非债务）：flushedUsage 轮边界未重置（自愈性，QA 记档）；既有 budget 测试一处 fixture 弱点（parent_tool_use_id 在 event 内层实落 main 桶，task-03 已备注，新用例以顶层真实路由覆盖）。

## 变更风险等级
integration-critical（CLI 判级，命中 session/daemon/AgentRun 关键词，无显式覆盖）。理由成立：变更触碰 daemon↔backend↔frontend 三方 usage 契约与 DB 列。单元/契约层已充分验证（115 用例含 SSE payload/DB 行状态/端到端 mock 流）；**运行时集成证据待部署后补**：本地 Docker 跑旧镜像（backend 容器无 ctx_tokens 逻辑），真实会话 2+ 轮的环数值验证（plan 全局验收 4）需镜像重建部署后人工确认——非代码缺陷，是验证环境限制，明确列为本报告遗留项而非降级。

## Runtime Evidence
- 迁移运行时证据（task-04，2026-08-28 00:0x）：dev PG（multi-agent-platform-postgres-1 / 127.0.0.1:5432）alembic upgrade head 后 information_schema 实测 `ctx_tokens | integer | YES`，downgrade -1 列删除、再 upgrade 复原——双向可逆实跑。
- DB 实证（spike-r09，7 会话 28 轮）：agent_runs 值形态分析支持 result=Σ per-call；completed run 覆盖干净 / failed run 残留 live 值互证。
- SSE/REST 契约：测试内 _RecordingPipeline 录得 run channel summary 与 session channel tokens 事件 payload 实际含 ctx_tokens=62000；None 场景两路无该键；GET /sessions/{id}/runs 响应含 ctx_tokens=12345 / null。
- 生命周期终态断言：close 后 closed.ctx_tokens==62000（reload 确认 commit）、input/output 被终态覆盖（test_run_sync_ctx_tokens.py:500-520）。
- 启动命令/端点/日志片段：不涉及（未部署新镜像）；真实会话冒烟：待部署（见风险等级节）。
- commit hash：变更尚未 commit（用户统一提交）；worktree 分支 sillyspec/2026-08-27-session-token-usage-fix 已 apply+cleanup，产物在主仓暂存区。

## 代码审查
问题列表：无阻断问题。非阻断观察 4 项（flushedUsage 微边界/task-03 整合新文件/浮层一句 P3 文案/集成冒烟待部署）已在设计一致性与技术债务节如实记录。总体评价：实现与设计高度一致，契约链完整，测试断言真实有效（DB 行状态/reload/渲染内容级），三栈静态检查全净。
