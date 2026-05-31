---
author: qinyi
created_at: 2026-06-01 18:15:00
---

# Proposal: Agent Stage Dispatch 统一调度

## 动机

当前 Hub 存在三套相互重叠的 Agent 调度逻辑：

1. **Hub 自维护调度**：`ChangeService.transition_with_dispatch()` → `dispatch()` → `AgentService.start_stage_dispatch()` → `_execute_stage_run()`，通过 `STAGE_AGENT_CONFIG` 配置驱动。
2. **子进程直跑**：`ExecutionCoordinatorService.start_sillyspec_run()` 直接 `asyncio.create_subprocess_exec("sillyspec", ...)`，绕过 Agent 适配器层。
3. **泛化 Adapter**：`ClaudeCodeAdapter.run_with_bundle()` 只给出 `sillyspec init / scan` 泛化提示，未明确要求 agent 执行 `sillyspec run <stage> --change <key>`。

这三套逻辑没有统一边界，导致：
- Agent 执行阶段时 **prompt 丢失**（CLAUDE.md 被覆盖）
- Agent 不知道该运行什么 SillySpec 命令
- 阶段配置不完整（缺 archive/quick）
- propose/plan 被错误标记为只读
- 状态同步断裂（sillyspec.db 变更不同步回 Hub）
- 前后端 API 契约不一致

## 关键问题

### P0 — 不修就无法正常工作

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1 | CLAUDE.md 覆盖导致阶段 prompt 丢失 | `service.py:704-720` → `claude_code.py:138-139` | Agent 无法获取正确的阶段指令 |
| 2 | AgentSpecBundle 最小空包 | `service.py:695-699` | Agent 缺少 change_key、stage 等关键上下文 |
| 3 | Adapter 只给泛化 sillyspec init/scan 提示 | `claude_code.py:147-153` | Agent 不知道该运行 `sillyspec run <stage>` |
| 4 | start_sillyspec_run 直接子进程绕过 Agent | `coordinator.py:427-534` | 绕过 Agent 模型，无法收集日志/状态 |
| 5 | sillyspec.db 状态不同步回 Hub | `_execute_stage_run` 无同步逻辑 | Hub 不知道 Agent 完成了哪些步骤 |

### P1 — 配置和契约

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 6 | STAGE_AGENT_CONFIG 缺 archive/quick | `dispatch.py:42-91` | 这两个阶段无法自动 dispatch |
| 7 | propose/plan 错标为 read_only=True | `dispatch.py:46-55` | Agent 不敢写文档 |
| 8 | 前端 transitionChange 返回类型不匹配 | `changes.ts:269` vs `router.py:285` | 前端拿不到 agent_dispatch 信息 |

### P2 — 自动化和 UI

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 9 | AgentRun 完成后不自动调度下一 step | `_execute_stage_run` 无后续调度 | 需手动反复触发 |
| 10 | 变更详情页不展示 SillySpec 步骤进度 | 前端页面 | 用户无法感知执行进度 |
| 11 | 三字段状态边界未文档化 | Change.status / current_stage / sillyspec.db | 容易再次漂移 |

## 变更范围

### 在范围内

1. **统一调度入口**：新建 `SillySpecStageDispatchService`，废弃 `start_sillyspec_run` 子进程路径
2. **修正 Agent prompt 与 adapter**：修复 CLAUDE.md 覆盖、扩展 AgentSpecBundle、adapter 明确 sillyspec 阶段命令
3. **修正阶段配置**：补齐 archive/quick、修正 read_only 标记、使用 StageEnum 约束
4. **状态同步**：AgentRun 完成后从 sillyspec.db 同步步骤状态，三字段边界明确
5. **工作区与 worktree**：写阶段运行目录策略、修复只读路径判断
6. **API 与前端契约**：transition response model、前端类型修正
7. **测试闭环**：单测 + 集成测试

### 不在范围内

- 不修改 SillySpec CLI 本身（CLI 是外部工具）
- 不修改 StageEnum 枚举值（已在 workflow-state-unification 变更中统一）
- 不修改 TRANSITIONS 流转图（已在 workflow-state-unification 变更中对齐）
- 不实现 UI 细化（如步骤进度条动画），仅确保数据可展示
- 不实现跨 workspace 调度

## 成功标准

| # | 标准 | 验证方式 |
|---|------|---------|
| 1 | Agent 执行阶段时 prompt 包含 `sillyspec run <stage> --change <key>` | 单测检查最终 prompt |
| 2 | propose/plan/archive/quick 均标记为写阶段 | 检查 STAGE_AGENT_CONFIG |
| 3 | 废弃 start_sillyspec_run 路径，不产生新调用 | grep 搜索确认 |
| 4 | AgentRun 完成后 Hub 能读取 sillyspec.db 同步当前步骤 | 集成测试 |
| 5 | 前端 transitionChange 返回类型与后端一致 | TypeScript 编译通过 |
| 6 | 所有 7 个 Phase 的测试通过 | pytest |
| 7 | draft → propose → plan → execute → verify 完整链路可用 | 端到端测试 |
