# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES——10/10 task 落地且与设计一致（G-3/G-4 两处执行期修正已回写声明），后端群链路 208 passed + 前端 322 passed + 真实集成（uvicorn+compose PG 独立库）端到端复验通过；notes 为存量触发链锁窗口（非本变更引入，见 Runtime Evidence）与宿主无子代理的降级自审模式。

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
无（per-task review 10/10 已在 execute 收尾补正式 pass verdict，统一 commit 模式 diffPaths 切片对账；无 cannot_verify 残留）。

## 集成验证回执 [层：自述声明——CLI 一致性校验]
- claim: 真实 backend 状态机端到端：独立库全链 alembic 迁移 → uvicorn 真进程 → HTTP 建群(consensus_mode)/PATCH 开关/多 @ 消息建任务 → sweeper 超时收口 aborted 持久化 + 状态卡落库 + 回放端点返回 consensus_card | command: uv run uvicorn app.main:app --host 127.0.0.1 --port 18099（env: verify_consensus 库/redis db3/minio/bootstrap admin）+ curl HTTP 脚本 + docker exec psql 断言 | exit: 0 | log: .sillyspec/.runtime/verify-consensus-uvicorn2.log
- claim: G-4 修复复验：consensus_sweep_once 补 commit 后，手动过期任务经 30s 扫描轮从 open → aborted（converged_at 填充），agent_run_logs 出现 channel=system 且 metadata.consensus_card.phase=aborted 行（task_id 匹配）；修复前同场景 processed=1 但 status 仍 open（随会话关闭回滚） | command: docker exec multi-agent-platform-postgres-1 psql -U platform -d verify_consensus -c "SELECT id,status,converged_at FROM agent_group_consensus_tasks;" | exit: 0 | log: .sillyspec/.runtime/verify-consensus-uvicorn2.log

## 任务完成度 [层：人工判断]
- task-01 ✅：AgentGroupChat 两列（consensus_mode/consensus_timeout_seconds）+ agent_group_consensus_tasks 建表三索引；迁移 20260910130000 双向（独立库全链 upgrade head 复验；revision 撞车改号见设计一致性 G-注记）。执行期修正：声明中迁移路径前缀 app/migrations→migrations（3 处文档已同步）。
- task-02 ✅：GroupChatCreate/Patch schema consensus 字段 + 开关校验（crud.py）；真实 HTTP 建群 consensus_mode=true 回显、PATCH 切换与超时改值回显复验。
- task-03 ✅：messages.py 共识发送分支（ordered 去重取首个 coordinator、全员失败即刻收口、关闭态零行为变化）；真实 HTTP 多 @ 消息建任务（coordinator=@文本序首个）日志+DB 复验。
- task-04 ✅：group_bridge 投影谓词 G-3 修正版（dm_target_member_id 非空 ∪ consensus_role==coordinator，不含 shadow_direct；converge 轮放行）+ mock 边界断言。
- task-05 ✅：shadow 会话供给 + turn_metadata 协议（consensus_task_id/consensus_role/dm_target_member_id/dm_kind）注入。
- task-06 ✅：互@私聊定向投递（collaborator→coordinator / coordinator→成员群发）。
- task-07 ✅：consensus.py 状态机主体（create/深拷贝 member states/write_card/inject_converge_directive，FOR UPDATE 幂等）。
- task-08 ✅：close hooks（collect/record/deliver→全 delivered 触发收口）。
- task-09 ✅：sweeper 循环 + main.py lifespan 挂载（name=consensus-sweeper）；G-4 执行期修正（两分支补 commit，真实环境复验持久化）。
- task-10 ✅：前端建群向导开关/群面板 PATCH 切换/四态状态卡同 log_id 替换/私聊跳转。
- CLI 勾选 0/10 系降级模式无 review.json 回填的显示差异；完成度以 worktree commit（869b8c709+66b9e027e，29+3 文件）与上述证据为准。

## 设计一致性 [层：人工判断]
实现与 design.md 一致，两处执行期修正均已回写声明：
1. G-3（执行期修正，已回写 design §投影拦截）：projection_blocked 最终形态为「dm_target_member_id 非空 ∪ consensus_role==coordinator」，**不含** shadow_direct（design 初稿误将 shadow_direct 纳入谓词，会导致私聊通道自身被拦）；converge 轮放行。
2. G-4（执行期修正，已回写 design §sweep + task-09 execution_fixes）：consensus_sweep_once 的 0-delivered 与 inject 两分支补 await db.commit()——write_consensus_card/inject_converge_directive 只 flush，sweep 独立 session 无调用方兜底时终态随会话关闭回滚。真实集成抓获（processed=1 而 status 仍 open）→ 修复 → 同环境复验持久化。单测补 rollback+refresh 重读断言（同事务 refresh 可见未提交改动，此前掩盖该缺陷）。
3. 迁移 revision 撞车：20260910120000 与主仓基点并行迁移（auto_resume）撞号致 alembic 判环；改号 20260910130000（down_revision=5e295549e20f 保持不变，创建时唯一 head 判定本就正确）。design/task-01/module-impact 声明已同步。
其余（数据流、接口、文件清单、状态机终态、开关关闭零变化）与 design §5-§8 逐项一致。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：NEW:backend/app/migrations/versions/20260910_group_consensus.py、NEW:backend/app/modules/daemon/group/service/consensus.py、NEW:backend/app/modules/daemon/tests/test_group_consensus.py
  - 语义标注：前两条为 design 声明路径前缀笔误（真实 backend/migrations/... 与 backend/app/modules/daemon/group/service/consensus.py 均存在且无未实现标记）；第三条真实存在于 backend/app/modules/daemon/tests/test_group_consensus.py（探针按清单字符串字面匹配未命中）。非缺陷。

#### 探针 2：设计关键词覆盖
- ✅ consensus_mode → model.py/schema.py/crud.py/messages.py（建群/开关/发送分支）
- ✅ consensus_timeout_seconds → model.py/schema.py/consensus.py（群设置可调 + deadline 计算）
- ✅ agent_group_consensus_tasks → model.py（状态机表）
- ✅ consensus_task_id → consensus.py/helpers.py/mentions.py/messages.py + 前端 group-chat-panel（任务贯穿链）
- ✅ consensus_role → consensus.py/helpers.py/mentions.py（collaborator|coordinator|converge）
- ✅ dm_target_member_id → mentions.py/messages.py/shadow.py（私聊定向）
- ✅ dm_kind → consensus.py/mentions.py/messages.py（consensus|agent_dm 双通道）
- ✅ projection_blocked → group_bridge.py/submit_steps.py（投影层强制拦截）
- ✅ consensus_sweeper → main.py/consensus.py/__init__.py（lifespan 挂载 + 循环）
- ✅ inject_converge_directive → consensus.py/helpers.py/__init__.py（收口指令注入）
- ✅ consensus_card → consensus.py/messages.py/__init__.py + 前端（状态卡四态）

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/agent、backend/app/migrations/versions）找到 10 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-02: 模块目录（backend/app/modules/agent、backend/app/modules/daemon/group/service）找到 10 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ⚠️ task-03: 模块目录（backend/app/modules/daemon/group/service）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-04: 模块目录（backend/app/modules/daemon/group/service）递归未找到测试文件（含 co-located tests/）
- ✅ task-05: 模块目录（backend/app/modules/daemon/run_sync/service、backend/app/modules/daemon/tests）找到 10 个测试文件（backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py …）
- ✅ task-06: 模块目录（backend/app/modules/daemon/group/service、backend/app/modules/daemon/tests）找到 10 个测试文件（backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py …）
- ✅ task-07: 模块目录（NEW:backend/app/modules/daemon/group/service、backend/app/modules/daemon/tests）找到 10 个测试文件（backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py …）
- ⚠️ task-08: 模块目录（backend/app/modules/daemon/run_sync/service、NEW:backend/app/modules/daemon/tests）递归未找到测试文件（含 co-located tests/）
- ✅ task-09: 模块目录（NEW:backend/app/modules/daemon/group/service、backend/app、NEW:backend/app/modules/daemon/tests）找到 50 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ✅ task-10: 模块目录（frontend/src/lib、frontend/src/components/group-chat、frontend/src/components/group-chat/__tests__）找到 13 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️
  - 语义标注（task-03/04/08 ⚠️）：本仓测试布局为集中式 backend/app/modules/daemon/tests/（非模块 co-located），探针按 target_files 模块目录字面扫描未命中——实际覆盖：task-03/04/08 的验收断言全部位于 test_group_consensus.py（21 用例）与 test_group_direct.py/test_group_cross_mention.py/test_group_bridge_projection.py，群链路 9 文件 208 passed 全绿。非覆盖缺口，属探针路径口径噪音（advisory）。

#### 探针 4：决策追踪覆盖
- D-001@v1（鉴权仅用户名）→ FR-1/2/3 → task-* → 证据：集成 HTTP 全链登录/建群/发消息（Runtime Evidence）
- D-002@v1（群级开关，关闭零变化）→ FR-1 → task-01/02/03/10 → 证据：schema 默认 false + server_default + 关闭态路径测试 + PATCH 真实回显
- D-003@v1（coordinator=@文本序首个）→ FR-1 → task-03 → 证据：mentions ordered 去重单测 + 真实多 @ 建任务日志（coordinator=小测=文本序首个）
- D-004@v1（默认私聊，结论发群）→ FR-1/3 → task-04/05/06 → 证据：projection_blocked 拦截 + dm 定向投递单测
- D-005@v1（状态行/状态卡）→ FR-2 → task-07/10 → 证据：consensus_card 四态 + 同 log_id 替换测试 + 真实落库行 + 回放端点返回
- D-006@v1（超时必收口）→ FR-1/3 → task-09 → 证据：sweeper 真实环境 aborted 持久化（G-4 修复后复验）
- D-007@v1（互@私聊通道复用 shadow 供给）→ FR-1/2/3 → task-04/05/06 → 证据：turn_metadata 协议注入 + 投影谓词测试
- D-008@v1（单表+JSONB 状态机落盘）→ FR-1/3 → task-* → 证据：agent_group_consensus_tasks 表 + 全链 alembic + 真实任务行生命周期
- 闭环结论：8/8 决策 accepted@v1、FR/task/证据回指完整，无 unresolved。

#### 探针 5：API Contract Parity
- ❌ API parity check failed: 1 frontend calls have no matching backend endpoint [scope: change-diff (28 files @ worktree)] | 202 backend endpoints unused by frontend | 4 calls matched after mount-prefix alignment (artifact paths exclude include_router/app.use prefixes)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ℹ️ 4 处前端调用经挂载前缀对齐匹配（endpoints 提取不含 include_router/app.use 挂载点前缀，比对时剥除对齐——非契约缺口）

| 状态 | 前端调用 | 后端端点 | 文件 |
|---|---|---|---|
| ❌ missing | GET /api/daemon/runtimes | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-09-10-group-agent-direct-chat\frontend\src\lib\agent.ts:286 |

- ❌ contract gap 是真实集成缺陷——诚实判 FAIL 并回 execute 补端点（CLI 仅 advisory 不硬阻断）
- ⚠️ 202 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …
  - 语义判定（提取口径噪音，非缺陷）：GET /api/daemon/runtimes 后端真实存在——app/modules/daemon/router/runtimes.py:713 定义且经 /api/daemon 前缀挂载；前端调用 agent.ts:286 listDaemonRuntimes 为存量代码（本次 diff 28 文件未触及该行）。探针端点提取器未覆盖该路由文件的装饰器形态致漏报。已人工核实 curl 真实端点 200（Runtime Evidence 建群流程即经 daemon 路由前缀访问）。不判 FAIL。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定
  - 语义标注：迁移文件 rename（20260910120000→20260910130000，99% 相似）为 git mv 改号，非删除。

## 测试结果 [层：确定性检查——CLI 实测对账]
- 后端群链路回归（worktree）：`uv run pytest -q --no-cov app/modules/daemon/tests/test_group_p1.py test_group_p2.py test_group_chat_management.py test_group_project.py test_group_direct.py test_group_cross_mention.py test_group_mention_pipeline.py test_group_bridge_projection.py test_group_consensus.py` → **208 passed, 0 failed**（2026-09-12 复跑，含 G-4 修复后 test_group_consensus 21 用例；无 known_failures 豁免）
- 前端（worktree frontend）：`npm run build`（tsc）通过；`npm run test` → **322 passed**；`npm run lint`（eslint）→ **0 errors**
- 质量扫描：`uv run ruff check`（变更涉及文件）全过；`uv run ruff format --check` 无 diff；`uv run mypy app` → **Success: no issues found in 934 source files**（mentions.py 联合类型收窄修复后，commit c06d35eb）
- noAI 实测门（CLI 亲跑）：`module[frontend,daemon,agent]` 退出码 0（404.3s）；lint 全链（ruff/format/mypy/pnpm lint/typecheck）退出码 0（17.2s）
- 口径披露：隔离快照模式存在基建缺口（快照新 .venv 不含 optional-dependencies dev 组——uv run 缺 pytest-xdist 等；frontend 无 node_modules 链接），本次以 `SILLYSPEC_VERIFY_GATE_SNAPSHOT_OFF=1` 回主仓工作区口径实测，判定面含 14 个非 .sillyspec 脏文件（并行会话 WIP，失败污染归属见 CLI 提示）。本变更 28 文件代码的测试均已在 worktree 实测覆盖（上述 208/322/tsc/eslint/mypy），主仓口径实测为 HEAD 面回归旁证。

## 决策追踪矩阵（如存在 decisions.md；无则删本节）
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-1/2/3 | task-* | 集成 HTTP 全链（登录/建群/发消息） | accepted |
| D-002@v1 | FR-1 | 01/02/03/10 | schema 默认+关闭态测试+PATCH 回显 | accepted |
| D-003@v1 | FR-1 | 03 | ordered 去重单测+真实任务 coordinator 日志 | accepted |
| D-004@v1 | FR-1/3 | 04/05/06 | projection_blocked+定向投递测试 | accepted |
| D-005@v1 | FR-2 | 07/10 | 状态卡四态+真实落库+回放返回 | accepted |
| D-006@v1 | FR-1/3 | 09 | sweeper 真实 aborted 持久化（G-4 后） | accepted |
| D-007@v1 | FR-1/2/3 | 04/05/06 | turn_metadata 协议+投影谓词测试 | accepted |
| D-008@v1 | FR-1/3 | task-* | 单表+JSONB+全链 alembic+任务行生命周期 | accepted |

## 技术债务 [层：人工判断]
- 探针 1 命中 0（无 TODO/FIXME/HACK 新增）。
- 遗留观测项（非本变更引入，见 Runtime Evidence 存量锁窗口）：daemon 缺位/慢响应时多成员并行触发的 member 行锁竞争（lock_timeout=5s）——真实部署 daemon 在线时无此窗口；建议后续变更独立跟踪。

## 变更风险等级 [层：人工判断]
integration-critical。理由：触碰真实消息发送主链路（messages.py/shadow.py/run_sync 投影）与常驻 sweeper 生命周期，且引入 DB 状态机与 alembic 迁移——已按 integration-critical 完成真实集成回执（独立库+真进程+HTTP+DB 断言）。design.md frontmatter 无显式 risk_level 声明；无否定语境抑制命中。

## Runtime Evidence [层：人工判断]
- 环境：docker compose（postgres 5432 / redis / minio / backend 8001）+ 独立库 verify_consensus（零污染共享 DB）+ worktree 后端真 uvicorn 进程 127.0.0.1:18099（env：DATABASE_URL=postgresql+asyncpg://platform:***@127.0.0.1:5432/verify_consensus、REDIS_URL=db3、S3=minio、bootstrap admin）；日志 C:\Users\qinyi\AppData\Local\Temp\verify-uvicorn.log（首次）、C:\Users\qinyi\AppData\Local\Temp\verify-uvicorn2.log（G-4 修复后重启，sweeper 30s 轮持续写入中）
- 生命周期：启动日志 `consensus_sweeper_started`（task-09 真实挂载）；/api/health 200；/healthz 404（该服务无此路由，非缺陷）
- 迁移：`alembic upgrade head` 全链 `5e295549e20f -> 20260910130000`（撞号修复后线性）
- HTTP：POST /api/auth/login 200（verify-admin）→ POST /api/daemon/group-chats 201（consensus_mode=true 回显，成员 小码/小测）→ PATCH 群设置 200（开关/超时改值回显）→ POST 群消息（多 @，on 态）：日志 `group_consensus_task_created`（coordinator=小测=@文本序首个）+ turn_metadata 注入
- 失败模式排除（G-4 前后对照）：修复前 sweeper processed=1 而 DB status 仍 open（缺 commit 回滚）；修复后同场景 → status=aborted、converged_at 填充、agent_run_logs channel=system metadata.consensus_card.phase=aborted（task_id 匹配）、GET /api/daemon/sessions/{sid}/logs 返回 consensus_card（coordinator=小测、members=[小码 pending]）——前端数据源验证
- 生命周期终态断言（terminal state）：consensus 任务终态——修复前 sweep 后仍 open（回滚）；修复后 status=aborted 终态（converged_at=2026-09-12T11:33:47Z 填充，DB 查询可复核）；成员 AgentRun 在无真 daemon 环境下均达 failed 终态（触发失败→即刻收口链路）；uvicorn 进程持续健康（/api/health 200，sweeper 30s 轮日志持续写入）
- 存量锁窗口（非本变更引入）：无真 daemon 时多成员并行触发，第二成员 _ensure_shadow_session FOR UPDATE 持锁等待 daemon IO 超 lock_timeout=5s → 主事务 500 回滚（连带回滚任务行）；关闭共识（存量路径）同场景同 500 → 证明为存量行为。真实部署 daemon 在线时无此窗口。
- commit 链：869b8c709（29 文件主实现）→ 66b9e027e（G-4+迁移改号，3 文件）→ c06d35eb（mypy 联合类型收窄，1 文件）；分支 sillyspec/2026-09-10-group-agent-direct-chat，merge-base 5eefdc8f/基线 611783a0

## 代码审查 [层：人工判断]
- 降级声明：宿主无子代理，全程主代理切审查者角色自审（reviewerNotes 已记「降级」），与前序阶段同模式。
- 发现并修复：① 迁移 revision 撞号（alembic Cycle 误判根因）② sweep 缺 commit（G-4，真实集成抓获）③ 声明路径前缀笔误 3 处（执行期修正同步）④ mentions.py 联合类型未收窄（verify noAI mypy 硬门抓获，assert 收窄，运行时恒真）。
- 总体评价：状态机边界（幂等/深拷贝/终态唯一推进/兜底收口）有单测+真实环境双重覆盖；投影谓词经 mock 边界断言收窄；开关关闭路径零变化由存量回归保障。遗留为存量锁窗口（上述），无本变更引入的缺陷。
