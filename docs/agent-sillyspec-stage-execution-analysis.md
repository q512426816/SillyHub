---
author: qinyi
created_at: 2026-06-01 06:11:13
updated_at: 2026-06-01 17:30:00
---

# Agent 调用 SillySpec 阶段执行分析与整改清单

## 结论

当前 Hub 里已经有三套相互重叠的执行思路：

1. Hub 自己维护 `Change.current_stage` 并在阶段流转后自动 dispatch agent。
2. Hub 的 `/changes/{change_key}/execute` 直接启动一个 `sillyspec` 子进程。
3. Claude Code adapter 通过 `AgentSpecBundle` 启动 agent，但只给了泛化任务 prompt，并没有稳定要求 agent 执行对应的 SillySpec 阶段命令。

这三套逻辑现在没有统一边界，所以表现会像“每个阶段好像都能触发，但真正要 agent 使用 sillyspec CLI 执行阶段时就断了”。推荐统一成一个模型：

> Hub 负责排队、权限、状态展示和审计；SillySpec CLI 负责阶段步骤定义；Agent 负责运行 `sillyspec run <stage> --change <change>`、按 CLI 输出的 prompt 完成工作，并用 `--done` 回写阶段步骤。

## 推荐目标模型

```
用户/系统触发阶段
        |
        v
Hub Transition / Dispatch API
        |
        v
创建 AgentRun(sillyspec_stage_step)
        |
        v
Claude Code Agent
        |
        | 1. cd <repo_or_worktree>
        | 2. sillyspec run <stage> --change <change_key>
        | 3. 按 CLI 输出 prompt 读取/修改文件
        | 4. sillyspec run <stage> --done --input "<用户输入>" --output "<摘要>"
        v
.sillyspec/.runtime/sillyspec.db
        |
        v
Hub 同步/读取 DB，更新 Change/AgentRun/UI
```

建议粒度：**一个 AgentRun 执行一个 SillySpec 当前 step**。  
原因是 `sillyspec run <stage>` 本身按当前 pending step 输出 prompt，完成后用 `--done` 前进。Hub 不需要复制 SillySpec 的阶段步骤表，只需要反复调度下一步，直到该 stage completed。

## 当前主要问题

- [ ] `AgentService._execute_stage_run()` 先写入包含阶段 prompt 的 `CLAUDE.md`，随后又调用 `ClaudeCodeAdapter.run_with_bundle()`；adapter 会重新生成并覆盖 `CLAUDE.md`，导致真正传给 agent 的阶段 prompt 丢失。
- [ ] `AgentSpecBundle` 在 stage dispatch 场景里是最小空包，只包含 `Change stage: <stage>` 和 `stage:<stage>`，没有 proposal/design/tasks/plan 内容，也没有当前 SillySpec step prompt。
- [ ] `ClaudeCodeAdapter.run_with_bundle()` 只追加了 `sillyspec init` / `sillyspec run scan` 的泛化提示，没有告诉 agent 执行 `sillyspec run <stage> --change <change_key>`。
- [ ] `STAGE_AGENT_CONFIG` 虽然映射到 `propose/plan/execute/verify/...`，但 prompt 模板还是 Hub 自己定义的一套泛化模板，不是 SillySpec CLI 输出的阶段 step prompt。
- [ ] `propose` 和 `plan` 当前配置为 `read_only=True` / `requires_worktree=False`，但 SillySpec 的 propose/plan 会写 `.sillyspec/changes/<name>/` 下的文档，按事实应是写阶段。
- [ ] `ExecutionCoordinatorService.start_sillyspec_run()` 直接跑子进程，不是“让 agent 使用 sillyspec 工具”；这和目标模型冲突。
- [ ] `start_sillyspec_run()` 的 full 命令是 `sillyspec run --change <name>`，缺少 `<stage>`，不是当前 CLI 入口格式；quick 命令也应统一为 `sillyspec run quick --change <name>`。
- [ ] Agent run 结束后只更新 `AgentRun` 和 `change.stages.last_dispatch`，没有明确把 `.sillyspec/.runtime/sillyspec.db` 中的阶段进度同步回 Hub 的 `Change.current_stage` / `stages`。
- [ ] `Change.current_stage`、`Change.status`、SillySpec SQLite `changes.current_stage` 三者的职责没有写死边界，容易再次漂移。
- [ ] transition API 返回 `{ change, agent_dispatch }`，但前端 `transitionChange()` 类型声明仍按 `ChangeRead` 使用，前后端契约不一致。
- [ ] 当前角色映射 `_get_user_role()` 只有 `admin` / `business_user`，但阶段流转要求里有 `agent` / `reviewer` / `system`；自动阶段推进会卡在权限模型上。
- [ ] 只读阶段用 `Path(change.path).is_dir()` 判断 change 目录，未拼 workspace root，容易误判并退回 workspace root。

## 设计决策清单

- [ ] 确认 Hub 不直接复刻 SillySpec 阶段步骤，只读取/调度 CLI 输出。
- [ ] 确认 `AgentRun` 粒度：一个 run 执行一个 SillySpec step，而不是一个 run 跑完整 stage。
- [ ] 确认完整流程入口使用 `sillyspec run auto --change <name>` 还是 Hub 逐阶段调度；推荐 Hub 逐阶段/逐 step 调度，便于 UI 展示和失败恢复。
- [ ] 确认写阶段是否全部使用 worktree。推荐：`propose/plan/execute/verify/archive/quick` 都按写阶段处理；纯分析阶段才允许 read-only。
- [ ] 确认状态字段边界：
  - `Change.status`：Hub 生命周期状态，例如 `active/done/archived`。
  - `Change.current_stage`：Hub 投影出的当前 SillySpec stage。
  - `.runtime/sillyspec.db`：SillySpec 阶段/步骤事实源。

## 整改任务清单

### Phase 1：统一调度入口

- [ ] 废弃或改造 `ExecutionCoordinatorService.start_sillyspec_run()`，不要再直接由后端子进程运行 `sillyspec`。
- [ ] 新增统一服务，例如 `SillySpecStageDispatchService`，只负责创建 `AgentRun` 和构造 agent 指令。
- [ ] 所有入口统一到一个调度方法：
  - [ ] 变更创建后启动第一阶段。
  - [ ] 手动 dispatch 当前阶段。
  - [ ] 当前 step 完成后继续调度下一 step。
  - [ ] 失败后重试同一 step。

### Phase 2：修正 agent prompt 与 adapter

- [ ] 修复 `CLAUDE.md` 被覆盖的问题：stage dispatch 的 prompt 必须进入最终 `CLAUDE.md` 或 agent user prompt。
- [ ] 为 `AgentSpecBundle` 增加 stage dispatch 所需上下文：
  - [ ] `change_key`
  - [ ] `stage`
  - [ ] `repo_dir` / `spec_root`
  - [ ] 当前 SillySpec step 输出
  - [ ] proposal/design/requirements/tasks/plan 文档内容
  - [ ] allowed_paths / denied_paths
- [ ] adapter prompt 明确要求 agent 执行：
  - [ ] `sillyspec run <stage> --change <change_key>`
  - [ ] 按 CLI 输出的 prompt 完成任务
  - [ ] `sillyspec run <stage> --done --input "<输入摘要>" --output "<完成摘要>"`
- [ ] 禁止使用泛化的 `sillyspec init` / `scan` 提示替代具体阶段命令。

### Phase 3：修正阶段配置

> **前置**：`StageEnum` 已统一为 8 个 SillySpec 阶段（`scan/brainstorm/propose/plan/execute/verify/archive/quick`）+ 3 个 Hub 扩展（`draft/rework_required/accepted`）。`STAGE_AGENT_CONFIG`（`dispatch.py:45`）当前只覆盖 `propose/plan/execute/verify/brainstorm/scan`，**缺 `archive` 和 `quick`**，且未用 `StageEnum` 常量约束。必须全部补齐。

- [ ] 将 `STAGE_AGENT_CONFIG` 键名改为引用 `StageEnum` 成员值，编译期保证覆盖完整性。
- [ ] `scan`：写扫描文档到 `.sillyspec/docs/`，不应标记 `read_only=True`（除非纯检测模式）。
- [ ] `brainstorm`：**一等 SillySpec 阶段**，目标命令 `sillyspec run brainstorm --change <name>`。Agent 读取需求讨论、输出问题清单/决策记录。需要 worktree（写入 change 目录）。
- [ ] `propose`：写四件套（proposal/design/requirements/tasks），`requires_worktree=True`，`read_only=False`。
- [ ] `plan`：写 `plan.md` 和 `tasks/task-NN.md`，`requires_worktree=True`，`read_only=False`。
- [ ] `execute`：写代码，必须 worktree。
- [ ] `verify`：写 `verify-result.md`，建议 worktree。
- [ ] `archive`（**缺失**）：写 `module-impact.md` 并移动目录到 `changes/archive/`，必须写权限。
- [ ] `quick`（**缺失**）：写 quicklog，可能改代码，必须明确是否 worktree。

### Phase 4：状态同步

> **前置**：`layout_migration.py`（`core/layout_migration.py`）已处理 legacy layout 迁移（`changes/change/` → `changes/`、`verification.md` → `verify-result.md`、root `gate-status.json` → `.sillyspec/.runtime/gate-status.json`）。但迁移脚本未接入 `main.py` lifespan 自动调用，需要确认。

- [ ] AgentRun 完成后读取 `.sillyspec/.runtime/sillyspec.db`，同步当前 change 的 stage/step 状态。
- [ ] 如果当前 stage 还有 pending step，自动创建下一次 `AgentRun`。
- [ ] 如果 stage completed，Hub 根据策略决定：
  - [ ] 等待人工确认后进入下一 stage。
  - [ ] 或自动 transition 到下一 stage 并继续 dispatch。
- [ ] **状态字段边界**（三字段，职责明确）：
  - `Change.status`：Hub 生命周期（`active/done/archived`），仅平台内部使用。
  - `Change.current_stage`：Hub 投影出的当前 SillySpec stage，来源是 `sillyspec.db` 同步。
  - `.sillyspec/.runtime/sillyspec.db`：**SillySpec 阶段/步骤的唯一事实源**。Hub 只读不写此 DB。
- [ ] `gate-status.json`（`.sillyspec/.runtime/gate-status.json`）只作为 CLI/worktree hook 的物化文件，不作为 Hub 状态事实源。
- [ ] 记录同步失败为可见 incident，不要静默吞掉。

### Phase 5：工作区与 worktree

- [ ] 所有写阶段都明确运行目录：
  - [ ] repo-native：workspace root 或 worktree repo。
  - [ ] platform-managed：spec root + code root 分离。
  - [ ] repo-mirrored：先写托管 spec，再按策略同步到 repo。
- [ ] 修复只读路径判断：`change.path` 必须拼到 workspace/spec root 后再判断。
- [ ] worktree 创建后确认 `.sillyspec/changes/<change_key>/` 在 worktree 内存在；不存在则同步/复制/重新创建。
- [ ] 如果没有 git identity，明确 fallback：禁止写阶段，或允许本地 root 写入，但必须写入审计。

### Phase 6：API 与前端契约

> **前置**：`ChangeService.transition_with_dispatch()`（`service.py:374`）已实现 transition 后自动 dispatch，路由 `router.py:270` 直接使用。TRANSITIONS 已在 workflow-state-unification 变更中重写，对齐新 StageEnum。但 transition 路由返回 `{ change, agent_dispatch }` 的 response model 未明确声明，前端 `transitionChange()` 仍按 `ChangeRead` 理解。

- [ ] **完整链路画清楚**：
  ```
  用户点击流转按钮 → POST /changes/{id}/transition
      → ChangeService.transition_with_dispatch()
          → 1. 验证 TRANSITIONS 权限
          → 2. 更新 Change.current_stage
          → 3. 创建 AgentRun（如果目标阶段需要 agent）
          → 4. 返回 { change, agent_dispatch }
  → 前端更新 UI + 显示 agent 状态
  ```
- [ ] 后端 `POST /changes/{id}/transition` 增加明确 response model：`{ change: ChangeRead, agent_dispatch: DispatchResponse | null }`。
- [ ] 前端 `transitionChange()` 类型改为匹配后端返回结构。
- [ ] `DispatchResponse.last_dispatch` 类型与后端实际 dict 对齐，不要声明成另一套 `DispatchResult`。
- [ ] 变更详情页显示：
  - [ ] 当前 SillySpec stage + 当前 step
  - [ ] AgentRun 状态 + 上一次 CLI 命令
  - [ ] `.runtime/sillyspec.db` 同步状态
  - [ ] 下一步可执行动作

### Phase 7：测试闭环

- [ ] 单测：stage dispatch 不覆盖 stage prompt。
- [ ] 单测：adapter 最终 prompt 包含 `sillyspec run <stage> --change <change_key>`。
- [ ] 单测：full/quick 不再生成非法命令。
- [ ] 单测：`propose/plan` 被标记为写阶段。
- [ ] 集成测试：`draft -> propose` 创建 AgentRun，AgentRun prompt 正确。
- [ ] 集成测试：模拟 agent 执行 `--done` 后，Hub 从 SQLite 同步 step 状态。
- [ ] 集成测试：stage 未完成时自动调度下一 step。
- [ ] 集成测试：stage 完成后不重复 dispatch。
- [ ] 前端测试：transition 返回 `{change, agent_dispatch}` 后页面能正确更新。

## 建议优先级

P0 先修这四个，否则后面阶段都会像踩棉花：

- [ ] 修复 `CLAUDE.md` 覆盖和 prompt 丢失。
- [ ] 移除/暂停 direct subprocess 的 `start_sillyspec_run()` 路径。
- [ ] 明确 agent 必须执行 `sillyspec run <stage> --change <change_key>`。
- [ ] AgentRun 完成后从 `sillyspec.db` 同步 Hub 当前阶段/步骤。

P1 再修阶段配置、worktree 策略和 API 类型。

P2 再做自动连续 dispatch、UI 细化和 incident 化。

## 不建议的方向

- [ ] 不建议让 Hub 复制 SillySpec 每个阶段的 step prompt。SillySpec CLI 已经是 prompt 工具，Hub 复制后一定会再次漂移。
- [ ] 不建议让后端直接跑 `sillyspec` 子进程来替代 agent。这样绕开了“agent 读 prompt 并执行工作”的核心模型。
- [ ] 不建议继续混用 `Change.status` 和 `Change.current_stage` 表达同一件事。一个表示 Hub 生命周期，一个表示 SillySpec 阶段投影。
