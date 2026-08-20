# 项目触发团队操作功能审查报告（2026-08-21）

> 审查对象：项目维度发起团队 mission 的全链路（前端项目会话页 → `POST /api/projects/{pid}/missions` → `team_mission_entry` 主 agent spawn → MCP 5 工具驱动 worker → converge 收敛合并）。
> 依据设计：`.sillyspec/changes/archive/2026-08-19-cross-workspace-team-mission/design.md`。
> 审查方式：双路代码审查（后端链路 / 前端链路）+ 关键 P0 结论用 FastAPI TestClient 实测复现。
> 修复载体：quick 会话 `quick-4b518581`（ql-20260821-002-55bb），逐项修复并跑测试。

## 一、整体流程正确性结论

主链路（创建 → 鉴权 → scope 校验 → 主 agent spawn → MCP 派发 → 收敛）与设计文档一致的部分：

- `create_project_mission` 的项目经理鉴权（`_require_project_manager`）、scope ⊆ 项目关联校验、anchor ∈ scope 校验、anchor 缺省 backend-code 优先，均正确实现且有测试覆盖。
- 链路B（mcp_gateway）与 daemon 侧 `target_workspace_id` 透传已按 design §7.2 对齐。
- converge 按 target workspace 分组 merge、cleanup 同公式分组（Grill B-02）已实现。
- 前端 XSS 防线完整（全链路无 dangerouslySetInnerHTML），interval 均有清理。

但存在三处**流程级断裂**（不是单点 bug，是链路走不通/语义错）：

1. **取消链路完全不可用**（BE-P0-1）：cancel 端点因依赖解析缺陷对所有已认证请求 422，mission 无法取消。
2. **项目维度 mission 缺收敛兜底**（见 BE-P1-6 关联）：`schedule_loop` 的唯一接线点在 run 完成回调，但回调开头 `change_id is None` 即返回——项目维度 mission 按 D-008 不挂 change，主 agent 不主动 converge 时 mission 永久 running。
3. **主 agent 的 scope 在线状态输入恒错**（BE-P1-5）：prompt 里所有 scope 工作区一律显示"离线"，系统性误导主 agent 派发决策。

## 二、问题清单

严重程度：P0 = 安全/核心功能不可用；P1 = 重要缺陷（越权/挂死/泄漏/误导）；P2 = 一般（性能/健壮性/体验）。

### 后端

| 编号 | 级别 | 问题 | 位置 |
|---|---|---|---|
| BE-P0-1 | P0 | `POST /api/missions/{id}/cancel` 永久 422：`require_permission` 的 checker 声明 `workspace_id: Path(...)`，路由路径不含该参数，已认证请求 422（实测复现：`{"type":"missing","loc":["path","workspace_id"]}`）。附带：端点无 mission 归属校验 | `agent/router.py:1101`、`core/auth_deps.py:102-106` |
| BE-P0-2 | P0 | 跨 ws 越权派发：dispatch_worker 只要求调用者对 path 中一个 ws 有 WORKSPACE_WRITE（且 `_get_mission` 放宽到 scope 内任一 ws，比设计 D-006 的"锚=anchor"更宽），`target_workspace_id` 仅校验 ∈ scope，不校验调用者对 target 的权限。综合后果：scope 内 A ws 普通成员可向自己无权限的 B ws 注入带 Bash/Edit/Write 的 worker（representative binding 落到 B 成员机器执行） | `agent/mcp_tools.py:382-489`、`agent/execution.py:291-304` |
| BE-P1-1 | P1 | `list_missions` 用 `require_permission_any(TASK_READ)`（path 的 workspace_id 不参与鉴权，任意 ws 有 TASK_READ 即可列他人 ws 的 mission）；`get_mission` 无归属校验 | `agent/router.py:903-910`、`1082-1090` |
| BE-P1-2 | P1 | target ws 无 bound daemon 时 `git_worktree_add` 抛 `HostFsDelegateUnavailable`，run 已落库 pending 且无终态化路径 → mission 永久 running。scope 缺 binding 是"预检仅 warning 不阻断"明确放行的场景，非罕见路径 | `agent/mcp_tools.py:447-495`、`agent/execution.py:243-276` |
| BE-P1-3 | P1 | 收敛守卫先置位 `converged_at` 并 commit，再执行 finalize；finalize 抛异常无回滚，后续重进因 rowcount=0 直接返回 → merge/GLM 摘要永久丢失 | `agent/finalizer.py:602-624` |
| BE-P1-4 | P1 | worktree/分支两条泄漏路径：(a) failed worker 的 worktree 副本与分支永不清理（cleanup 只处理 completed）；(b) `converge_mission_for_completed_run`（complete_lease/schedule_loop 路径）从不调 cleanup_mission，仅 MCP converge 端点调 | `agent/execution.py:243-276`、`agent/finalizer.py:272-279、448-455、541-644` |
| BE-P1-5 | P1 | prompt 的 scope 在线状态恒"离线"：`query_daemon_online_by_id` SQL 含 `AND user_id=:uid`，orchestrator 传全零 UUID 占位（注释声称"不依赖 user_id"与实现不符）→ 查询恒 None | `agent/orchestrator.py:129-151`、`member_runtimes/queries.py:26-48` |
| BE-P1-6 | P1 | 主 run `pending + no_online_daemon` 无重派机制（注释承诺"靠 reconcile 重派"但不存在）；叠加项目维度 mission 的 run 完成回调被 `change_id is None` 短路，schedule_loop 对项目 mission 无触发点 → mission 挂死只能重启 | `agent/orchestrator.py:321-332`、`daemon/run_sync/service.py:1598-1600` |
| BE-P1-7 | P1 | 治理拒绝（max_workers_reached/budget_exceeded）把新 run 标 killed；killed ∈ _FAILED → 全部实际 worker 成功的 mission 也会 derive 出 degraded | `agent/mcp_tools.py:456-471`、`agent/mission.py:26、48-53` |
| BE-P2-1 | P2 | dispatch 治理门 check-then-act 竞态（先建 run 再 gate，无锁） | `agent/mcp_tools.py:447-456`、`agent/control.py:78-87` |
| BE-P2-2 | P2 | N+1/无上限输入：`_check_scope_bindings` 每 ws 2 查、render prompt 每 ws 3 查、`scope_workspace_ids` 无 max_length、`agent_missions.project_id` 无索引 | `agent/router.py:1145-1167`、`orchestrator.py:122-152`、`mission_schema.py:41`、`model.py` |
| BE-P2-3 | P2 | converge MCP 端点无"worker 全终态"前置检查：derive=running 时仍无条件重跑 merge+cleanup 返回 merged，主 agent 可提前"成功"收敛遗漏在跑 worker；成功场景同组分支 merge 两次 | `agent/mcp_tools.py:603-612、663-665` |
| BE-P2-4 | P2 | constraints 原样透传未滤保留键（用户可预置 `orchestration_mode:"external"`/`conflict_attempts`/`needs_manual` 操纵状态机）；objective 等无长度上限 | `agent/router.py:1253-1258`、`mission_schema.py` |
| BE-P2-5 | P2 | `worktree_path` 无归属校验（caller 传任意绝对路径作 daemon root_path） | `agent/mcp_tools.py:75-77`、`execution.py:217-218` |
| BE-P2-6 | P2 | 代表 binding "owner 优先"实现与语义不符：owner 分支条件是 `w.created_by = 发起用户`，发起人非 owner 恒落空 | `member_runtimes/queries.py:324-395` |
| BE-P2-7 | P2 | dispatch 链路 5+ 次独立小事务，`dispatch_to_daemon` 内部 commit 会卷入调用方未提交变更 | `agent/placement.py:484-540` |
| BE-P2-8 | P2 | daemon 离线时 lease 唤醒广播到所有已连接 daemon | `agent/placement.py:1513-1528` |

### 前端

| 编号 | 级别 | 问题 | 位置 |
|---|---|---|---|
| FE-P1-1 | P1 | 终态 `degraded` 被归入 ACTIVE：终态任务每 10s 永久轮询 + 显示"取消任务"按钮（点击会把部分完成改成已取消，语义错误） | `mission-console.tsx:70、964-968、1208-1214` |
| FE-P1-2 | P1 | mission 轮询无竞态守卫：在飞请求 resolve 后覆盖用户新选中的 mission（历史切换/新建场景真实存在） | `mission-console.tsx:956-962、1063-1071` |
| FE-P1-3 | P1 | worker 日志增量游标方向错误：`after=最早一条`使每次轮询重拉近乎全量日志（上限 5000 行/次/worker，TEXT 大列） | `mission-console.tsx:308-315、340-342` |
| FE-P1-4 | P1 | 非项目经理无前端门禁：可见可点入口、表单完整可用，提交才 403；历史区 403 被静默吞掉显示"无历史"（误导） | `ppm/projects/page.tsx:164-170`、`mission-console.tsx:948-950` |
| FE-P2-1 | P2 | `missing_bindings` 警告只活在创建响应里（后端只塞响应不落库），10s 后轮询覆盖即消失，违背 R-04 持续提示意图 | `mission-console.tsx:872-889`、`router.py:1283-1286` |
| FE-P2-2 | P2 | scope 缺失时 `Math.max(len,1)` 伪造"1 个工作区"计数 + crossWorkspace 误判 | `mission-console.tsx:853、1240-1243` |
| FE-P2-3 | P2 | 轮询无退避/页面隐藏不暂停/错误全吞；日志首拉失败显示"暂无日志"误导 | `mission-console.tsx:956-962、365-370、358-362` |
| FE-P2-4 | P2 | budget 输入 0/负数/Infinity 静默按"不限"提交 | `mission-console.tsx:989-994、1159-1167` |
| FE-P2-5 | P2 | 非 ApiError 用 `String(e)` 可能渲染 `[object Object]`；未复用 `errMessage` 工具 | `mission-console.tsx:1023、1040` |
| FE-P2-6 | P2 | `?mission=` 深链不校验 mission 归属项目；失败静默回创建态 | `mission-console.tsx:929-937` |
| FE-P2-7 | P2 | 历史列表硬编码 limit 20 无分页（后端上限 50，第 21 条起不可见） | `mission-console.tsx:943` |
| FE-P2-8 | P2 | projectId 为空时页面永久 loading（防御分支缺失） | `projects/[id]/missions/page.tsx:34-44、98-102` |
| FE-P2-9 | P2 | 过期注释声称后端 anchor 缺省比对 "backend" 永不命中（后端已改 backend-code），误导维护者 | `mission-console.tsx:166-171` |

## 三、修复范围决策

**本次 quick 修复**（安全 + 挂死 + 高频误导类）：

- BE-P0-1：cancel 路由入口依赖改 `get_current_user`（原 `require_permission` 的 path 参数依赖导致恒 422），归属校验收敛到新 helper `_require_mission_access`（anchor/scope 写权限或项目经理/超管）。URL 不动保前端兼容。
- BE-P0-2：dispatch_worker 显式 target ≠ path ws 时校验调用者对 target 的 WORKSPACE_WRITE，daemon apiKey 通道豁免（主 agent 编排链路，设计 D-006）；链路B（mcp_gateway token 通道）同款校验 actor（token 属主）。
- BE-P1-1：list_missions 改 `require_permission(TASK_READ)`（path 正好有 workspace_id）；get_mission 加 `_require_mission_access(write=False)`。
- BE-P1-2：execution 捕获 `HostFsDelegateUnavailable` → run 标 failed + error_code=hostfs_unavailable（契约从 503 fail-loud 改为 201 + 终态 run，主 agent 可从 worker 状态读原因，mission 不挂死）。
- BE-P1-3：finalize 失败时回滚 `converged_at=NULL` 并重抛，下次 worker complete / schedule_loop 可重新 claim 重跑。
- BE-P1-4：cleanup 的 run 过滤从 completed 扩到全部终态；`converge_mission_for_completed_run` 的 execute 全 merged 路径接 cleanup（complete_lease/schedule_loop 自动收敛不再残留副本；conflict 仍保留副本 X-003）。
- BE-P1-5：在线判定改传 binding 属主 user_id（原全零 UUID 使查询恒 None）。
- BE-P1-6：新增 `OrchestratorService.redispatch_pending_main_runs`，main.py lifespan startup 接线（对齐 cleanup_stale_runs / gate reconcile 模式）；修正"靠 reconcile 重派"的撒谎注释。
- BE-P1-7：治理拒绝先 gate 再建 run（链路A 拒绝抛 400 + reason；链路B 抛 `MCP_400_DISPATCH_WORKER_REJECTED`），不再产生 killed run 污染 derive_status。
- BE-P2-4（部分）：`_sanitize_constraints` 剥离保留键（orchestration_mode/conflict_attempts/needs_manual，两个创建入口）；objective max_length=8000、budget_usd ge=0、worker_preset/scope max_length=20。
- BE-P2-2（部分）：`agent_missions.project_id` 索引（model + migration 20260821100000）。
- FE-P1-1：ACTIVE 集合去掉 degraded（终态不再轮询/显示取消按钮）。
- FE-P1-2：`displayedMissionIdRef` + `selectMission` 竞态守卫（切换 mission 丢弃在飞轮询响应）。
- FE-P1-3：日志游标 `earliestTimestamp` → `latestTimestamp`（after=最新一条，消除每 5s 全量重拉）。
- FE-P2-4：budget 输入 0/负数/Infinity 阻断提交并提示。
- FE-P2-5：复用 `errMessage`（杜绝 `[object Object]` / 网络错误英文直出）。
- FE-P2-8：projectId 缺失时渲染错误态（不再永久 loading）。
- FE-P2-9：更新 anchor 默认的过期注释（后端已按 backend-code 词表比对）。
- FE-P1-4（部分）：listProjectMissions 403 显式提示"仅项目经理可查看"（入口级门禁需产品决策，暂不做）。
- 随附：`pnpm gen:types` 重新生成 openapi.json + api-types.ts（schema 校验变更同步）。

**登记不做**（设计权衡/重构面大，后续变更处理）：BE-P2-1（并发闸）、BE-P2-3（converge 契约重构）、BE-P2-5（路径归属）、BE-P2-6（owner 语义）、BE-P2-7（事务边界）、BE-P2-8（广播收敛）、FE-P2-1（需定警告落库语义）、FE-P2-2/3/6/7、BE-P1-6 的"项目维度 mission 收敛兜底接线"（涉及 run_sync 回调契约改动，单独变更处理）。

## 四、修复记录

修复载体：quick 会话 `quick-4b518581`（ql-20260821-002-55bb）。

**后端**（`app/modules/agent/`、`app/modules/mcp_gateway/tools.py`、`app/main.py`、`migrations/versions/20260821100000_*.py`）：

| 项 | 文件 | 验证 |
|---|---|---|
| BE-P0-1/P1-1 | router.py（cancel/get/list + `_require_mission_access`/`_require_project_manager_or`） | 新增 `tests/test_mission_access_control.py` 8 用例（超管取消 200 / 越权 403 / scope 成员 200 / 项目经理 200 / 越权读 403 / 成员读 200 / 非成员列表 403） |
| BE-P0-2 | mcp_tools.py（JWT 通道校验 + apiKey 豁免）、mcp_gateway/tools.py（actor 校验） | test_mission_access_control.py 2 用例（JWT 越权 403 / apiKey 豁免 201） |
| BE-P1-2 | execution.py（HostFsDelegateUnavailable → failed） | 既有 11 个 503 断言测试更新为新契约（201+failed+hostfs_unavailable） |
| BE-P1-3 | finalizer.py（converged_at 回滚） | 既有 finalizer 套件回归 |
| BE-P1-4 | finalizer.py（终态过滤 + 自动收敛接 cleanup） | test_integration_cross_workspace cleanup 计数断言更新（双路径幂等） |
| BE-P1-5 | orchestrator.py（binding 属主 user_id） | test_orchestrator_project_context 回归 |
| BE-P1-6 | orchestrator.py（redispatch_pending_main_runs）+ main.py startup 接线 | agent/daemon 套件回归 |
| BE-P1-7 | mcp_tools.py + mcp_gateway/tools.py（gate 前置） | test_tools_new.py 治理拒绝用例改写 |
| BE-P2-4b | mission_schema.py + router.py（_sanitize_constraints） | schema 校验 + agent 套件回归 |
| BE-P2-2b | model.py + migration 20260821100000 | alembic head 链校验 |

后端回归：`agent + mcp_gateway + daemon` 三模块 **1518 passed**。

**前端**（`mission-console.tsx`、`projects/[id]/missions/page.tsx`）：

| 项 | 验证 |
|---|---|
| FE-P1-1/2/3/5/9 | mission-console.test.tsx 游标 2 用例更新为新语义；missions-page.test.tsx 新增 degraded 终态用例 |
| FE-P2-4 | missions-page.test.tsx 新增 budget 阻断用例 |
| FE-P1-4（403 提示） | missions-page.test.tsx 新增 403 提示用例 |
| FE-P2-8 | page.tsx 空 id 错误态（组件级无独立用例，行为简单） |

前端回归：`pnpm test` 全量 + `tsc --noEmit` 0 错误。
