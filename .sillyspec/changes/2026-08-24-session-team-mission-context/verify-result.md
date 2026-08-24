---
author: qinyi
created_at: 2026-08-24 23:05:00
---

# 验证报告 — 2026-08-24-session-team-mission-context

## 结论

**PASS**（risk_level=unit-sufficient；全部验收基于断言级测试证据，主仓工作区实测）

## 任务完成度

14/14 task 全部完成（execute 阶段逐 task review pass + acceptance 独立审查 pass/pass）：

| task | 验收证据（断言级） |
|---|---|
| task-01 共享渲染 | test_orchestrator_project_context 21 用例（collect 结构化字段/render_scope_brief 机器·模式字段/briefing 关键段/prompt 机器名新增断言+patrol 零回归） |
| task-02 三态探测 | test_delegate_probe 9 用例（True→git/False→direct/超时与两路 unavailable→unknown/绝对路径前缀改写两场景） |
| task-03 status 路由 | test_mission_status 7 用例（400/404/active=false 200 不泄露/全字段 200/403/单段路由可达非 422） |
| task-04 flush-only | test_orchestrator 5 新用例（rollback 无 mission 行残留/字段可读/team 端到端兜底不变） |
| task-05 三态分流 | test_dispatch_worker_direct_mode 10 用例（git 照旧/direct 无 worktree_branch+无 branch metadata+直通 prompt/unknown 走现状不降级/probe 异常归 unknown） |
| task-06 mission_context | test_mission_context 18 用例（空 prompt 不注入不消耗/failed·killed 不烧断/懒建回填 pending 短路/三消耗态参数化） |
| task-07 DTO+校验共享 | test_team_mission_create_block 12 用例（七字段透传/旧请求体回归/openapi 具名 schema/inspect.getsource 守护共享函数防复制回退） |
| task-08 inject 简报 | test_inject_first_turn_briefing 10 用例（payload prompt=简报+---+用户消息恰一分隔/user_input 干净/一次性/failed 重注） |
| task-09 create 预建+E2 | test_session_team_mission 11 用例+test_change_session 双前导用例（回滚无孤儿 session/mission/W∉scope 422/binding 缺失与 runtime_id 空 422/钉定+默认配置+显式优先/变更前导→简报→---顺序） |
| task-10 probe 端点 | test_probe_endpoint 9 用例（批量/未绑=unknown+offline/探测异常不 5xx/403/空超限 422/路由不被动态段截走） |
| task-11 daemon 工具 | hub-client 6+mcp-server 7 用例（第 6 工具注册/可选参/X-Session-Id/active=false 透传/既有 5 工具零变化） |
| task-12 弹层 | team-trigger-popover 9 新用例（probe 单次+补拉/三态 dot+标签+未绑/preSession 选择器禁选/payload orchestrator_workspace_id/probe 失败 fail-safe） |
| task-13 预会话解禁 | session-panel-pre-session 8 用例（门控四态/首句请求体携带完整 team_mission/失败保留重试/成功清空/零调 trigger 端点） |
| task-14 收尾 | finalizer 混合 mission merge/cleanup 各恰一次+token 量化（scope=5 上界 ≤1500）+gen:types 三产物+三模块文档 |

## 设计一致性

五层 A-E 全部落地并与 design v2 逐层对应（acceptance 独立审查 9 项 checklist 全 pass）：

- **A 主控简报**：inject/create 双路径前缀注入；展示层干净（AgentRunLog user_input/前端展示均不含简报）；一次性语义含 failed 重注与空 prompt 切换轮不消耗；懒建不补（D-003）。
- **B mission_status**：`GET /api/missions/status`（X-Session-Id，对齐 hub-client `_missionActionPath`）+sessions 变体；不走 `_resolve_session_mission`（D-012）；active=false 优雅返回（D-005）；daemon 第 6 常驻工具。
- **C 弹层探测**：`POST /api/workspaces/probe` 任一成员 binding 口径与简报/mission_status 同源（collect_single_workspace_status 单一来源）；弹层徽标+主 agent 选择器对照原型三场景。
- **D 非 git 直通**：非降级通道 stat 绝对路径 `.git` 三态（D-006@v2）；direct→worktree_branch=None（路径A 语义）+直通 prompt 变体（无 commit 指令+落盘段调整）；unknown 走现状绝不误降级；**finalizer.py/patrol.py/control.py git diff 为空确认零改动**。
- **E 新会话+主 agent**：create 携 team_mission → 事务前共享校验+E2 三分支（∉scope 422/(W,创建者) binding 缺失 422/钉定+默认配置显式优先）→ 事务内 flush-only 预建共用单 commit（D-009@v2）→ 首 run 双标记+首 prompt 双前导（变更前导在前）。

两处经审查知悉的偏差（均有依据，非缺陷）：
1. 空 prompt 纯配置切换轮不再落双标记（design 字面是 inject 侧排除；实现收口到标记层——否则该轮落库即 completed orchestrator run 烧断一次性名额，与「不消耗」验收冲突；带文本切换轮照常标记）。
2. mission_status 显式 ws+mid 的多段路由变体未注册（主用形态 sessions 上下文定位已注册且为 plan 对齐口径；hub-client 显式形态 404 有优雅兜底）。

Grill 要点落实核对：UB-1 flush-only（✓ rollback 用例）/UB-2 后端统一 probe（✓ 单一收集函数）/CC-06 绝对路径（✓ mock 断言）/CC-11（✓ 不走 _resolve）/CC-12（✓ 三边界用例）/CC-13（✓ 双 422 用例）。

生命周期契约表 6 事件：create+team_mission/inject 简报/两只读查询/直通 dispatch/预建（既有）——均无既有状态转移变更；lease/claim/heartbeat/converge 链路零触碰。

## 探针结果

- 主仓工作区全模块导入 sanity：`import router/mcp_tools/session.service/mission_context/orchestrator/execution` + `MissionStatusResponse`/`TeamMissionCreateBlock` 全部 OK（apply 后混合态修复验证）。
- 并行会话改动叠加核验：另一会话在 mcp_tools.py（+4 行 session 锚点回填）/daemon/router.py（+8 行 TeamMissionWorkerSummary.workspace_id 换行格式）/daemon/schema.py（+1 行 workspace_id 字段）的在途改动经 3-way 补丁完整叠加进本变更版本之上（router.py 一处同义格式冲突取 ruff 安全侧），双方改动零丢失；openapi/api-types 以叠加后代码重新 gen:types 为准。
- gen:types 产物核对：TeamMissionCreateBlock（七字段）/MissionStatusResponse/`/api/missions/status`/`/api/sessions/{sid}/missions/status`/`POST /api/workspaces/probe` 全部进 openapi.json+两份 api-types.ts。

## 测试结果

| 套件 | 命令 | 结果 |
|---|---|---|
| backend 全量 | `uv run pytest -q --no-cov -n auto`（主仓，前台） | **5272 passed / 6 skipped / 3 xfailed / 1 xpassed**（XPASS=test_mcp_tools 既有非 strict 路由用例，include 顺序修正后转生效，非本次引入） |
| frontend 全量 | `pnpm test` + `tsc --noEmit`（主仓） | **183 文件 2082 passed / tsc 0 错误** |
| sillyhub-daemon 全量 | `pnpm test` + `pnpm typecheck`（主仓） | **152 文件 2656 passed / 9 skipped / typecheck 0** |
| backend lint | `ruff check .` + `mypy app` | **ruff 全过 / mypy 697 files 无 issue** |
| frontend lint | `pnpm lint` | exit 0（313 条 warning 为存量，非本次引入） |

本变更新增测试约 90+ 用例（14 个新/扩展测试文件）。

## 变更风险等级

**unit-sufficient**（design frontmatter 显式声明）：核心机制（prompt 组装/判定/事务边界/三态探测/路由）全部可由单元+集成测试覆盖，已全覆盖。运维注意（CONCERNS 黄区，非缺陷）：backend Docker 容器不热重载——`/api/missions/status`、`/api/workspaces/probe`、`SessionCreateRequest.team_mission` 生效需 rebuild backend 镜像；daemon 侧 mission_status 工具需重启/升级本地 daemon 进程（旧 daemon 不注册该工具，简报/直通/E1/E2 不受影响）。

## Runtime Evidence

（risk_level=unit-sufficient，非 integration/deployment-critical，本节为补充说明非门控证据）
- 真实环境联动留待用户日常使用验证：预会话派团队→首句简报、弹层徽标（需 rebuild backend + 升级 daemon）、非 git 目录工作区派分身直通。
- 已知存量债（越界未动，均非本次引入）：①`migrations/versions/20260824120000_agent_session_archive.py` ruff format 债（baseline 带入，属 platform-session-feedback-fix 变更）；②test_mcp_tools 1 XPASS（建议其原变更顺手摘 xfail 标记）；③前端 313 条 lint warning。

## 遗留与建议

- 主仓 46 文件已 staged 待用户统一提交（精确 pathspec，未夹带并行会话的 11 个在途文件）；并行会话改动已在工作区保全叠加。
- worktree `sillyspec/.runtime/worktrees/2026-08-24-session-team-mission-context` 及其分支待归档阶段 cleanup（内含 node_modules junction，清理前先摘链接）。
- C 层主体（会话↔工作区集合模型/跨机器主控迁移/per-daemon transport）按 D-011 拆独立变更。
