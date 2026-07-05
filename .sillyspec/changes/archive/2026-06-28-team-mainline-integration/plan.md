---
author: qinyi
created_at: 2026-06-28 03:18:00
plan_level: full
status: plan（brainstorm 后产出，待 execute）
parent_change: 2026-06-19-multi-agent-orchestration
---

# 实现计划：团队接入主流程

> 基于 design.md（方案 B，4 Wave 风险分层）+ requirements.md（FR-01~FR-10）+ decisions.md（D-001~D-008，无 P0/P1 unresolved）。原 `2026-06-19` 的 delegate_task spike 04（路径 B，H1/H2=100%）已通过，本变更复用其结论。

## Spike 前置验证

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-04（原变更，已通过） | delegate_task 路径 B 输出解析 + Coordinator 直接 API（非 agentic） | 已锁定设计方向，无需重验 |
| spike-execute-worktree（Wave4 前置，按需） | 多 worktree 并行 patch + Finalizer 合并的冲突模式 | 若 patch 合并冲突不可控，Wave4 execute team 延后（D-006 已允许） |

> Wave1-3 技术方案确定（复用已落地 Wave1-2 + 代码核实），无新 Spike。Wave4 execute team 因多 worktree 合并有不确定性，按 D-006 排最后且可独立交付，必要时前置轻量 spike。

## Wave 1 — 底层修复（前置，让 team 链路可用且能收敛；task 可并行）
- [ ] task-01: Finalizer 服务（finalizer.py）+ complete_lease mission 分支（开头 collect + 末尾 Finalizer 触发）（覆盖：FR-01, FR-02, D-005@v1, D-007@v1）
- [ ] task-02: 治理门 can_dispatch_worker 挂载到 dispatch 循环 + 拒绝时未 dispatch Run 标 killed（覆盖：FR-03, FR-04, D-008@v1）
- [ ] task-03: 工具治理 v1 降级（worker_tool_config 标注不强制 + 注释说明 patch 人审兜底）（覆盖：FR-05, D-004@v2）
- [ ] task-04: Wave1 测试（Finalizer 触发锚点、collect 回灌、治理门拒绝路径、超预算收敛）（覆盖：FR-01~FR-05）

## Wave 2 — bootstrap team 闭环（依赖 Wave1 task-01/02；只读并行，风险最低）
- [ ] task-05: SpecBootstrapService team 模式（single=现状 interactive 默认）+ 编排链路（确定性扫描→Coordinator 拆→并行只读 Worker→Finalizer 单点写 .sillyspec/docs）（覆盖：FR-06, D-001@v1, D-003@v1）
- [ ] task-06: Wave2 测试 + 成本观测回填默认预算（team 档端到端 + single 档回归=现状）（覆盖：FR-06, FR-04, FR-10）

## Wave 3 — auto 路由 + 前端可观测性（依赖 Wave1 task-01 artifact 字段）
- [ ] task-07: auto/team/single 三档路由 route()（第一版 bootstrap+execute 入口，auto 四因子阈值）（覆盖：FR-07, D-002@v1）
- [ ] task-08: artifact 字段贯通（后端 MissionWorkerRunResponse + 前端 MissionWorkerRun）+ Mission 树 + Worker 日志分层回看（复用 agent-log-viewer 按 run_id）（覆盖：FR-08）
- [ ] task-09: 成本/预算进度条可视化（超预算告警色）+ bootstrap team 进度 + 三档路由选择 UI（覆盖：FR-07, FR-08）
- [ ] task-10: Wave3 测试（路由判定 + 前端组件渲染 + artifact 字段）（覆盖：FR-07, FR-08）

## Wave 4 — execute team（最后，可独立交付，风险最高；依赖 Wave1+Wave2）
- [ ] task-11: EXECUTE stage team 分流（single→start_stage_dispatch / team→start_mission）+ Task↔worktree 映射机制（覆盖：FR-09, D-005@v1, Grill D1/D2）
- [ ] task-12: 多 worktree 并行（每 Worker 独立 worktree 出 patch Artifact）+ execute Finalizer 合并 patch + 人审 apply-back（不自动提交）（覆盖：FR-09, D-005@v1, D-006@v1）
- [ ] task-13: Wave4 测试（execute team 端到端 + patch 合并冲突处理 + apply-back 人审）（覆盖：FR-09）

## 跨 Wave（最后）
- [ ] task-14: 兼容回归（single 档全流程=现状、complete_lease 非 mission Run 零影响、现有 AgentRun/Lease 行为不变）（覆盖：FR-10, D-001@v1）
- [ ] task-15: 文档同步（flows: agent-execution/workspace-scan-bootstrap/change-lifecycle + modules: backend/frontend 更新 team 接入说明）（覆盖：全 FR）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | Finalizer 服务 + complete_lease mission 分支 | W1 | P0 | — | FR-01,02 / D-005,D-007 | 收敛闭环地基（Grill A2 修复） |
| task-02 | 治理门挂载 + 被拒 Run 标 killed | W1 | P0 | — | FR-03,04 / D-008 | 预算/上限生效 + 可收敛（Grill A3） |
| task-03 | 工具治理 v1 降级 | W1 | P1 | — | FR-05 / D-004@v2 | 不改 daemon，patch 人审兜底 |
| task-04 | Wave1 测试 | W1 | P0 | 01,02,03 | FR-01~05 | 收敛/治理/工具单测 |
| task-05 | bootstrap team 模式 + 编排链路 | W2 | P0 | 01,02 | FR-06 / D-001,D-003 | 第一个真实场景（只读） |
| task-06 | Wave2 测试 + 成本观测 | W2 | P0 | 05 | FR-06,04,10 | team 端到端 + single 回归 |
| task-07 | auto/team/single 三档路由 | W3 | P1 | 01 | FR-07 / D-002 | bootstrap+execute 入口 |
| task-08 | artifact 字段贯通 + Mission 树 + Worker 日志 | W3 | P1 | 01 | FR-08 | 前端可观测性主体 |
| task-09 | 成本预算条 + 进度 + 路由 UI | W3 | P1 | 08 | FR-07,08 | 可视化 + 交互 |
| task-10 | Wave3 测试 | W3 | P1 | 07,08,09 | FR-07,08 | 路由 + 前端测试 |
| task-11 | EXECUTE team 分流 + Task-worktree 映射 | W4 | P1 | 01,05 | FR-09 / D-005,Grill D1/D2 | execute 接 team（风险最高） |
| task-12 | 多 worktree 并行 + Finalizer patch + 人审 apply-back | W4 | P1 | 11 | FR-09 / D-005,D-006 | 写代码场景，人审不自动提交 |
| task-13 | Wave4 测试 | W4 | P1 | 11,12 | FR-09 | execute 端到端 + 冲突 |
| task-14 | 兼容回归 | 跨 | P0 | W1-4 | FR-10 / D-001 | single=现状全流程 |
| task-15 | 文档同步 | 跨 | P2 | W1-4 | 全 FR | flows/modules 更新 |

## 关键路径

task-01（Finalizer+complete_lease）→ task-05（bootstrap team 编排）→ task-11（execute 分流）→ task-12（execute worktree+apply-back）→ task-13（Wave4 测试）→ task-14（兼容回归）

最长路径决定交付周期。Wave1 task-01 是全局地基（Finalizer 收敛闭环），所有后续 Wave 依赖它。Wave4（task-11~13）是关键路径末端且风险最高，按 D-006 可独立交付/延后。

## 全局验收标准

- [ ] **收敛闭环（SC-1）**：Mission 创建→Worker 完成→Artifact 自动入库（complete_lease 开头）→全终态 Finalizer 自动触发（complete_lease 末尾）→产出合并产物
- [ ] **治理有效（SC-2）**：超预算/超并发 can_dispatch_worker 拒绝 + 未 dispatch Run 标 killed + Mission 仍收敛（degraded 非失败）
- [ ] **bootstrap team（SC-3）**：team 档文档质量 ≥ single 且上下文占用更低；single 档=现状 interactive 零变化
- [ ] **可观测（SC-4）**：Mission 树 + Worker 日志按 run_id 回看 + 成本预算条 + 三档可选
- [ ] **兼容（SC-5）**：未配置 team/auto 走 single=现状；complete_lease mission 分支仅 run.mission_id 非空生效；无新 migration
- [ ] **execute 隔离（SC-6）**：Wave4 排最后可独立交付，patch 人审 apply-back 不自动提交
- [ ] 所有单元测试通过（backend pytest + frontend vitest）
- [ ] mypy + ruff + frontend typecheck 通过
- [ ] brownfield：未配置新功能时行为不变（task-14 回归验证）

## 覆盖矩阵（decisions.md 当前版本）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-05, 08, 11, 14 | SC-3/SC-5（team 可选 single 默认） |
| D-002@v1 | task-07, 09 | SC-4（auto 第一版 bootstrap+execute） |
| D-003@v1 | task-05 | SC-3（scan/bootstrap 合一） |
| D-004@v2 | task-03 | SC-2/SC-6（工具 v1 不强制 patch 人审兜底） |
| D-005@v1 | task-01, 11, 12 | SC-1/SC-6（Finalizer 分场景） |
| D-006@v1 | task-12 | SC-6（execute 排最后可独立交付） |
| D-007@v1 | task-01 | SC-1（Finalizer 触发锚点 complete_lease） |
| D-008@v1 | task-02 | SC-2（被拒 Run 标 killed + 超预算收敛） |

## 自检

- [x] 输出标注 plan_level: full
- [x] Wave 分组 + 任务总表 + 关键路径 + 全局验收 + 覆盖矩阵 五部分齐全
- [x] 任务总数 15（≤15 约束）
- [x] checkbox 格式 `- [ ] task-XX:`（execute 解析依赖）
- [x] 无估时列
- [x] 无实现细节（细节留 tasks/task-NN.md，execute 阶段展开）
- [x] D-001~D-008 当前版本全覆盖（含 D-004@v2，不引用 D-004@v1）
- [x] 无 P0/P1 unresolved blocker（decisions 全 accepted）
- [x] Mermaid 未生成（依赖关系用任务总表+关键路径表达，非平凡但表格足够清晰）
- [x] 关键路径识别（task-01 全局地基 → Wave4 末端）

**自检结论**：通过。可进入 execute 阶段（建议从 Wave1 task-01/02/03 开始）。
