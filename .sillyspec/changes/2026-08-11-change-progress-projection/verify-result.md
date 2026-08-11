---
author: qinyi
created_at: 2026-08-11 22:16:48
change: 2026-08-11-change-progress-projection
verifier: claude-opus-4-8[1m]
stage: verify
result: PASS
---

# 验证报告（Verify Result）— 变更中心接入进度同步层（workspace 隔离 + 实时投影）

> 核验对象：worktree 分支 `sillyspec/2026-08-11-change-progress-projection` @9cb18281（主仓 6 commit）+ sillyspec 仓 main @16b30b7（跨仓 task-09/10）。worktree apply 回 main 在 verify 通过后执行（记忆 [[sillyhub-platform-sync-change]] 坑④）。

## 结论

**PASS（实现层）— 但 CLI 对账被 worktree 模式流程死锁阻断（非代码缺陷）**

实现层判定 **PASS**：12/12 task 全实现，六探针全过，设计一致性 PASS，worktree 分支全量测试实测绿（pytest 233 / ruff 0 / mypy 14 / tsc 0 / vitest 1402 / sillyspec 168），D-006 安全闭环三态实测，投影层 read-only 实测。

**CLI 对账阻断（流程死锁，非本次变更代码问题）**：verify Step7 --done 时 CLI 在**主仓 main**执行 local.yaml commands.test，但主仓 main **没有本次变更的实现代码**（.py 全在 worktree 分支 sillyspec/2026-08-11-change-progress-projection @9cb18281 未 apply 回主仓）。CLI 在主仓跑 platform_sync/change 子模块测试 → 16+208 errors，根因 `NoReferencedTableError: agent_profiles.llm_provider_id could not find table 'llm_providers'`，这是**主仓 main 的预存 conftest import 债**（platform_sync/change tests conftest 未 import llm_provider 模型 → create_all 时 FK 崩），与本次变更无关。

**对照证据（worktree 分支同命令全绿）**：
- worktree `pytest app/modules/platform_sync`（隔离跑，模拟 CLI 跑法）：**21 passed**
- worktree `pytest app/modules/change`：**212 passed, 2 skipped**
- worktree `pytest app/modules/platform_sync app/modules/change`（合并跑）：**233 passed, 2 skipped**
- 主仓 main 同命令：16 errors + 208 errors（NoReferencedTableError，预存债）

主仓 main 的 platform_sync 测试仅 16 个（全是前置 change sillyhub-platform-sync 的 test_router.py，非本次新增的 test_workspace_router.py 5 用例——后者未 apply 回主仓）。即 CLI 对账 fail 的测试 100% 是主仓既有 broken state，非本次变更新增或修改的测试。

本变更是跨仓进度同步层 + 只读投影，不触碰 stage/lease/session/agent_run 等生命周期事件（design §7.5 声明 N/A），无 runtime 集成风险。

**破局需用户决策**（见报告末「下一步 / 流程死锁」）。

## 任务完成度

12/12 ✅（100%）。

| Task | Wave | 内容 | 状态 | 实测证据 |
|---|---|---|---|---|
| task-01 | W1 | `platform_sync/token_model.py` PlatformSyncTokenORM（workspace_id/token_hash/created_by/name/scope/last_used_at/revoked_at/created_at，无 key_prefix/expires_at） | ✅ | 文件存在 94 行，字段集对齐 design §8.1 |
| task-02 | W1 | `model.py` PlatformChangeProgressORM 加 workspace_id（nullable）+ 复合唯一 `(workspace_id, change_name)` | ✅ | model.py:36-60，nullable 处理 shk_live_ 过渡期 None 可写（design §9） |
| task-03 | W1 | alembic migration 建表 + 加列 + 复合唯一（棕地免回填） | ✅ | `migrations/versions/20260811150000_platform_sync_workspace.py` 存在 |
| task-04 | W2 | `token_service.py` create（shpsync_+secrets 32B，存 sha256）/ authenticate（hash O(1) 查表派生 user=created_by + workspace_id） | ✅ | token_service.py:62/112，shpsync_ 前缀常量 :40 |
| task-05 | W2 | `auth.py` require_platform_sync 返 `(User, workspace_id\|None)`，shpsync_/shk_live_/JWT 三路径分流 | ✅ | auth.py:69-85，shpsync_ 派生 / shk_live_ 过渡返 None |
| task-06 | W3 | `service.py` upsert/list/get 全加 workspace_id（`is_(None)` 处理 NULL） | ✅ | service.py:52-184，`is_(None)` 正确处理 SQL `=` 不匹配 NULL |
| task-07 | W3 | `workspace_router.py`（2 新端点）+ `schema.py`（3 DTO）+ `main.py` include_router + `router.py` 3 端点取 workspace_id + D-006 WORKSPACE_WRITE 校验 | ✅ | workspace_router.py:118-180 resolve-by-root-path 手动 has_permission（workspace_id 来自 body 反查非路径）；main.py:589 注册；schema.py:71-77 |
| task-08 | W4 | `change/service.py` `_project_current_stage` 批量 IN join（read-only）+ enrich_summaries/enrich_with_workspace_ids 双覆盖 + fallback，不投 status | ✅ | service.py:1219-1290，复合 IN tuple_().in_()，read-only select 无写，_extract_current_stage 防御性 isinstance |
| task-09 | W5跨仓 | `sillyspec/src/sync.js` connect 调 resolve-by-root-path 换发 shpsync_ + replaceTopLevelSection 写 platform 段（保留注释） | ✅ | sillyspec 仓 16b30b7，sync.js:277-308，404/403/断网降级沿用原 token（best-effort） |
| task-10 | W5跨仓 | 契约 `sillyhub-progress-sync-contract.md` 补 §14 workspace 隔离（5 小节） | ✅ | 契约 :225-270，§3 body 零删改（NG-2） |
| task-11 | W6 | `pnpm gen:types` 同步 api-types.ts + openapi.json | ✅ | api-types.ts:7503/7525 两端点 + 12026/12037/13904 三 DTO；openapi.json 命中 9 处 |
| task-12 | W6 | 各模块 pytest + connect 联调 + R-06 排查 | ✅ | platform_sync test_router/test_workspace_router + change test_enrich_projection/test_projection 齐全；R-06 transient 不可复现 |

## 设计一致性

对照 design.md（truth source）逐章核验：

- **§5.1 架构数据流** ✅ 全链实现：shpsync_ 签发（token_service.create）→ authenticate 派生 (user=created_by, workspace_id)（auth.py）→ router 注入（router.py:62 解包）→ service 写 platform_change_progress.workspace_id（service.py upsert）→ enrich join 读（change/service.py _project_current_stage）。
- **§7 接口签名** ✅ require_platform_sync 返 `tuple[User, uuid.UUID | None]`，workspace_id 只取自 platform_sync_tokens.workspace_id（token 派生唯一通道），绝不信任 body。
- **§7.5 生命周期契约** ✅ N/A 确认：本变更只读投影 current_stage，不触碰 stage 流转/lease/session/agent_run/daemon/claim/heartbeat。require_platform_sync 改返回值只影响 platform_sync 模块内部（3 端点全在该模块内，无外部 lifecycle 消费方）。
- **§8.1 PlatformSyncTokenORM 字段集** ✅ 参照 McpToken+ApiKey，含 created_by（authenticate 派生 User 来源），不含 key_prefix/expires_at。
- **§8.2 PlatformChangeProgressORM 改造** ✅ 加 workspace_id nullable + 复合唯一；PK 设计 §8.2 vs §9 一致性矛盾已由用户决策 A 解决（nullable+复合唯一约束，非 PK 改复合——SQL PK 不允许 NULL，故用唯一约束容纳过渡期 NULL 行，design §8.2:11 注释已述）。
- **§9 兼容策略（brownfield）** ✅ shk_live_ 过渡期 workspace_id=None 行投影 join 不命中走 fallback；工具未上行 change join 不到 fallback 现有值；quick-<uuid8> 不建目录 join 不命中 fallback（预期行为）。
- **§10 风险登记** ✅ R-01（change_key==change_name 命名一致）Grill 已核实同源；R-03（N+1）list 批量 IN 解决；R-06 transient；R-07（404）+ R-08（403 闭环）实测。
- **命名差异（非缺陷）**：design §6 写 `PlatformSyncTokenCreated`，实现为 `PlatformSyncTokenCreateResponse`（Pydantic 响应模型命名惯例，含 Request/Response 成对），同义。

## 探针结果

- **探针1 未实现标记扫描**：变更 11 源码文件 + sync.js 扫 TODO/FIXME/HACK/XXX **全空**。
- **探针2 关键词覆盖**：shpsync_(15)/workspace_id(24)/resolve-by-root-path(7)/platform-sync-tokens(6)/WORKSPACE_WRITE(5)/current_stage(8)/replaceTopLevelSection(1)/_project_current_stage(1)/PlatformSyncToken(14)/PlatformChangeProgress(9) —— 10 核心词全命中。
- **探针3 测试覆盖**：platform_sync（test_router + test_workspace_router）、change（test_enrich_projection 6 用例 + test_projection 4 用例）co-located tests 齐全；跨仓 task-09 connect 换发由既有 local-yaml-preserve + platform-sync-user-config 套件覆盖（sillyspec 168 全过）。集成盲区：connect 跨仓端到端（sillyspec 工具 → backend resolve-by-root-path）由 sillyspec 仓 platform-sync-user-config 测试实测换发降级路径覆盖，非纯 mock。
- **探针4 决策追踪覆盖**：D-001@v1~D-006@v1 全 accepted；D-004@v2 supersedes D-004@v1（design §11 + decisions.md :66 已注）；requirements 决策覆盖矩阵 + plan 覆盖矩阵三处交叉闭环；无 stale 引用；无 P0/P1 unresolved/blocking。
- **探针5 API 契约对账**：backend openapi 注册 2 新端点（POST /api/workspaces/{workspace_id}/platform-sync-tokens、POST /api/workspaces/resolve-by-root-path）；前端无直接调用 = **预期**（design NG-7 明示不做 token 管理 UI，两端点供 sillyspec 工具 connect 消费，非前端 UI），非 contract gap。
- **探针6 代码删除对账**：worktree 分支 vs baseline b9a76f95 `git diff --name-status` 无 D/R 文件，纯新增/修改。无切斯特顿栅栏风险。

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 workspace 归属=token 派生 | FR-01, FR-02 | task-01,04,05,06 | token_model.py + token_service.py create/authenticate + auth.py 派生 + service.py 复合键；test_workspace_router::test_writer_can_create_and_plaintext_returned_once | PASS |
| D-002@v1 投影=实时 read-only join | FR-04 | task-08 | change/service.py _project_current_stage 批量 IN；test_enrich_projection::test_enrich_single_hit_overwrites_current_stage + test_enrich_list_batch_in_covers_hits_and_misses | PASS |
| D-003@v1 工具上行权威+未上行 fallback | FR-04, FR-05 | task-08 | _project_current_stage 未命中不进映射；test_enrich_projection::test_enrich_single_miss_falls_back_to_existing | PASS |
| D-004@v2 撤销 status 投影 | FR-06 | task-08 | enrich 只覆盖 current_stage，不读 latest_progress.changes[0].status；test_enrich_projection 注释 :8「status 不被投影」 | PASS |
| D-005@v1 平台→local.yaml 下发通道 | FR-03 | task-07,09,10 | workspace_router resolve-by-root-path + sync.js connect replaceTopLevelSection + 契约 §14.3；sillyspec platform-sync-user-config 测试 | PASS |
| D-006@v1 resolve-by-root-path WORKSPACE_WRITE | FR-03 | task-07,09 | workspace_router.py:134 手动 has_permission（workspace_id body 反查非路径）；test_workspace_router::test_resolve_no_workspace_write_403 + test_resolve_root_path_not_found_404 | PASS |

## 测试结果

全部本步骤真实执行（worktree + sillyspec 仓实测，非自报告）：

| 套件 | 命令 | 结果 |
|---|---|---|
| backend pytest（platform_sync + change 子模块，命中 local.yaml test_strategy=module） | `uv run pytest app/modules/platform_sync app/modules/change -q --no-cov` | **233 passed, 2 skipped** |
| ruff check | `uv run ruff check app/modules/platform_sync app/modules/change` | **All checks passed** |
| ruff format --check | `uv run ruff format --check ...` | **42 files already formatted** |
| mypy | `uv run mypy app/modules/platform_sync app/modules/change/service.py` | **Success: no issues in 14 source files** |
| 前端 tsc | `pnpm exec tsc --noEmit` | **0 errors** |
| 前端 vitest | `pnpm exec vitest run` | **1402/1402 passed**（144 test files） |
| sillyspec 仓全量 | `node test/run-tests.mjs` | **168/168 passed**（含 local-yaml-preserve + platform-sync-user-config） |
| sync.js 语法 | `node --check src/sync.js` | **OK** |

关键测试用例（覆盖核心决策）：
- `test_workspace_router::test_writer_can_create_and_plaintext_returned_once` — FR-01 shpsync_ 签发 + 明文仅 201 一次
- `test_workspace_router::test_non_writer_cannot_create_token` — 403 权限门控
- `test_workspace_router::test_resolve_root_path_not_found_404` — R-07 反查不到
- `test_workspace_router::test_resolve_no_workspace_write_403` — **D-006 安全闭环核心**
- `test_workspace_router::test_resolve_admin_returns_token` — FR-03 connect 换发成功路径
- `test_enrich_projection::test_enrich_single_hit_overwrites_current_stage` — D-002 命中覆盖
- `test_enrich_projection::test_enrich_single_miss_falls_back_to_existing` — D-003 fallback
- `test_enrich_projection::test_enrich_list_batch_in_covers_hits_and_misses` — R-03 禁 N+1 批量 IN
- `test_enrich_projection::test_enrich_workspace_isolation_no_cross_talk` — **D-001 workspace 隔离不串值**
- sillyspec `local-yaml-preserve` — task-09 connect replaceTopLevelSection 保留注释/CRLF/其他段
- sillyspec `platform-sync-user-config` — task-09 connect 换发降级路径（404/403/断网沿用原 token）

环境债修复（非源码改动，不违反 verify 只读规则）：
- worktree backend `.venv` 缺 aiobotocore（缓存问题）→ `uv sync --reinstall-package aiobotocore` 补 3.8.0
- worktree frontend + sillyspec 仓 node_modules 缺 → `pnpm install --prefer-offline` 补
- 均为 worktree 隔离环境依赖缺失，与本次变更代码无关。

## 技术债务

- 探针1 扫描变更源码 TODO/FIXME/HACK/XXX **全空**，本次变更零技术债标记。
- 预存债（非本次引入，记忆已知）：worktree venv aiobotocore 缓存缺失；change 模块根 conftest 间接 import storage 链（本次新增 change/tests/conftest.py 已参照 platform_sync 模式单独 import 注册 platform_sync 两表，规避该链对投影测试的影响）。

## 变更风险等级

**risk_level 由 design frontmatter 显式声明 = `unit-sufficient`（覆盖关键词判级）。**

理由：design.md / plan.md 文本含 backend/lifecycle 等关键词（如 §7.5「生命周期契约」、收件箱 POST 端点属 backend），CLI detectChangeRisk 机械字面匹配会误判为 integration-critical。但实际：
1. 本变更是**只读投影层**（change 模块 enrich 从 platform_change_progress 读 current_stage 覆盖展示 DTO）+ workspace 隔离数据层，**不触碰** stage 流转 / lease / session / agent_run / daemon / claim / heartbeat 任何生命周期事件（design §7.5 明确声明 N/A，stage 实际推进仍由 sillyspec 工具 + 既有 change/transition/complete_stage 链路负责）。
2. 收件箱 3 端点（POST/GET progress）鉴权升级（require_platform_sync 返回值加 workspace_id）只影响 platform_sync 模块内部 3 端点，无外部 lifecycle 消费方（Grill 核实）。
3. resolve-by-root-path 是无状态换发端点（反查 workspace + 权限校验 + 签发 token），不涉及跨进程状态机。
4. 所有核心逻辑（token 签发/鉴权派生/workspace 隔离/投影 join/安全闭环）均由单元/模块测试覆盖实测，无需 daemon↔backend 真实集成运行时证据。

故真实等级 unit-sufficient（单元测试充分），显式声明覆盖关键词误判。PASS WITH NOTES 不被强制拦；本报告结论为 PASS。

## Runtime Evidence

本变更 risk_level = unit-sufficient（见上节显式声明），非 integration-critical / deployment-critical，**Runtime Evidence 章节 N/A**（不触发集成证据门控）。

核心逻辑实测覆盖（单元/模块级，非 mock-only）：
- D-006 安全闭环（403/404/201 三态）：test_workspace_router.py 5 用例真实 HTTP 请求断言 status_code
- 投影 read-only join（命中/fallback/隔离/批量）：test_enrich_projection.py 6 用例真实 DB session 断言 current_stage 覆盖与保留
- connect 换发降级（保留注释/404/403 沿用原 token）：sillyspec platform-sync-user-config + local-yaml-preserve 真实文件写入断言

R-06（本机 platform sync POST 500）：brainstorm 期间偶发，execute + verify 实测期稳定不可复现，结论 transient（沿用 execute 判断）。

## 代码审查

**总体评价**：实现质量高，严格遵循 design，无 bug 发现。

亮点：
- `_project_current_stage` 批量复合 IN join（`tuple_(workspace_id, change_name).in_(pairs)`）正确规避 N+1（R-03），且 `ws_id is not None` 过滤掉 shk_live_ 过渡期 NULL 行自然 fallback。
- `service.py` `_find_row` 对 workspace_id=None 用 `col(...).is_(None)` 而非 `==`（SQL `=` 不匹配 NULL，这是正确的细节处理，避免过渡期数据查询失效）。
- D-006 安全闭环实现到位：resolve-by-root-path 因 workspace_id 来自 body 反查（非路径参数），无法用 Depends(require_permission) 自动注入 RBAC，正确改用手动 has_permission——设计文档 §7 与代码注释 workspace_router.py:11-12 均明确说明此约束。
- require_platform_sync 三路径分流（shpsync_ 优先 → shk_live_ 显式前缀 → JWT fallback）避免把 JWT 误送进 ApiKeyService 的 O(n) bcrypt 扫库（auth.py:77 注释）。
- 跨仓 connect 换发采用 best-effort 降级（404/403/断网沿用原 token 不阻断 connect），符合工具侧容错原则。

命名差异（非缺陷，记录在案）：design §6 `PlatformSyncTokenCreated` → 实现 `PlatformSyncTokenCreateResponse`（Pydantic 响应模型命名惯例）。

无阻断问题。建议（非阻断，可后续）：design §6 文件清单的 schema 类名可同步更新为实际命名以消歧义，但不影响功能。

## 下一步 / 流程死锁

### 死锁诊断

verify Step7 的 CLI 测试对账（`sillyspec derive verify-test` / --done 门控）在**主仓 main** 执行 local.yaml `commands.test`（module-subset 模式命中 frontend/change/platform_sync）。但 worktree 隔离模式下本次变更的 **.py 实现全在 worktree 分支**（@9cb18281，6 commit），**未 apply 回主仓 main**。主仓 main 跑 platform_sync/change 测试触发预存 conftest import 债（`agent_profiles.llm_provider_id → llm_providers` FK NoReferencedTableError）→ 必 fail。

这是 SillySpec worktree 模式的流程设计缺陷：**verify CLI 对账要求主仓有实现，但 worktree apply 回主仓被安排在 verify 通过之后**——先有鸡还是先有蛋。记忆 [[change-progress-projection-change]] 坑④、[[sillyhub-platform-sync-change]] 坑④已记录此模式。

### drift 状态（apply 复杂度）

- 主仓 main HEAD (ab39ad57) 比 worktree baseline (b9a76f95) 多 2 commit（ql-006/007/008/010），platform_sync/model.py 等文件 main 已推进 → `worktree apply` 报 EXCLUDE-MISMATCH，需 --3way 合并或手动 cp rescue。
- 主仓有 40 个未提交改动（其他 change 的 .claude/.codex skills + 本次 spec 文档 staged + task-11 gen:types 产物 staged）→ `git apply` 不安全，apply --check-only 直接拒。
- task-11 gen:types 产物（api-types.ts/openapi.json）已在主仓 staged（含新端点），但 .py 实现未到主仓 → 主仓处于「类型有、实现无」的半成品态。

### 选项（需用户决策）

**选项 A（推荐）：先 apply 实现回主仓，再重跑 verify 对账**
1. 提交或暂存主仓未提交改动（.claude/.codex skills 等他者改动隔离 commit，避免裹挟）
2. `sillyspec worktree apply 2026-08-11-change-progress-projection --merge`（走 --3way 合并 drift），或手动 cp rescue（记忆 [[sillyhub-platform-sync-change]] 坑④模式：逐文件 cp 安全子集 + 手动 cleanup）
3. 主仓跑 `uv run pytest app/modules/platform_sync app/modules/change` 复验全绿
4. 重跑 `sillyspec run verify --done`，CLI 对账在主仓（现有实现）应过
风险：apply 阶段属「改 git 状态」，超出 verify 铁律「禁止 git checkout/restore/reset」字面——但 `sillyspec worktree apply` 是流程内官方命令（非裸 git 绕过），类比 archive 移文件。需用户授权在此处执行。

**选项 B：跳过 CLI 对账门控，人工背书 PASS 直接 archive**
`--skip-approval` 跳过 verify-test 门控，凭 worktree 实测 233 passed 证据人工判 PASS → archive。风险：绕过 CLI 机械对账，与规则 8「实证核验」精神有张力（但实证确已做，只是 CLI 在错误 cwd 跑）。

**选项 C：修复主仓预存 conftest 债后再对账**
在主仓 platform_sync/change tests conftest 补 `import llm_provider` 注册模型 → 主仓预存 16 errors 消失，但主仓仍无本次实现，对账跑的是旧实现（无 workspace_id），虽不崩但测不到新功能。不推荐（治标不治本）。

### 建议

**选项 A**。理由：worktree apply 回主仓是交付闭环的必经步骤（迟早要做），且 apply 后主仓有完整实现，CLI 对账能真实检验。apply 的 drift（2 commit）需 --3way 合并，但本次变更文件（platform_sync token/workspace_router/model 加 workspace_id 等）与 ql-006/007/008/010（ruff/locale）改动域不重叠，合并冲突概率低。

授权后执行顺序：隔离 commit 他者 staged → worktree apply --merge → 主仓 pytest 复验 → verify --done → archive。
