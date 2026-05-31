# Change 2: workflow-state-unification

## 目标

将 Hub 内部三套互相矛盾的状态机统一为一套，对齐 SillySpec 的阶段定义。

## 背景

当前 Hub 存在三套状态机：

1. **StageEnum**（`backend/app/modules/change/model.py`）— 10 阶段：
   `draft → clarifying → design_review → ready_for_dev → in_dev → technical_verification → business_review → rework_required → accepted → archived`
   
2. **WorkflowFSM**（`backend/app/modules/workflow/fsm.py`）— 8 阶段：
   `draft → proposed → reviewed → approved → in_progress → completed → merged` (+ rejected)

3. **SillySpec** — 9 阶段：
   `scan → brainstorm → propose → plan → execute → verify → archive` + `quick`

三套互相矛盾，Hub 写入的阶段名 CLI 不认识，CLI 写入的阶段名 Hub 不认识。

## 设计决策

**统一后的阶段定义**：以 SillySpec 为主线，保留 Hub 的业务扩展。

SillySpec 主阶段（由 CLI 管理，Hub 只读或只做简单转发）：
- `scan` / `brainstorm` / `propose` / `plan` / `execute` / `verify` / `archive` / `quick`

Hub 业务扩展阶段（Hub 平台内部使用）：
- `draft` — 变更创建后的初始状态（用户通过平台创建，尚未进入 CLI 流程）
- `rework_required` — verify 不通过，需要返工
- `accepted` — 归档前的人工确认

**关系**：
- Hub `draft` → 用户在平台创建变更 → 进入 CLI 后变成 `propose`/`execute` 等
- CLI `verify` → FAIL → Hub 设为 `rework_required` → 返回 `execute`
- CLI `archive` 前需要 Hub 侧 `accepted` 确认

## 具体任务

### T1: 重构 StageEnum

文件：`backend/app/modules/change/model.py`

修改 StageEnum 为新值：

```python
class StageEnum(str, Enum):
    # SillySpec 主阶段
    SCAN = "scan"
    BRAINSTORM = "brainstorm"
    PROPOSE = "propose"
    PLAN = "plan"
    EXECUTE = "execute"
    VERIFY = "verify"
    ARCHIVE = "archive"
    QUICK = "quick"
    
    # Hub 业务扩展
    DRAFT = "draft"
    REWORK_REQUIRED = "rework_required"
    ACCEPTED = "accepted"
    
    @classmethod
    def spec_stages(cls): ...
    @classmethod
    def hub_stages(cls): ...
    @classmethod
    def all_stages(cls): ...
```

### T2: 重构 TRANSITIONS 流转规则

文件：`backend/app/modules/change_workflow.py`（或其中的 service.py）

对齐新的阶段定义，重写 TRANSITIONS 字典。admin 角色绕过所有角色检查（保留现有逻辑）。

### T3: 废弃 WorkflowFSM

文件：`backend/app/modules/workflow/fsm.py`

1. grep 全代码库确认 ChangeFSM 的所有引用
2. 如果有引用，改为使用新的 TRANSITIONS
3. 如果无引用或可安全移除，标记为 deprecated 或删除
4. 对应的 tests 也清理

### T4: DB Migration

新建 Alembic 迁移：

旧值 → 新值映射：
- `clarifying` → `propose`
- `design_review` → `propose`
- `ready_for_dev` → `plan`
- `in_dev` → `execute`
- `technical_verification` → `verify`
- `business_review` → `verify`
- 旧的 `archived` → `accepted`（真正的 archived 是新阶段，但注意不要和已存在的 accepted 冲突）
- `draft` 保持不变

迁移要幂等（可重复执行不报错）。

### T5: 前端适配

修改：
1. 阶段展示从旧 10 阶段改为新 11 阶段
2. 流转按钮的 target 选项对齐新 TRANSITIONS
3. 进度条显示 SillySpec 主线阶段 + Hub 扩展阶段
4. 归档流程改为 `verify → archive → accepted → archived`（原来是一步）

### T6: 后端测试更新

修改涉及阶段的所有测试用例，使用新的 StageEnum 值和 TRANSITIONS。

## 重要注意事项

1. **变更 1 已 merge**：当前 main 已包含 SpecPathResolver 和 file-lifecycle 对齐代码，可以直接使用
2. **admin 绕过逻辑保留**：service 层 `if role == "admin": return True` 不动
3. **InvalidTransition 异常保留**：不要退回 ValueError
4. **前端 build 需要回主目录**：worktree 里没有 node_modules
5. **测试只跑 change 和 workflow 相关的**，不需要全量跑

## 验证标准

- [ ] StageEnum 包含 SillySpec 8 主阶段 + Hub 3 扩展阶段
- [ ] TRANSITIONS 覆盖所有合理流转
- [ ] admin 角色绕过所有角色检查
- [ ] 旧数据通过 DB migration 正确映射
- [ ] WorkflowFSM 不再被引用（或已废弃）
- [ ] 前端能正确显示新阶段和流转按钮
- [ ] 相关测试通过
