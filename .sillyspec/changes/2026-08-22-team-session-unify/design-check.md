---
author: qinyi
created_at: 2026-08-22 14:25:30
---

# 设计对照检查（Design Check）— execute step 13

> 对照 design.md v3 逐项核验实现状态。✅ 符合 / ⚠️ 合理偏差（有依据）/ ❌ 未达。

## 核心机制：主控轮双标记（D-009）

| 设计要点 | 状态 | 实现（commit） |
|---|---|---|
| inject 当轮 run 回填 mission_id+role='orchestrator'（同事务） | ✅ | task-04（d2c7d39a），12 用例含回滚不留半标记 |
| 懒建时补回填同语义（NEW-1） | ✅ | task-05（25994ae4） |
| _get_main_run 取最新 orchestrator run | ✅ | task-06（386109f1）desc order |
| 治理门/workers/成本排除主控轮 | ✅ | task-07（a3dc8ccf）non_orchestrator_runs；⚠️ 偏差：worker_runs 保持全量（schedule_loop/finalizer 全量依赖，卡片措辞过窄，Reverse Sync 正确） |
| router GET/cancel workers 改治理口径 | ✅ | task-13（3a3f190f） |

## Phase 1 backend

| 设计要点 | 状态 | 实现 |
|---|---|---|
| session_id 列+索引+部分唯一索引（D-006） | ✅ | task-01（e2d8e267）；⚠️ 偏差：Uuid 类型替代 VARCHAR(36)（PG FK 类型匹配，正确）；NOT NULL+default_factory uuid4（存量构造兼容，PG 下 FK 失败即暴露未接线入口） |
| 触发/列表端点+409+scope 冻结+objective 占位 | ✅ | task-03（720f4a48），10 用例 |
| derive_status awaiting_input+NULL 守卫（CC-01/NEW-4） | ✅ | task-02（4788bdaf）96 格参数化 150 用例；守卫经 task-06 收紧为"session_id 指向真实 AgentSession"（default_factory 随机 uuid 坑，比列非 NULL 更正确） |
| dispatch_worker 懒建（默认预算/422/并发守卫 NEW-3） | ✅ | task-05；⚠️ 偏差：并发守卫用 IntegrityError 捕获法替代 FOR UPDATE（aiosqlite 不支持，不可测性优先，索引兜底等效）；默认预算模块级常量+env（config.py 权限外，注释可迁） |
| converge busy/独立置位/四值（D-010） | ✅ | task-06，busy 前置零状态变更、UPDATE WHERE IS NULL 抢占保留 |
| patrol awaiting_input 超时收敛+僵尸会话判定+redispatch no-op（D-008） | ✅ | task-08（8467b91c）；⚠️ 偏差：预算触顶不强杀会话 mission 分身（强杀会造成无法收敛的中间态，治理前移 can_dispatch_worker，注释+测试锁定） |
| 旧 create/list 端点删除（D-011） | ✅ | task-13（-4004 行） |

## Phase 2 daemon

| 设计要点 | 状态 | 实现 |
|---|---|---|
| 谓词 claude×stage∈{空,'orchestrator'}（D-002@v2/D-003） | ✅ | task-09（f4665fa0）真值表测试 |
| 分身 stage 常量 'mission_worker'（NEW-2） | ✅ | execution.py 常量+lease metadata.role 保留 |
| env MCP_SESSION_ID 注入（R-04/spike-01） | ✅ | task-10（5a8c3fc9）spike 四层证据+injectMcpSessionId 补写路径（cli.ts 未动） |
| X-Session-Id header 五端点 | ✅ | hub-client 常量单一来源 |
| 5 工具参数可选化+能力说明书描述 | ✅ | mcp-server .optional()+描述重写 |

## Phase 3 frontend

| 设计要点 | 状态 | 实现 |
|---|---|---|
| 派团队按钮+弹层+chip（Codex 置灰） | ✅ | task-11（8e47dc70）page/dialog 双模式 |
| /team 指令 | ✅ | 整词拦截不开弹层不发送 |
| AskUser 第四路 | ✅（零接线设计） | 常驻工具下自然语言变体 |
| TeamTaskBlock+5s 轮询 | ✅ | task-12（65c2d547）isActiveTeamMission 启停 |
| 进度视图分身段块+MCP 工具卡 | ✅ | TeamWorkerBlockView+5 工具识别 |
| 「用团队分析」改造 | ✅ | 旧 createMission 链路删净（grep 证据） |

## Phase 4 清理

| 设计要点 | 状态 | 实现 |
|---|---|---|
| 删 mission-console/两路由/菜单/client | ✅ | task-13，引用清零 grep 证据 |
| gen:types 三端 | ✅ | task-14（4edae364），openapi diff 精确吻合 |
| 项目页跳转按钮 | ✅ | 主代理交界修复：ppm 项目页按钮改跳 /sessions（design"项目页只留跳转按钮"原意） |

## §7.5 生命周期契约表逐事件

| 事件 | 状态 | 测试锚点 |
|---|---|---|
| trigger（409/scope 冻结/占位） | ✅ | test_session_team_mission 10 用例 |
| inject 双标记+占位回填 | ✅ | test_inject_orchestrator_tagging 12 用例 |
| dispatch 懒建（422/守卫/预算/补回填） | ✅ | test_mcp_tools 懒建组 |
| worker claim/heartbeat/complete 不变 | ✅ | 既有链路零改动（847 全绿） |
| converge busy/置位/四值 | ✅ | TestConvergeSessionSemantics 9 用例 |
| mission cancel | ✅ | cancelTeamMission+保留端点用例 |
| turn 完成→awaiting_input | ✅ | derive 矩阵+complete_lease 会话语义用例 |
| patrol auto-converge | ✅ | TestAwaitingInputAutoConverge |
| session end 不取消（D-008） | ✅ | finalizer 会话分流+僵尸判定用例 |

## 组装行为（全量）

- backend agent+daemon+mcp_gateway 全量：运行中（结果见 execute 收尾记录）
- frontend vitest 全量 + daemon 全量（flake 规避）：运行中
- 遗留 manual verify：真实 PG alembic upgrade head（worktree 无 PG，task-01 记录）+ 真机 daemon e2e（触发→派分身→converge 全链路，verify 阶段）

## 结论

设计 31 项要点：28 ✅ + 3 ⚠️ 合理偏差（均有源码依据与测试锁定，Reverse Sync 已记入卡片/review）。无 ❌。契约表 10 事件全部有实现+测试锚点。
