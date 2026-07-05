---
id: task-02
title: 扩展 AgentSpecBundle 添加 stage_dispatch 字段
author: qinyi
created_at: 2026-06-01 06:54:21
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-04, task-05, task-06]
allowed_paths:
  - backend/app/modules/agent/base.py
---

# task-02: 扩展 AgentSpecBundle 添加 stage_dispatch 字段

## 修改文件（必填）
- `backend/app/modules/agent/base.py` — 在 `AgentSpecBundle` dataclass 中新增 6 个字段

## 实现要求

在 `backend/app/modules/agent/base.py` 的 `AgentSpecBundle` dataclass 中，在 `# --- Cross-workspace context (runtime-only) ---` 区域之后，新增一个 `# --- Stage dispatch extension ---` 区域，包含以下 6 个字段（全部有默认值）：

```python
@dataclass
class AgentSpecBundle:
    """Complete specification package consumed by Agent adapters.

    This is the primary data structure that the context builder produces
    and that adapters consume.  It bundles together all spec documents,
    constraints, profile metadata, and platform extensions needed for a
    single agent run.
    """

    # --- Core context ---
    change_summary: str  # change title (+ description when available)
    task_key: str
    task_title: str

    # --- Spec documents (full content, not just paths) ---
    proposal: str | None = None
    requirements: str | None = None
    design: str | None = None
    plan: str | None = None
    task_markdown: str | None = None

    # --- Constraints ---
    allowed_paths: list[str] = field(default_factory=list)
    denied_paths: list[str] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)

    # --- Profile metadata ---
    profile_version: str | None = None
    spec_strategy: str | None = None
    profile_gates: list[dict[str, Any]] = field(default_factory=list)

    # --- Platform extensions ---
    available_tools: list[str] = field(default_factory=lambda: ["sillyspec"])
    platform_metadata: dict[str, Any] = field(default_factory=dict)

    # --- Cross-workspace context (runtime-only) ---
    referenced_workspaces: list[WorkspaceSpecSummary] = field(default_factory=list)

    # --- Stage dispatch extension ---
    stage_dispatch: bool = False              # True 表示这是阶段级调度（非 task-level）
    change_key: str | None = None             # 变更 key（如 "agent-stage-dispatch"）
    stage: str | None = None                  # 目标 SillySpec 阶段（如 "propose"）
    spec_root: str | None = None              # .sillyspec/ 根目录路径
    step_prompt: str | None = None            # SillySpec CLI 当前 step 输出的 prompt
    read_only: bool = False                   # 是否只读模式（只分析不改文件）
```

### 具体修改步骤

1. 打开 `backend/app/modules/agent/base.py`
2. 定位到 `AgentSpecBundle` 类（约第 53 行）
3. 找到 `referenced_workspaces: list[WorkspaceSpecSummary] = field(default_factory=list)` 这一行（约第 89 行）
4. 在该行之后，添加注释 `# --- Stage dispatch extension ---`
5. 在注释之后，添加上述 6 个新字段
6. 不修改其他任何代码

### 确保不破坏现有调用

所有 6 个新字段都有默认值（`False`、`None`、`False`），因此：

- `service.py:695` 的 `AgentSpecBundle(change_summary=..., task_key=..., task_title=...)` 调用不需要修改
- `context_builder.py:280` 的 `AgentSpecBundle(...)` 调用不需要修改
- `bootstrap.py:152` 的 `AgentSpecBundle(...)` 调用不需要修改
- 测试文件中所有 `AgentSpecBundle(...)` 构造不需要修改
- `coordinator.py` 中 `compute_fingerprint(bundle)` 不受影响

## 接口定义（代码类任务必填）

完整的 `AgentSpecBundle` dataclass 如上"实现要求"部分所示。

新增字段说明：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `stage_dispatch` | `bool` | `False` | 标识是否为阶段级调度。`True` 时 adapter 生成 sillyspec 阶段命令 prompt |
| `change_key` | `str \| None` | `None` | 变更 key，对应 `.sillyspec/changes/<change_key>/` 目录名 |
| `stage` | `str \| None` | `None` | 目标 SillySpec 阶段名称，如 `scan`/`brainstorm`/`propose`/`plan`/`execute`/`verify`/`archive`/`quick` |
| `spec_root` | `str \| None` | `None` | `.sillyspec/` 根目录的绝对路径，agent 可据此定位 change 目录 |
| `step_prompt` | `str \| None` | `None` | SillySpec CLI 当前 step 输出的 prompt 内容，agent 据此执行具体工作 |
| `read_only` | `bool` | `False` | 只读模式标志。`True` 时 agent 只分析不改文件 |

## 边界处理（必填，至少5条）

1. **null/空值行为**：新字段全部为 `None`/`False` 时，等同于非 stage dispatch 模式。adapter 的 `run_with_bundle()` 检查 `bundle.stage_dispatch` 为 `False` 时不走阶段 prompt 生成逻辑，行为与修改前完全一致。
2. **兼容旧行为**：现有所有 `AgentSpecBundle(...)` 构造点（`service.py:695`、`context_builder.py:280`、`bootstrap.py:152`、测试文件约 15 处）均不传这些字段，Python dataclass 默认值机制保证无需任何修改即可正常工作。
3. **异常不静默吞掉**：如果后续代码设置 `stage_dispatch=True` 但 `change_key` 为 `None`，`validate_bundle()` 的未来扩展应返回 violation（本任务不修改 `validate_bundle`，由 task-06 负责）。
4. **不修改传入参数**：新字段是 dataclass 实例属性，不会修改传入的参数引用。
5. **歧义/冲突场景**：当 `stage_dispatch=False` 时，即使 `change_key`/`stage` 等字段被设置，adapter 也应忽略这些 stage 字段（adapter 逻辑由 task-06 实现，本任务只负责数据结构）。
6. **类型安全**：`stage_dispatch` 和 `read_only` 用 `bool` 而非 `str`，避免 truthy/falsy 歧义（如 `"false"` 是 truthy）。

## 非目标

- **不修改** `AgentService` 的调用逻辑（task-04 负责）
- **不修改** adapter 的渲染/执行逻辑（task-06 负责）
- **不修改** `validate_bundle()` 方法（task-06 负责）
- **不修改** `render_bundle_to_claude_md()` 函数（task-06 负责）
- **不修改** `context_builder.py` 的 `build_spec_bundle()` 函数（task-05 负责）
- **不添加**新的 dataclass 或新文件
- **不修改**数据库 schema

## 参考

- `design.md` Phase 2 "扩展 AgentSpecBundle" 章节（第 123-139 行）
- `plan.md` task-02 定义（第 78 行）
- `requirements.md` FR-05 "AgentSpecBundle 含阶段上下文"（第 69-72 行）
- 现有 `AgentSpecBundle` 源码：`backend/app/modules/agent/base.py` 第 53-89 行

## TDD 步骤

1. **写测试**：在 `backend/tests/modules/agent/test_context_builder.py` 或新建测试文件中，编写以下测试：
   - `test_stage_dispatch_default_false`：构造 `AgentSpecBundle(change_summary="x", task_key="k", task_title="t")` 不传新字段，断言 `stage_dispatch=False`、`change_key=None`、`stage=None`、`spec_root=None`、`step_prompt=None`、`read_only=False`
   - `test_stage_dispatch_fields_set`：构造 `AgentSpecBundle(..., stage_dispatch=True, change_key="my-change", stage="propose", spec_root="/path/.sillyspec", step_prompt="do something", read_only=True)`，断言各字段值正确
   - `test_stage_dispatch_false_ignores_stage_fields`：构造 `AgentSpecBundle(..., stage_dispatch=False, change_key="my-change")`，验证对象可以正常创建（不报错），但字段值仍然被存储（不做运行时忽略，忽略由 adapter 层负责）
2. **确认失败**：运行测试，因字段不存在而 `TypeError` 失败
3. **添加字段**：在 `base.py` 的 `AgentSpecBundle` 中添加 6 个新字段
4. **确认通过**：运行测试，全部通过
5. **验证旧代码不受影响**：运行 `pytest backend/tests/modules/agent/` 全量测试，确保无 breaking change

### 测试代码参考

```python
"""Tests for AgentSpecBundle stage_dispatch extension."""

from app.modules.agent.base import AgentSpecBundle


def test_stage_dispatch_default_values():
    """AgentSpecBundle 不传 stage 字段时，全部使用默认值。"""
    bundle = AgentSpecBundle(
        change_summary="test change",
        task_key="task-01",
        task_title="test task",
    )
    assert bundle.stage_dispatch is False
    assert bundle.change_key is None
    assert bundle.stage is None
    assert bundle.spec_root is None
    assert bundle.step_prompt is None
    assert bundle.read_only is False


def test_stage_dispatch_fields_explicitly_set():
    """AgentSpecBundle 传入 stage 字段时，值正确存储。"""
    bundle = AgentSpecBundle(
        change_summary="test change",
        task_key="task-01",
        task_title="test task",
        stage_dispatch=True,
        change_key="agent-stage-dispatch",
        stage="propose",
        spec_root="/workspace/.sillyspec",
        step_prompt="Write a proposal for this change",
        read_only=True,
    )
    assert bundle.stage_dispatch is True
    assert bundle.change_key == "agent-stage-dispatch"
    assert bundle.stage == "propose"
    assert bundle.spec_root == "/workspace/.sillyspec"
    assert bundle.step_prompt == "Write a proposal for this change"
    assert bundle.read_only is True


def test_stage_dispatch_false_with_stage_fields():
    """stage_dispatch=False 但 stage 字段有值时，对象正常创建（忽略由 adapter 层负责）。"""
    bundle = AgentSpecBundle(
        change_summary="test change",
        task_key="task-01",
        task_title="test task",
        stage_dispatch=False,
        change_key="some-change",
        stage="plan",
    )
    assert bundle.stage_dispatch is False
    assert bundle.change_key == "some-change"  # 值被存储，但不生效
    assert bundle.stage == "plan"


def test_existing_bundle_construction_unchanged():
    """现有代码中 AgentSpecBundle 的最小构造方式不受影响。"""
    # 对应 service.py:695 的调用方式
    bundle = AgentSpecBundle(
        change_summary="Change stage: propose",
        task_key="stage:propose",
        task_title="Stage dispatch: propose",
    )
    assert bundle.stage_dispatch is False
    assert bundle.proposal is None
    assert bundle.allowed_paths == []
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | 创建 `AgentSpecBundle` 不传新字段（如 `AgentSpecBundle(change_summary="x", task_key="k", task_title="t")`） | 无报错，`stage_dispatch=False`，其他 5 个新字段均为默认值（`None`/`False`） |
| AC-02 | 创建 `AgentSpecBundle` 传入全部新字段 `stage_dispatch=True, change_key="test", stage="propose", spec_root="/path", step_prompt="prompt", read_only=True` | 所有字段值正确存储，可通过属性访问 |
| AC-03 | 运行 `pytest backend/tests/modules/agent/test_context_builder.py` 全量通过 | 现有 63+ 测试无 breaking change，所有测试通过 |
| AC-04 | 运行 `pytest backend/tests/modules/agent/test_coordinator.py` 全量通过 | coordinator 中的 fingerprint 计算等不受影响 |
| AC-05 | 新增 4 个测试用例全部通过 | 覆盖默认值、显式赋值、False+有值、最小构造四种场景 |
