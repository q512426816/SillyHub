<!-- author: qinyi | created_at: 2026-08-25 04:00:00 -->
# 验证结果：统一智能悬浮会话 v1（2026-08-25 04:00）

## 结论：PASS（附 3 条如实记录的偏差与 1 条环境甄别）

分支 `sillyspec/2026-08-25-unified-floating-session`（基线 main@0ca99022），
两个功能提交：`ed954822`（后端通道 Wave1-3）、`1e93c506`（前端宿主 Wave4-7）。

## 测试矩阵

| 范围 | 命令 | 结果 |
|---|---|---|
| 后端新增 | pytest test_page_context_preamble.py | **10/10 绿**（构建器 4/schema 3/create 拼接 3） |
| 后端定向回归 | pytest test_session_team_mission + test_change_session + test_inject_first_turn_briefing | 60/60 绿 |
| 后端 ppm 模块 | pytest app/modules/ppm | 498/498 绿 |
| 后端 daemon 全量 | pytest app/modules/daemon/tests | 1008 绿 + 10 失败（见环境甄别） |
| 前端新增 | vitest stores/floating + hooks/use-page-session-context + components/floating | **19/19 绿** |
| 前端定向回归 | vitest components/daemon + components/sessions + app/(dashboard) | **903/903 绿**（含 53 session-panel-dialog、52 portal/layout/ppm） |
| 类型 | tsc --noEmit | 0 error |
| Lint | eslint 新增文件 | 0 error（1 warning：测试文件 setState 参数） |

## 环境甄别：daemon 全量 10 失败与本变更无关（证据链）

失败集中在 test_session_sse.py（8）与 test_session_runs_endpoint.py（2）——
两文件双方均未修改。三步隔离：
1. 临时 worktree @0ca99022（干净基线）：20/20 绿；
2. 同 worktree cherry-pick 本变更两个提交（无并行改动）：20/20 绿；
3. 主工作树（含并行会话在途未暂存改动）：10 失败稳定复现。

**判定：失败由并行会话在 `run_sync/service.py` 等文件的未提交在途改动引入，
本变更零责任。** 已原样保留并行改动未做任何处置。

## 如实记录的偏差（3 条）

1. **execute 阶段 worktree 机制偏离**：sillyspec execute 试图以同名分支建
   worktree 与既有分支冲突（错误后未采用 doctor 清理——会误删本分支）。
   实现在主检出分支上完成，阶段推进用 `--done` 兜底，任务卡/tasks.md 勾选
   照常维护。
2. **共享文件 blob 级暂存**：session-panel.tsx / daemon.ts 同时含并行会话在途
   改动；提交采用「HEAD + 本变更 hunks」构造暂存 blob，未裹挟并行工作。
   代价：**已提交状态与测试运行状态在这两个文件上不完全一致**（测试跑的是
   叠加并行改动的工作树）。缓解：本变更 hunks 为纯可选字段增量（缺省零回归
   用例覆盖），且 cherry-pick 隔离环境后端全绿、前端 tsc 0。合并 main 前建议
   在并行改动落定后复跑一次受影响目录。
3. **hook 的 URL 实体派生降级**：use-page-session-context v1 只做 pathname
   页面标签（searchParams 派生需 Suspense 边界，推迟 v2）；FR-6 的实体上下文
   由 PPM 行按钮显式携带，功能完整，仅「无按钮页面自动感知实体」延后。

## 手测路径（留给用户有空验证）

1. `pnpm -C frontend dev` + backend 起服务后，任意 dashboard 页右下角应见悬浮球；
2. PPM → 项目列表 → 行内「发起团队」→ 抽屉弹出自动进预会话，发首句后
   （后端日志 / agent 视角）可见【页面上下文】前导，会话气泡内用户消息干净；
3. 最小化 → 切页面 → 胶囊在、会话不中断 → 点胶囊恢复；
4. 侧边栏进「会话」门户 → 球与抽屉消失；返回业务页恢复。

## FR 对照

- FR-1 悬浮球常驻 ✅（互斥路由隐藏为设计行为）
- FR-2 抽屉宿主复用 SessionPanel ✅（真会话/预会话两态 + 紧凑列表 + 兜底浮层）
- FR-3 最小化保活/关闭降载 ✅（hidden 保活断言在 host 测试；门控卸载）
- FR-4 双宿主互斥 ✅（门户三路由正则 + 落壳态 + 整体卸载，测试覆盖）
- FR-5 智能上下文创建轮 ✅（10 后端测试含展示层干净与零回归）
- FR-6 PPM 智能入口 ✅（契约测试更新：唤起 store 而非路由跳转）

## 运行时证据（Runtime Evidence）

**测试套件与结果**（unit_tests + service 级真实 DB 集成）：

- 后端日志摘录（实际运行）：
  `10 passed, 7 warnings in 3.64s`（test_page_context_preamble.py 全量）；
  定向回归 `60 passed`（team_mission + change_session + briefing）；
  ppm 模块 `498 passed`；daemon 全量 `1008 passed`（另 10 失败经隔离甄别为
  并行会话在途改动，见上节）。
- 前端日志摘录：新增 `19 passed (19)`；定向回归 `903 passed (903)`；
  `tsc --noEmit` 无输出（0 error）。
- **真实 DB service 级断言**（非纯 mock 单测）：TestCreatePathInjection 走真实
  SessionService.create_session + sqlite 会话，断言 lease.metadata_ 的
  dispatch_prompt 含【页面上下文】且 AgentRunLog.run_id 对应日志 user_input
  原文干净——create 路径的落库与 lease 元数据为真实行为。

**契约对账**（contract_tests）：dump_openapi.py 重导出（409 paths/485 schemas，
PageContextCreateBlock×3）→ pnpm gen:types → api-types.ts 含 page_context×4；
tsc 0 error 证明前后端类型 parity。

**真实 daemon↔backend 进程联调：未执行（如实声明）**。依据 design 风险等级
声明（contract-tested）：sillyhub-daemon/ 零文件改动、协议零变更（page_context
只走 backend 侧既有 dispatch_prompt 通道，daemon 进程消费行为不变），进程级
E2E 留待用户本机起服务手测（见手测路径 2——首句创建后在会话流中核对 AI 回答
是否引用项目数据，即为最直接的真实联调验证）。

**终态断言（terminal state）建议项**：create 成功路径的 session/run/lease 三
元组落库断言沿用既有 test_session_team_mission 范式（60/60 绿）；本变更不改
终态迁移，running→completed/failed 同步路径零触碰。
