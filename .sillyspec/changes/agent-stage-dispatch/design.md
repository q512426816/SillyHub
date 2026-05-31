---
author: qinyi
created_at: 2026-06-01 18:20:00
---

# Design: Agent Stage Dispatch 统一调度

## 目标架构

```
用户/系统触发阶段
        |
        v
Hub Transition API (POST /changes/{id}/transition)
        |
        v
ChangeService.transition_with_dispatch()
        |
        v
SillySpecStageDispatchService.dispatch_next_step()
        |
        v
创建 AgentRun(stage_dispatch)
        |
        v
Claude Code Agent
        |
        | 1. cd <work_dir>
        | 2. sillyspec run <stage> --change <change_key>
        | 3. 按 CLI 输出 prompt 读取/修改文件
        | 4. sillyspec run <stage> --done --input "..." --output "..."
        v
.sillyspec/.runtime/sillyspec.db (步骤级状态)
        |
        v
SillySpecStageDispatchService.sync_stage_status()
        |
        v
Hub 同步: Change.current_stage + Change.stages + AgentRun 状态
        |
        v
如果当前 stage 还有 pending step → 自动调度下一个 AgentRun
如果 stage completed → 等待人工确认或自动流转
```

### 核心原则

1. **Hub 只调度，不执行**：Hub 创建 AgentRun 并构造指令，Agent 通过 CLI 执行 SillySpec 命令
2. **一个 AgentRun = 一个 SillySpec step**：便于 UI 展示和失败恢复
3. **sillyspec.db 是唯一事实源**：Hub 只读不写此 DB，通过 `sync_stage_status()` 投影
4. **三字段边界明确**：`Change.status`（Hub 生命周期）、`Change.current_stage`（SillySpec 投影）、`sillyspec.db`（事实源）

## Phase 1：统一调度入口

### 废弃 start_sillyspec_run

- **文件**：`backend/app/modules/agent/coordinator.py`
- **改动**：标记 `start_sillyspec_run()` 和 `_run_sillyspec_background()` 为 `@deprecated`，在方法文档中明确废弃原因，保留方法体以避免 breaking change，但添加日志警告
- **文件**：`backend/app/modules/change_writer/router.py`
- **改动**：将 `coordinator.start_sillyspec_run()` 调用替换为 `SillySpecStageDispatchService.dispatch_next_step()`

### 新建 SillySpecStageDispatchService

- **文件**：`backend/app/modules/change/dispatch.py`
- **改动**：在现有 dispatch 模块中新增 `SillySpecStageDispatchService` 类

```python
class SillySpecStageDispatchService:
    """统一调度入口：创建 AgentRun + 构造 agent 指令。"""

    async def dispatch_next_step(
        self,
        session: AsyncSession,
        workspace_id: UUID,
        change_id: UUID,
        user_id: UUID,
        target_stage: str,
    ) -> dict[str, Any]:
        """为指定变更的阶段调度下一个 step。

        如果该阶段有 pending step，创建 AgentRun 并启动执行。
        返回 dispatch 结果信息。
        """

    async def sync_stage_status(
        self,
        session: AsyncSession,
        change_id: UUID,
        run_id: UUID,
    ) -> StageSyncResult:
        """AgentRun 完成后从 sillyspec.db 同步阶段/步骤状态。

        读取 sillyspec.db 的 changes 表获取当前 step 信息。
        如果当前 stage 还有 pending step，自动创建下一个 AgentRun。
        """

    async def _build_stage_bundle(
        self,
        session: AsyncSession,
        change_id: UUID,
        stage: str,
        workspace_id: UUID,
    ) -> AgentSpecBundle:
        """构造阶段级 AgentSpecBundle（含 change_key、stage、文档内容等）。"""
```

### 调度流程

所有入口统一到 `dispatch_next_step`：
1. 变更创建后启动第一阶段：`transition_with_dispatch` 自动触发
2. 手动 dispatch 当前阶段：`POST /changes/{id}/dispatch` 路由
3. 当前 step 完成后继续调度下一 step：`sync_stage_status` 内部判断
4. 失败后重试同一 step：手动 dispatch 或自动重试

## Phase 2：修正 Agent prompt 与 adapter

### 修复 CLAUDE.md 覆盖问题

- **文件**：`backend/app/modules/agent/service.py`
- **当前问题**：`_execute_stage_run()` 在 line 704-717 先写 CLAUDE.md，然后 line 720 调用 `adapter.run_with_bundle()`，后者在 `claude_code.py:139` 再次写入 CLAUDE.md，覆盖了阶段 prompt
- **方案**：不在 `_execute_stage_run` 中写 CLAUDE.md。改为在 `_build_stage_bundle()` 中构造完整的 `AgentSpecBundle`（含 stage prompt 内容），由 adapter 的 `render_bundle_to_claude_md()` 统一渲染

### 扩展 AgentSpecBundle

- **文件**：`backend/app/modules/agent/base.py`
- **新增字段**：

```python
@dataclass
class AgentSpecBundle:
    # ... 现有字段 ...

    # --- Stage dispatch 扩展 ---
    stage_dispatch: bool = False          # True 表示这是阶段级调度
    change_key: str | None = None         # 变更 key
    stage: str | None = None              # 目标 SillySpec 阶段
    spec_root: str | None = None          # .sillyspec/ 根目录路径
    step_prompt: str | None = None        # SillySpec CLI 当前 step 输出的 prompt
    read_only: bool = False               # 是否只读
```

### Adapter 明确 sillyspec 阶段命令

- **文件**：`backend/app/modules/agent/adapters/claude_code.py`
- **改动**：`run_with_bundle()` 中，当 `bundle.stage_dispatch == True` 时，生成明确的阶段执行 prompt：

```python
if bundle.stage_dispatch:
    prompt = (
        f"你是 SillySpec {bundle.stage} 阶段的执行者。\n\n"
        f"## 任务\n"
        f"为变更 {bundle.change_key} 完成 SillySpec {bundle.stage} 阶段。\n\n"
        f"## 执行步骤\n"
        f"1. 运行 `sillyspec run {bundle.stage} --change {bundle.change_key}`\n"
        f"2. 阅读当前 step 的 prompt\n"
        f"3. 按 prompt 完成工作\n"
        f"4. `sillyspec run {bundle.stage} --done --change {bundle.change_key} --input '...' --output '...'`\n"
        f"5. 重复直到所有步骤完成\n\n"
        f"## 规则\n"
        f"- 所有文档写入 `.sillyspec/changes/{bundle.change_key}/`\n"
        f"- 只产出文档，禁止改代码\n"
        f"- 文档头部 author + created_at\n"
        f"- 每步完成立即 --done\n"
    )
    if bundle.read_only:
        prompt += "\n## 模式: READ-ONLY\nDo NOT modify any files. Only analyze and report.\n"
    if bundle.step_prompt:
        prompt += f"\n## 当前步骤 Prompt\n{bundle.step_prompt}\n"
```

### 构造阶段级 bundle

- **文件**：`backend/app/modules/agent/context_builder.py`
- **新增**：`build_stage_bundle()` 函数

```python
async def build_stage_bundle(
    session: AsyncSession,
    change_id: UUID,
    stage: str,
    workspace_id: UUID,
    *,
    read_only: bool = False,
    step_prompt: str | None = None,
) -> AgentSpecBundle:
    """构造阶段级 AgentSpecBundle。"""
    # 加载 Change 记录
    # 加载已有文档内容（proposal/design/requirements/tasks/plan）
    # 读取 spec_root 路径
    # 返回完整的 AgentSpecBundle
```

## Phase 3：修正阶段配置

### STAGE_AGENT_CONFIG 补齐

- **文件**：`backend/app/modules/change/dispatch.py`
- **改动**：使用 `StageEnum` 成员值作为键，补齐 archive/quick，修正 read_only

| 阶段 | enabled | requires_worktree | read_only | 说明 |
|------|---------|-------------------|-----------|------|
| scan | True | False | False | 写扫描文档到 .sillyspec/docs/ |
| brainstorm | True | True | False | 写入 change 目录（问题清单/决策记录） |
| propose | True | True | False | 写四件套到 change 目录 |
| plan | True | True | False | 写 plan.md + tasks |
| execute | True | True | False | 写代码，必须 worktree |
| verify | True | True | False | 写 verify-result.md |
| archive | True | True | False | 写 module-impact.md + 移动目录 |
| quick | True | True | False | 写 quicklog + 可能改代码 |

### 键改为 StageEnum 常量

```python
STAGE_AGENT_CONFIG: dict[str, StageAgentConfig] = {
    StageEnum.SCAN.value: StageAgentConfig(...),
    StageEnum.BRAINSTORM.value: StageAgentConfig(...),
    StageEnum.PROPOSE.value: StageAgentConfig(...),
    StageEnum.PLAN.value: StageAgentConfig(...),
    StageEnum.EXECUTE.value: StageAgentConfig(...),
    StageEnum.VERIFY.value: StageAgentConfig(...),
    StageEnum.ARCHIVE.value: StageAgentConfig(...),
    StageEnum.QUICK.value: StageAgentConfig(...),
}
```

## Phase 4：状态同步

### sync_stage_status 逻辑

- **文件**：`backend/app/modules/change/dispatch.py`
- **AgentRun 完成后**：
  1. 读取 `.sillyspec/.runtime/sillyspec.db` 的 `changes` 表
  2. 获取当前 stage、当前 step、completed steps
  3. 同步到 `Change.current_stage` 和 `Change.stages`
  4. 如果当前 stage 还有 pending step → 创建下一个 AgentRun
  5. 如果 stage completed → 记录日志，不自动流转（等待人工确认或配置自动流转）

### 三字段边界

| 字段 | 职责 | 写入方 | 读取方 |
|------|------|--------|--------|
| `Change.status` | Hub 生命周期（active/done/archived） | ChangeService | Hub 内部 |
| `Change.current_stage` | SillySpec 当前阶段投影 | `sync_stage_status()` | Hub UI + 调度 |
| `sillyspec.db` | SillySpec 阶段/步骤唯一事实源 | SillySpec CLI | `sync_stage_status()` |

### 状态同步数据流

```
Agent 执行 sillyspec --done
        |
        v
sillyspec.db 更新 steps 表
        |
        v
AgentRun 完成回调（_execute_stage_run 结束）
        |
        v
SillySpecStageDispatchService.sync_stage_status()
        |
        ├── 读取 sillyspec.db → 获取当前 step 状态
        ├── 更新 Change.current_stage（如果 stage 变化）
        ├── 更新 Change.stages.steps（投影步骤状态）
        ├── 如果有 pending step → dispatch_next_step()
        └── 如果 stage completed → 记录日志
```

### 错误处理

- sillyspec.db 不存在：记录 warning，不中断
- sillyspec.db 读取失败：记录 incident，不静默吞掉
- 步骤状态不一致：记录 warning，以 sillyspec.db 为准

## Phase 5：工作区与 worktree

### 写阶段运行目录策略

| 场景 | 运行目录 | 说明 |
|------|---------|------|
| workspace 有 git identity + 写阶段 | worktree repo | 通过 lease 获取 |
| workspace 无 git identity + 写阶段 | workspace root | 允许本地写入，但审计记录 |
| 只读阶段 | workspace root | 仅分析 |

### 修复只读路径判断

- **文件**：`backend/app/modules/agent/service.py`
- **当前问题**：`change.path` 直接用 `Path(change.path).is_dir()` 判断，未拼 workspace root
- **修正**：`work_dir = Path(workspace_root) / change.path`，然后再判断

### worktree 内 change 目录

- worktree 创建后检查 `.sillyspec/changes/<change_key>/` 是否存在
- 不存在则从主 repo 复制（或触发 sillyspec init）

## Phase 6：API 与前端契约

### 完整链路

```
用户点击流转按钮 → POST /changes/{id}/transition
    → ChangeService.transition_with_dispatch()
        → 1. 验证 TRANSITIONS 权限
        → 2. 更新 Change.current_stage
        → 3. SillySpecStageDispatchService.dispatch_next_step()
        → 4. 返回 { change: ChangeRead, agent_dispatch: DispatchResponse | null }
→ 前端更新 UI + 显示 agent 状态
```

### Response Model

- **文件**：`backend/app/modules/change/router.py`
- **新增 schema**：

```python
class DispatchResponse(BaseModel):
    dispatched: bool
    agent_run_id: str | None = None
    stage: str | None = None
    reason: str | None = None

class TransitionResponse(BaseModel):
    change: dict[str, Any]
    agent_dispatch: DispatchResponse | None = None
```

- **路由返回**：

```python
@router.post(
    "/changes/{change_id}/transition",
    response_model=TransitionResponse,
)
```

### 前端修正

- **文件**：`frontend/src/lib/changes.ts`
- **修正**：`transitionChange()` 返回类型从 `ChangeRead` 改为 `TransitionResponse`

```typescript
export function transitionChange(
  workspaceId: string,
  changeId: string,
  targetStage: string,
  reason?: string,
) {
  return apiFetch<TransitionResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/transition`,
    { method: "POST", json: body },
  );
}

interface TransitionResponse {
  change: ChangeRead;
  agent_dispatch: DispatchResponse | null;
}

interface DispatchResponse {
  dispatched: boolean;
  agent_run_id?: string;
  stage?: string;
  reason?: string;
}
```

### 变更详情页展示

- **文件**：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`
- **新增展示**：
  - 当前 SillySpec stage + 当前 step 名称
  - AgentRun 状态（pending/running/completed/failed）
  - 下一步可执行动作按钮

## Phase 7：测试闭环

### 文件变更清单

| 文件 | 改动类型 | Phase |
|------|---------|-------|
| `backend/app/modules/change/dispatch.py` | 重写 | P1, P3 |
| `backend/app/modules/agent/base.py` | 扩展 | P2 |
| `backend/app/modules/agent/adapters/claude_code.py` | 修改 | P2 |
| `backend/app/modules/agent/context_builder.py` | 新增函数 | P2 |
| `backend/app/modules/agent/service.py` | 修改 | P2, P5 |
| `backend/app/modules/agent/coordinator.py` | 废弃标记 | P1 |
| `backend/app/modules/change/service.py` | 修改 | P1, P4 |
| `backend/app/modules/change/router.py` | 修改 | P6 |
| `backend/app/modules/change/schemas.py` | 新增 | P6 |
| `backend/app/modules/change_writer/router.py` | 修改 | P1 |
| `frontend/src/lib/changes.ts` | 修改 | P6 |
| `frontend/.../changes/[cid]/page.tsx` | 修改 | P6 |
| `backend/tests/modules/change/test_dispatch.py` | 新增 | P7 |
| `backend/tests/modules/agent/test_stage_dispatch.py` | 新增 | P7 |
| `backend/tests/modules/agent/test_stage_adapter.py` | 新增 | P7 |

### 兼容策略

- **brownfield**：`start_sillyspec_run()` 保留但标记 deprecated，不删除方法体
- **AgentSpecBundle**：新增字段全部有默认值，不影响现有 task-level 调用
- **前端**：`TransitionResponse` 新增，不影响其他 API 调用
- **数据库**：无 schema 变更，仅利用现有字段

### 风险登记

| # | 风险 | 可能性 | 影响 | 缓解 |
|---|------|--------|------|------|
| 1 | sillyspec.db 不存在或格式变化 | 中 | 状态同步失败 | fallback：记录 warning，不中断 |
| 2 | worktree 内无 .sillyspec 目录 | 中 | agent 找不到 change 目录 | 启动前检查并复制 |
| 3 | 多次 dispatch 竞争 | 低 | 重复 AgentRun | has_active_run 检查 + 幂等 key |
| 4 | start_sillyspec_run 废弃后旧调用报错 | 低 | change_writer 路径中断 | 迁移到新调度 + 集成测试 |
| 5 | 前端类型变更导致编译失败 | 低 | 部署失败 | TypeScript 编译检查 |
