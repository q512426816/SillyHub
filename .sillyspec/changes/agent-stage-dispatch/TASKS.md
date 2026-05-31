---
author: qinyi
created_at: 2026-06-01 18:30:00
---

# Tasks: Agent Stage Dispatch 统一调度

## Phase 1：统一调度入口

### Task 1.1：新建 SillySpecStageDispatchService

- **文件**：`backend/app/modules/change/dispatch.py`
- **描述**：在 dispatch 模块中新建 `SillySpecStageDispatchService` 类，提供 `dispatch_next_step()`、`sync_stage_status()`、`_build_stage_bundle()` 三个核心方法
- **依赖**：无
- **验收标准**：
  - `dispatch_next_step()` 能创建 AgentRun 并返回 dispatch 结果
  - `sync_stage_status()` 能读取 sillyspec.db 并同步到 Change
  - 单测通过

### Task 1.2：废弃 start_sillyspec_run

- **文件**：`backend/app/modules/agent/coordinator.py`
- **描述**：标记 `start_sillyspec_run()` 和 `_run_sillyspec_background()` 为 deprecated，添加警告日志
- **依赖**：无
- **验收标准**：
  - 方法有 deprecation 文档标记
  - 调用时打印 deprecation warning 日志
  - 方法体保留不删除

### Task 1.3：迁移 change_writer 调用

- **文件**：`backend/app/modules/change_writer/router.py`
- **描述**：将 `coordinator.start_sillyspec_run()` 调用替换为 `SillySpecStageDispatchService.dispatch_next_step()`
- **依赖**：Task 1.1
- **验收标准**：
  - 无 `start_sillyspec_run` 调用残留
  - change_writer 路由能正常触发 dispatch
  - 集成测试通过

### Task 1.4：修改 transition_with_dispatch 对接新调度

- **文件**：`backend/app/modules/change/service.py`
- **描述**：`transition_with_dispatch()` 中将 `dispatch()` 调用改为 `SillySpecStageDispatchService.dispatch_next_step()`
- **依赖**：Task 1.1
- **验收标准**：
  - transition 后自动触发新调度逻辑
  - dispatch 结果正确返回

## Phase 2：修正 Agent prompt 与 adapter

### Task 2.1：扩展 AgentSpecBundle 字段

- **文件**：`backend/app/modules/agent/base.py`
- **描述**：为 `AgentSpecBundle` 新增 `stage_dispatch`、`change_key`、`stage`、`spec_root`、`step_prompt`、`read_only` 字段
- **依赖**：无
- **验收标准**：
  - 新增字段有默认值，不影响现有 task-level 调用
  - `validate_bundle()` 检查 stage_dispatch 时 change_key 和 stage 不为 None

### Task 2.2：新增 build_stage_bundle 函数

- **文件**：`backend/app/modules/agent/context_builder.py`
- **描述**：新增 `build_stage_bundle()` 函数，构造阶段级 AgentSpecBundle，加载 Change 信息和已有文档内容
- **依赖**：Task 2.1
- **验收标准**：
  - bundle.stage_dispatch == True
  - bundle.change_key 不为 None
  - bundle.stage 不为 None
  - 已有文档内容（proposal/design/requirements/tasks）被加载

### Task 2.3：修复 adapter 阶段 dispatch prompt

- **文件**：`backend/app/modules/agent/adapters/claude_code.py`
- **描述**：`run_with_bundle()` 中，当 `bundle.stage_dispatch == True` 时，生成明确的阶段执行 prompt，包含 `sillyspec run <stage> --change <change_key>` 命令
- **依赖**：Task 2.1
- **验收标准**：
  - prompt 包含 `sillyspec run <stage> --change <change_key>` 格式
  - prompt 不包含泛化的 `sillyspec init` 或 `sillyspec run scan`
  - read_only 模式时 prompt 包含 READ-ONLY 警告

### Task 2.4：修改 _execute_stage_run 不写 CLAUDE.md

- **文件**：`backend/app/modules/agent/service.py`
- **描述**：移除 `_execute_stage_run()` 中直接写 CLAUDE.md 的逻辑（line 704-717），改为构造完整的 AgentSpecBundle 传给 adapter
- **依赖**：Task 2.2, Task 2.3
- **验收标准**：
  - `_execute_stage_run` 不调用 `(work_dir / "CLAUDE.md").write_text()`
  - AgentSpecBundle 通过 `build_stage_bundle()` 构造
  - adapter 写入的 CLAUDE.md 包含阶段调度内容

## Phase 3：修正阶段配置

### Task 3.1：补齐 STAGE_AGENT_CONFIG

- **文件**：`backend/app/modules/change/dispatch.py`
- **描述**：为 archive 和 quick 新增配置，修正 scan/brainstorm/propose/plan/verify 的 read_only 和 requires_worktree
- **依赖**：无
- **验收标准**：
  - 8 个 SillySpec 阶段全部有配置
  - propose: requires_worktree=True, read_only=False
  - plan: requires_worktree=True, read_only=False
  - archive: requires_worktree=True, read_only=False
  - quick: requires_worktree=True, read_only=False
  - brainstorm: requires_worktree=True, read_only=False
  - verify: requires_worktree=True, read_only=False
  - scan: read_only=False

### Task 3.2：使用 StageEnum 常量约束配置键

- **文件**：`backend/app/modules/change/dispatch.py`
- **描述**：STAGE_AGENT_CONFIG 的键改为 `StageEnum.X.value` 形式，编译期保证覆盖完整性
- **依赖**：Task 3.1
- **验收标准**：
  - 所有键使用 `StageEnum.SCAN.value` 等枚举值
  - `get_config_for_stage()` 能正确查询

## Phase 4：状态同步

### Task 4.1：实现 sync_stage_status

- **文件**：`backend/app/modules/change/dispatch.py`
- **描述**：实现 `SillySpecStageDispatchService.sync_stage_status()`，AgentRun 完成后读取 sillyspec.db 同步步骤状态
- **依赖**：Task 1.1
- **验收标准**：
  - 能读取 sillyspec.db 的 changes/steps 表
  - 同步到 Change.current_stage 和 Change.stages
  - sillyspec.db 不存在时记录 warning 不中断

### Task 4.2：_execute_stage_run 完成后调用 sync

- **文件**：`backend/app/modules/agent/service.py`
- **描述**：在 `_execute_stage_run` 完成后调用 `SillySpecStageDispatchService.sync_stage_status()`
- **依赖**：Task 4.1
- **验收标准**：
  - AgentRun 完成后自动触发状态同步
  - 如果有 pending step，自动创建下一个 AgentRun
  - 如果 stage completed，不重复 dispatch

### Task 4.3：记录同步失败为 incident

- **文件**：`backend/app/modules/change/dispatch.py`
- **描述**：sync_stage_status 失败时创建 incident 记录
- **依赖**：Task 4.1
- **验收标准**：
  - 读取 sillyspec.db 失败时创建 incident
  - incident 类型为 "stage_sync_failed"

## Phase 5：工作区与 worktree

### Task 5.1：修复只读路径判断

- **文件**：`backend/app/modules/agent/service.py`
- **描述**：`start_stage_dispatch()` 中 `change.path` 拼接到 workspace root 后再判断 `is_dir()`
- **依赖**：无
- **验收标准**：
  - `Path(workspace_root) / change.path` 先判断
  - 不再直接 `Path(change.path).is_dir()`

### Task 5.2：worktree 内 change 目录检查

- **文件**：`backend/app/modules/agent/service.py`
- **描述**：worktree 创建后检查 `.sillyspec/changes/<change_key>/` 是否存在，不存在则从主 repo 复制
- **依赖**：无
- **验收标准**：
  - worktree 创建后验证 change 目录存在
  - 不存在时自动复制
  - 复制失败时记录错误但不中断

## Phase 6：API 与前端契约

### Task 6.1：新增 TransitionResponse schema

- **文件**：`backend/app/modules/change/schemas.py`（或 router.py 中内联）
- **描述**：新增 `DispatchResponse` 和 `TransitionResponse` Pydantic model
- **依赖**：无
- **验收标准**：
  - `TransitionResponse` 包含 `change` 和 `agent_dispatch` 字段
  - `DispatchResponse` 包含 `dispatched`、`agent_run_id`、`stage`、`reason` 字段

### Task 6.2：transition 路由使用新 response model

- **文件**：`backend/app/modules/change/router.py`
- **描述**：`transition_change` 端点声明 `response_model=TransitionResponse`
- **依赖**：Task 6.1
- **验收标准**：
  - 路由返回符合 TransitionResponse 结构
  - OpenAPI schema 正确

### Task 6.3：修正前端 transitionChange 返回类型

- **文件**：`frontend/src/lib/changes.ts`
- **描述**：`transitionChange()` 返回类型从 `ChangeRead` 改为 `TransitionResponse`，新增 `DispatchResponse` 和 `TransitionResponse` 类型定义
- **依赖**：Task 6.2
- **验收标准**：
  - TypeScript 编译通过
  - 类型与后端 response model 一致

### Task 6.4：变更详情页展示 agent 状态

- **文件**：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- **描述**：变更详情页展示当前 SillySpec stage、当前 step、AgentRun 状态、下一步动作
- **依赖**：Task 6.3
- **验收标准**：
  - 页面显示当前 stage 名称
  - 页面显示 AgentRun 状态
  - transition 后页面正确更新

## Phase 7：测试闭环

### Task 7.1：dispatch 单测

- **文件**：`backend/tests/modules/change/test_dispatch.py`
- **描述**：测试 STAGE_AGENT_CONFIG 完整性、dispatch_next_step 创建 AgentRun、prompt 包含正确命令
- **依赖**：Task 1.1, Task 3.1
- **验收标准**：
  - 测试 STAGE_AGENT_CONFIG 覆盖 8 个阶段
  - 测试 propose prompt 包含 `sillyspec run propose`
  - 测试 propose read_only == False

### Task 7.2：adapter 单测

- **文件**：`backend/tests/modules/agent/test_stage_adapter.py`
- **描述**：测试 stage_dispatch 模式下 adapter 生成正确的 prompt 和 CLAUDE.md
- **依赖**：Task 2.3
- **验收标准**：
  - 测试 stage_dispatch=True 时 prompt 包含 sillyspec 命令
  - 测试 CLAUDE.md 不被覆盖
  - 测试 read_only 模式

### Task 7.3：状态同步集成测试

- **文件**：`backend/tests/modules/agent/test_stage_dispatch.py`
- **描述**：测试 AgentRun 完成后状态同步、自动调度下一 step、stage 完成不重复 dispatch
- **依赖**：Task 4.1, Task 4.2
- **验收标准**：
  - 测试 draft → propose 创建 AgentRun
  - 测试 sync_stage_status 更新 Change.current_stage
  - 测试 pending step 时自动调度
  - 测试 completed stage 时不重复调度

### Task 7.4：前端类型测试

- **文件**：`frontend/src/lib/__tests__/changes.test.ts`（或等价位置）
- **描述**：验证 transitionChange 返回类型与后端一致
- **依赖**：Task 6.3
- **验收标准**：
  - TypeScript 编译通过
  - 类型检查无误
