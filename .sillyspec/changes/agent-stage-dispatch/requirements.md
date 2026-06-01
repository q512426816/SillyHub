---
author: qinyi
created_at: 2026-06-01 18:25:00
---

# Requirements: Agent Stage Dispatch 统一调度

## 角色表

| 角色 | 说明 | 权限范围 |
|------|------|---------|
| admin | 系统管理员 | 所有阶段流转、手动 dispatch |
| business_user | 业务用户 | 发起变更（draft → propose/quick） |
| reviewer | 评审者 | approve/reject 阶段（propose → plan 等） |
| agent | AI Agent（通过 AgentRun） | 执行 SillySpec 阶段命令 |
| system | 系统自动 | accepted → archive 自动流转 |

## 功能需求

### FR-01: 统一调度入口

**Given** 一个变更已流转到某个 SillySpec 阶段（如 propose）
**When** Hub 需要为该阶段启动 Agent 执行
**Then** 通过 `SillySpecStageDispatchService.dispatch_next_step()` 创建 AgentRun，AgentRun 的 prompt 包含 `sillyspec run <stage> --change <change_key>`，而不是泛化的 init/scan 命令

**验收标准**：
- dispatch_next_step 返回的 AgentRun 包含正确的 stage prompt
- prompt 中出现 `sillyspec run propose --change <key>` 格式
- 不出现 `sillyspec init` 或 `sillyspec run scan` 的泛化提示

### FR-02: 废弃子进程直跑路径

**Given** 一个变更需要执行 SillySpec 阶段
**When** 通过任何入口触发执行
**Then** 不直接在 Hub 后端运行 `sillyspec` 子进程，而是通过 Agent 适配器层执行
**And** `ExecutionCoordinatorService.start_sillyspec_run()` 被标记为 deprecated

**验收标准**：
- coordinator.py 中 start_sillyspec_run 有 @deprecated 标记
- change_writer/router.py 不再调用 start_sillyspec_run
- 全局搜索无新的 start_sillyspec_run 调用

### FR-03: CLAUDE.md 不被覆盖

**Given** Agent 正在执行阶段调度
**When** adapter 生成 CLAUDE.md 并写入工作目录
**Then** CLAUDE.md 中包含完整的阶段指令（包括 sillyspec 命令和当前 step prompt），不被后续操作覆盖

**验收标准**：
- _execute_stage_run 不直接写 CLAUDE.md
- adapter.run_with_bundle 写入的 CLAUDE.md 包含阶段调度内容
- 最终 CLAUDE.md 包含 `sillyspec run <stage>` 命令

### FR-04: 阶段配置完整

**Given** SillySpec 有 8 个主阶段（scan/brainstorm/propose/plan/execute/verify/archive/quick）
**When** 查询 STAGE_AGENT_CONFIG
**Then** 全部 8 个阶段都有对应配置
**And** propose/plan/brainstorm/archive/quick 被标记为 requires_worktree=True, read_only=False
**And** scan 被标记为 read_only=False（写扫描文档）

**验收标准**：
- STAGE_AGENT_CONFIG 包含 8 个条目
- propose 的 read_only == False
- plan 的 read_only == False
- archive 的 requires_worktree == True
- quick 的 requires_worktree == True

### FR-05: AgentSpecBundle 含阶段上下文

**Given** Agent 正在执行阶段级调度（非 task 级）
**When** 构造 AgentSpecBundle
**Then** bundle 包含 change_key、stage、spec_root、已有文档内容（proposal/design/requirements/tasks/plan）
**And** bundle.stage_dispatch == True

**验收标准**：
- bundle.change_key 不为 None
- bundle.stage 不为 None
- bundle.stage_dispatch == True
- bundle.proposal 包含已有 proposal 内容（如果存在）

### FR-06: 状态同步

**Given** AgentRun 已完成一个 SillySpec step
**When** _execute_stage_run 执行完毕
**Then** Hub 读取 sillyspec.db 同步当前步骤状态到 Change.current_stage 和 Change.stages
**And** 如果当前 stage 还有 pending step，自动创建下一个 AgentRun
**And** 如果 stage completed，不重复 dispatch

**验收标准**：
- AgentRun 完成后 Change.current_stage 已更新
- Change.stages 包含步骤级状态投影
- stage 未完成时自动触发下一次 dispatch
- stage 完成后不再 dispatch

### FR-07: 三字段边界

**Given** Hub 管理变更状态
**When** 查询变更状态
**Then** 三个字段职责明确：
- `Change.status`：Hub 生命周期（active/done/archived），由 ChangeService 管理
- `Change.current_stage`：SillySpec 阶段投影，由 sync_stage_status 从 sillyspec.db 同步
- `sillyspec.db`：SillySpec 阶段/步骤唯一事实源，由 SillySpec CLI 写入

**验收标准**：
- sync_stage_status 是唯一写入 Change.current_stage 的地方（transition 除外）
- sillyspec.db 不被 Hub 代码修改

### FR-08: 工作目录正确

**Given** Agent 正在执行写阶段（如 propose）
**When** 确定工作目录
**Then** 如果 workspace 有 git identity，使用 worktree repo 目录
**And** 如果没有 git identity，使用 workspace root（允许写入但记录审计）
**And** 只读阶段使用 workspace root

**验收标准**：
- propose 阶段工作目录可写
- change.path 拼接到 workspace root 后再判断
- worktree 内 .sillyspec/changes/<key>/ 目录存在

### FR-09: Transition Response Model

**Given** 用户调用 POST /changes/{id}/transition
**When** 后端返回结果
**Then** 返回类型为 `{ change: ChangeRead, agent_dispatch: DispatchResponse | null }`
**And** 前端 `transitionChange()` 返回类型匹配此结构

**验收标准**：
- 后端路由声明了 response_model=TransitionResponse
- 前端 TransitionResponse 类型与后端一致
- TypeScript 编译通过

### FR-10: 测试覆盖

**Given** 所有 Phase 1-6 的改动已完成
**When** 运行测试套件
**Then** 以下测试全部通过：
- 单测：stage dispatch prompt 包含正确的 sillyspec 命令
- 单测：AgentSpecBundle 阶级字段正确
- 单测：STAGE_AGENT_CONFIG 覆盖 8 个阶段
- 单测：propose/plan 标记为写阶段
- 集成测试：draft → propose 创建 AgentRun
- 集成测试：AgentRun 完成后状态同步
- 集成测试：stage 未完成时自动调度下一 step
- 集成测试：stage 完成后不重复 dispatch

**验收标准**：
- pytest 全部通过
- 测试覆盖率 > 80% 对 dispatch.py 的改动
