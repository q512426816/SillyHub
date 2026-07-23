---
author: qinyi
created_at: 2026-07-12 12:35:22
status: brainstorm（方案 B 已确认，待 plan 拆 Wave）
---

# 设计文档（Design）— team 主 agent 动态编排（v2）

> 变更：`2026-07-12-team-main-agent-orchestration`
> 依据：v1 `2026-07-12-team-mode-platform-wide` + `docs/agent-platform-deep-audit-2026-07-12.md`
> 方案：B（主 agent 真 agent）· 演进 v1 · 三入口全支持 · 主 agent/worker 都自由组合

## 1. 背景

v1（team-mode-platform-wide）team = GLM Coordinator 一次性拆解 + worker 并行 + GLM Finalizer 合并（GLM 硬依赖，静态拆解）。Wave 1+2 已实现 mode 选择 UI + execute team 触发链路。

用户要求 team 应是「主 agent 全程动态指挥（像项目经理——读 worker 实际产出再决策下一步）+ 每个 worker 自由组合 agent 类型（claude code/codex/cursor）和模型（glm/gpt/claude/deepseek）」。v1 的 GLM 固定 + 静态拆解达不到。

本 v2 推翻 v1 的 D-001/D-004/design §3 非目标，重设计为主 agent 动态编排。保留 v1 的 mode 选择 UI + 字段透传 + single 路径零回归 + GLM 链路作 fallback。

## 2. 设计目标

- 主 agent = 真 agent（走 daemon interactive lease + MCP tool），有工具，能读码/看文件/工具决策
- 用户预设 worker 列表（UI 指定每个 worker 的 agent 类型 + 模型 + 任务）
- per-worker 独立 git worktree（D-006 彻底解决并发写覆盖）
- 三重收敛（所有 worker 完成 / 主 agent 判断目标达成 / 预算超时硬截断）
- 主 agent + worker 都自由组合 agent 类型 + 模型（GLM 不再特殊）
- v1 演进（GLM Coordinator/Finalizer 保留作 fallback，主 agent 不可用时降级）
- 三入口全支持（mission 页 / execute·verify stage / 会话）
- mode=single 零回归

## 3. 非目标（防止 scope creep）

- **不做** worker 自动拆解（用户预设列表，主 agent 不自动拆，只按列表派发 + 动态调度：补/调整/收敛）
- **不做** driver 层原生多 agent 轮转（主 agent 是 mission 里的特殊 AgentRun，走 daemon lease，不在 driver 层加协调原语）
- **不做** worker DAG 依赖图（v1 flat 沿用，复杂依赖留后续）
- **不做**预算硬门 kill 全实现（用 mission.budget_usd 硬截断，P2-1 独立任务深化）
- **不做** brainstorm/plan stage 的 team（沿用 v1 D-002：只 execute + verify + mission + 会话）

## 4. 拆分判断

大型复杂度。3+ 功能模块（主 agent 编排引擎 / per-worker worktree+provider / UI 配置面板）但归一为「主 agent mission」一个机制。按 N Wave 推进（plan 阶段拆，预估 6-8 Wave）。

## 5. 总体方案

### 核心架构

team = 主 agent（真 agent）+ 用户预设 worker 列表。主 agent 像项目经理接管任务：

```
用户 UI 配 team（主 agent 类型/模型 + worker 列表[类型/模型/任务] + objective + 预算）
  ↓
建 AgentMission + 主 agent AgentRun(role='orchestrator', provider=X, model=Y)
  ↓ 派 daemon interactive lease（主 agent 长生命周期）
主 agent 接管（真 agent，有工具）:
  读 objective + worker 预设列表
  ↓ 循环 {
    MCP tool dispatch_worker(worker_id) → backend 派 worker（独立 worktree）
    等 worker 完成（daemon complete_lease 回灌 artifact）
    MCP tool get_worker_result(worker_id) → 读 worker patch/summary
    决策：再派 / 补 worker / 收敛
  } until 收敛
  ↓
MCP tool converge_mission() → backend 合并 worker patch → 结果回传
```

### 主 agent（orchestrator 角色）

- `AgentRun(role='orchestrator', agent_type=用户选, provider=用户选, model=用户选)`
- 走 daemon interactive lease，**长生命周期**（跨多 worker 周期，超时配置 + 心跳续期）
- 有 MCP tool：`dispatch_worker` / `get_worker_result` / `list_workers` / `converge_mission` / `report_progress`
- 决策由主 agent LLM 推理（有工具，能读 worker 写的实际代码再决策）

### worker（用户预设）

- UI 配 worker 列表，每条 `{agent_type, model, task/objective, role}`
- `AgentRun(role='impl'/'verify'/'test', provider/model 各自指定)`
- 每个 worker **独立 git worktree**（`git worktree add` 临时分支，execution.py 扩展 worktree_base_dir per-worker）
- 完成 → patch 上传 `AgentArtifact(kind='patch')`

### MCP tool 接口（daemon→backend 反向调用）

daemon 侧 MCP server（或 backend MCP endpoint），主 agent tool_call 触发：
- `dispatch_worker(worker_id)`：backend 建 worker lease + per-worker worktree
- `get_worker_result(worker_id)`：读 worker AgentArtifact
- `list_workers()`：worker 状态列表
- `converge_mission()`：触发 FinalizerService 合并 patch + 收敛
- `report_progress(note)`：主 agent 决策日志（前端展示）

鉴权：daemon→backend 用现有 daemon auth token + 权限校验 + 限流。

### per-worker worktree 生命周期

- worker dispatch：`git worktree add` 临时分支（基于 workspace root）
- worker 写代码到自己的 worktree
- worker complete_lease：`git diff` → `AgentArtifact(kind='patch')`
- converge：主 agent 合并（`git merge` 各 worker patch 到主 worktree，冲突人审 apply-back）

### 三重收敛（OR，任一触发即收敛）

1. 所有预设 worker 完成（worker_runs 全 done/failed）
2. 主 agent 判断目标达成（主 agent tool_call `converge_mission`）
3. 预算/超时硬截断（`mission.budget_usd` 触顶 或 超时 → 强制 converge）

### v1 演进（不重写）

- `mode=single` → v1 原路径（零回归）
- `mode=team` → v2 主 agent orchestrator
- GLM Coordinator/Finalizer **保留作 fallback**（主 agent 不可用 / 用户选 GLM 模型时退化走 v1 GLM 链路）
- Wave 1+2 的 mode UI + mode/session_id 透传链路**复用**

### 三入口

| 入口 | 触发 | worker 来源 | 结果展示 |
|---|---|---|---|
| mission 页 | mission-console 配 team | UI 配 worker 列表 | mission 详情页 |
| execute·verify stage | stage team toggle | stage 配 worker（impl/verify） | 变更详情 + mission 页 |
| 会话 | "用团队分析"按钮 | 默认 worker 模板 | 会话内嵌 + mission 页（主 agent 绑 session） |

## 文件变更清单（预估，plan 细化）

| 文件路径 | 改动 |
|---|---|
| backend/app/modules/agent/model.py | AgentRun 加 role='orchestrator'/worktree_branch；AgentMission 加 worker_preset/main_agent_config |
| backend/app/modules/agent/orchestrator.py | 新建 OrchestratorService（主 agent 调度循环 + 三重收敛骨架） |
| backend/app/modules/agent/execution.py | dispatch_worker per-worker worktree + per-worker provider/model |
| backend/app/modules/agent/finalizer.py | 合并多 worker patch（git merge）+ converge_mission + 修 v1 patch 断点 |
| backend/app/modules/agent/mcp_tools.py | 新建 MCP endpoint（dispatch/get_result/converge/list/progress） |
| backend/app/modules/agent/router.py | create_mission 旁路 planner + mode 分流 |
| backend/app/modules/agent/mission.py | start_mission mode=team 旁路 CoordinatorPlanner |
| backend/app/modules/change/dispatch.py | verify stage team gate（merge_gate_results 策略 A） |
| sillyhub-daemon/src/mcp-server.ts | 新建内置 stdio MCP server（5 tool） |
| sillyhub-daemon/src/hub-client.ts | 加 5 反向方法（仿 change-write 三段式 + X-Claim-Token） |
| sillyhub-daemon/src/mcp-config.ts | platform_default 注入本 MCP server |
| sillyhub-daemon/src/interactive/driver.ts | MCP tool 转发（主 agent tool_call → backend） |
| sillyhub-daemon/src/interactive/session-manager.ts | 主 agent lease 长生命周期 + session 恢复 |
| frontend/src/components/mission-console.tsx | team 配置面板（主 agent 类型/模型 + worker 列表） |
| frontend/src/components/interactive-session-panel.tsx | 用团队分析 + 主 agent 绑 session |
| frontend/src/components/team-progress.tsx | 新建 team 进度（决策日志 + worker + CostBar） |
| frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | stage team 配置（execute+verify） |
| frontend/src/lib/agent.ts | CreateMissionInput 加 worker_preset/main_agent_config |
| backend/migrations/versions/ | AgentRun role/worktree_branch + AgentMission worker_preset/main_agent_config（新 migration） |

## 7. 关键设计点

- **R-01 主 agent 长生命周期 lease**：跨多 worker 周期，daemon 要支持长 interactive session（超时配置 + 心跳续期，参照 daemon 重启 session 恢复机制）
- **R-02 MCP 反向调用安全**：daemon→backend 用 daemon auth token，限流 + 权限校验（WORKSPACE_WRITE）
- **R-03 worktree 合并冲突**：主 agent converge 时 git merge，冲突人审 apply-back（D-006 缓解）
- **R-04 成本控制**：主 agent + 多 worker 烧 token，budget_usd 硬截断 + 前端 CostBar 展示
- **R-05 主 agent 决策质量**：依赖主 agent LLM 判断力（建议强模型如 claude-opus；用户预设 worker 降低主 agent 决策负担）
- **R-06 主 agent 绑 session（会话入口）**：mission 加 session_id（v1 Wave 1 R-B 只铺 schema，v2 补 model 绑定）

## 8. 决策记录

- **D-001@v2（推翻 v1 D-001）**：team = 主 agent 动态编排（多 agent 协调）。理由：用户要项目经理式动态指挥，v1 排除会话多 agent 轮转的考量推翻；主 agent 走 mission 特殊 AgentRun + daemon lease，不在 driver 层加协调原语（控制成本）。
- **D-002@v2**：worker 用户预设（非主 agent 自动拆解）。理由：用户控制强 + 可预期；主 agent 按列表派 + 动态调度（补/调整/收敛），不自动拆。
- **D-003@v2**：主 agent + worker 都自由组合 agent 类型 + 模型。GLM 不再特殊（推翻 v1 design §3 非目标）。
- **D-004@v2（演进 v1 D-004）**：mode=team 走主 agent orchestrator；GLM Coordinator/Finalizer 保留作 fallback（主 agent 不可用 / 用户选 GLM 时退化）。
- **D-005@v2**：per-worker 独立 git worktree（v1 D-006 延后项的完整实现）。理由：写代码 worker 并发写必须隔离，主 agent 合并 patch。
- **D-006@v2**：三重收敛（worker 全完 / 主 agent 判断达成 / 预算超时硬截断）。
- **D-007@v2**：MCP tool 反向调用（daemon→backend）。理由：主 agent 是真 agent，要 tool 调 backend 派 worker；比 backend 主动规划更贴"主 agent 指挥"。

## 9. 验收标准

- **AC-1**：mission 页配 team（主 agent 类型/模型 + worker 列表）→ 主 agent 接管 → 按列表派 worker（各独立 worktree）→ 读产出 → 动态调度 → 收敛合并
- **AC-2**：execute stage team → 多 impl worker 并行写（独立 worktree）→ 主 agent 合并 patch（人审 apply-back）
- **AC-3**：verify stage team → 多 verify worker 并行核验 → 主 agent 合并结论
- **AC-4**：会话"用团队分析" → 主 agent（绑 session）team
- **AC-5**：主 agent + worker 自由组合 agent 类型 + 模型（UI 可选 + 数据层落库 + lease metadata 透传）
- **AC-6**：mode=single 零回归（走 v1 原路径）
- **AC-7**：三重收敛任一触发即收敛
- **AC-8**：GLM fallback（主 agent 不可用时退化 v1 GLM 链路）
- **AC-9**：e2e 三入口各真跑一次（需真 daemon + 多 provider 配置）
- **AC-10**：模块文档同步（backend.md/frontend.md 变更索引）

## 10. 风险与遗留

| 风险 | 严重度 | 缓解 |
|---|---|---|
| MCP 反向调用安全 | 🟠 P0 | daemon auth token + 权限校验 + 限流 |
| 主 agent lease 长生命周期 | 🟠 P1 | 超时配置 + 心跳续期 + 复用 daemon session 恢复 |
| worktree 合并冲突 | 🟠 P1 | git merge + 人审 apply-back（D-006 缓解） |
| 主 agent 决策质量 | 🟡 P2 | 建议强模型 + 用户预设 worker 降低决策负担 |
| 多 agent 烧 token | 🟡 P2 | budget_usd 硬截断 + CostBar |
| driver/daemon 改动复杂度 | 🟠 P1 | 分 Wave 推进，先核心编排循环 |
| v1/v2 mission 链路共存复杂 | 🟡 P2 | mode 分流清晰，GLM fallback 明确降级路径 |
| execute 写 mission patch 采集（v1 断点） | 🟠 P1 | v2 必须先接通 patch → AgentArtifact |

## 11. 自审

- ✅ 覆盖用户愿景（主 agent 动态指挥 + worker 自由组合 + 三入口 + per-worker worktree + 三重收敛）
- ✅ 推翻 v1 决策记录明确（D-001~007@v2，标注推翻/演进）
- ✅ 演进 v1（不重写，GLM fallback，Wave 1+2 mode UI/透传统用）
- ✅ 文件变更清单 + 验收标准（AC-1~10）+ 风险表齐备
- ⚠️ MCP tool 具体协议（MCP server 实现方式 / 传输层）待 plan 细化
- ⚠️ 主 agent lease 续期机制待 plan 细化（daemon 现有 lease 超时配置 + 心跳）
- ⚠️ worker_preset JSON schema 待 plan 定
- ⚠️ 跟 v1 Wave 3-5（未做）的关系：v2 接管 team 范畴，v1 Wave 3-5（verify team / 会话 team / e2e）合并进 v2 或废弃由 plan 决定
