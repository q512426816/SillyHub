---
id: task-05
title: "解析器迁移 — Scanner 创建独立 Workspace + WorkspaceRelation"
priority: P0
estimated_hours: 4
depends_on: [task-01, task-02]
blocks: [task-07]
author: qinyi
created_at: "2026-05-28 16:25:00"
allowed_paths:
  - backend/app/modules/workspace/scanner.py
  - backend/app/modules/workspace/service.py
  - backend/app/modules/workspace/parser.py
---

# Task-05: 解析器迁移 — Scanner 创建独立 Workspace + WorkspaceRelation

## 概述

将 `backend/app/modules/component/parser.py`（`ComponentParser`）的 YAML 解析能力迁移到 `backend/app/modules/workspace/` 模块下。迁移后，Scanner 在扫描 `.sillyspec/projects/*.yaml` 时，为每个解析出的 component 创建一个独立的 `Workspace` 行（携带 component 元数据字段），并通过 `WorkspaceRelation` 建立有向图关系。

**核心变化：** "一个 Workspace 包含多个 Component" 的旧模型，变为 "每个 Component 就是一个独立 Workspace + WorkspaceRelation 图"。

**设计依据：** `.sillyspec/changes/2026-05-28-component-as-workspace/design.md` ADR-07、ADR-08
**计划依据：** `.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` Wave 3

---

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/workspace/parser.py` | **新增** | 从 `component/parser.py` 迁移过来的 YAML 解析器，重命名为 `WorkspaceParser`，输出 `ParsedWorkspace` + `ParsedRelation` |
| `backend/app/modules/workspace/scanner.py` | **修改** | `WorkspaceScanner.scan()` 扩展返回值，增加 `parsed_workspaces: list[ParsedWorkspace]` 和 `parsed_relations: list[ParsedRelation]`；或者将解析委托给 `WorkspaceParser` |
| `backend/app/modules/workspace/service.py` | **修改** | 新增 `reparse(workspace_id)` 方法：调用 `WorkspaceParser` 解析 YAML，为每个 `ParsedWorkspace` 创建/更新独立 `Workspace` 行，为每个 `ParsedRelation` 创建 `WorkspaceRelation` 行 |

---

## 实现要求

### IR-01: 新增 `backend/app/modules/workspace/parser.py`

将 `component/parser.py` 的 `ComponentParser` 迁移为 `WorkspaceParser`，关键差异：

1. **类名**：`ComponentParser` → `WorkspaceParser`
2. **数据类**：`ParsedComponent` → `ParsedWorkspace`（字段完全一致，仅类名变更）
3. **`ParseResult`**：字段名 `components` → `workspaces`，类型变为 `list[ParsedWorkspace]`
4. **其余不变**：`ParsedRelation`、`ParseIssue`、`ALLOWED_RELATION_TYPES`、`KNOWN_COMPONENT_KEYS` 全部保留
5. **解析逻辑不变**：仍然扫描 `.sillyspec/projects/*.yaml`，仍然做 duplicate_id / missing_id / yaml_error 等边界检查
6. **模块文档**：docstring 更新为 "YAML → ParsedWorkspace parser"，移除对 component/ProjectComponent 的引用

### IR-02: 修改 `backend/app/modules/workspace/scanner.py`

在 `ScanResult` 中新增字段，承载解析结果：

```python
@dataclass(slots=True)
class ScanResult:
    root_path: str
    sillyspec_path: str
    is_sillyspec: bool
    sillyspec_strategy_hint: str = "platform-managed"
    structure: WorkspaceStructure = field(default_factory=WorkspaceStructure)
    warnings: list[str] = field(default_factory=list)
    # --- 新增 ---
    parsed_workspaces: list[ParsedWorkspace] = field(default_factory=list)
    parsed_relations: list[ParsedRelation] = field(default_factory=list)
    parse_warnings: list[ParseIssue] = field(default_factory=list)
    parse_errors: list[ParseIssue] = field(default_factory=list)
```

`WorkspaceScanner.scan()` 内部调用 `WorkspaceParser().parse(root)` 填充上述字段。解析失败不阻塞扫描结果返回，错误记录到 `parse_errors`。

### IR-03: 修改 `backend/app/modules/workspace/service.py` — 新增 `reparse()`

新增方法，签名为：

```python
async def reparse(
    self,
    workspace_id: uuid.UUID,
) -> tuple[ParseResult, dict[str, int], list[Workspace], list[WorkspaceRelation]]:
```

**完整流程：**

1. 调用 `self.get(workspace_id)` 验证父 Workspace 存在且 `status == "active"`
2. 确定解析根目录：
   - 查询 `SpecWorkspace`，若 `strategy != "repo-native"` 则用 `spec_ws.spec_root`
   - 否则用 `_rewrite_path(workspace.root_path)`
3. 调用 `WorkspaceParser().parse(root_path)` 获得 `ParseResult`
4. 对 `path_missing` 的 ParsedWorkspace，用代码仓库根路径重新校验（复用 component/service.py 的逻辑）
5. 查询现有子 Workspace：`SELECT * FROM workspaces WHERE root_path LIKE parent_root_path || '%' AND deleted_at IS NULL`，或者按 `source_yaml_path` 匹配
6. 对每个 `ParsedWorkspace`，执行 UPSERT：
   - **已存在**（按 `source_yaml_path` 匹配）：更新 component 元数据字段
   - **不存在**：创建新 Workspace 行
7. 对解析结果中已消失的子 Workspace，执行软删除（设 `deleted_at`、`status='deleted'`）
8. 删除该父 Workspace 下所有旧的 `WorkspaceRelation`（出边 + 入边涉及的子 Workspace）
9. 根据 `ParseResult.parsed_relations`，查找对应的子 Workspace UUID，创建新的 `WorkspaceRelation` 行
10. `commit()`，返回统计信息

---

## 接口定义

### 接口 1: `WorkspaceParser`

```python
class WorkspaceParser:
    """解析 .sillyspec/projects/*.yaml，输出 ParsedWorkspace + ParsedRelation。"""

    def __init__(self, *, projects_subdir: str = ".sillyspec/projects") -> None:
        """可配置 projects 子目录路径，默认 .sillyspec/projects。"""

    def parse(self, workspace_root: str | Path) -> ParseResult:
        """解析 workspace_root 下所有 YAML 文件。

        Args:
            workspace_root: 工作区根目录的绝对路径。

        Returns:
            ParseResult，包含 workspaces、relations、warnings、errors。

        副作用: 无。纯函数，不读写 DB。
        """
```

### 接口 2: `ParsedWorkspace` 数据类

```python
@dataclass(slots=True)
class ParsedWorkspace:
    component_key: str       # 组件唯一标识，来自 YAML id 字段或 name/filename fallback
    name: str                # 显示名称
    type: str | None         # service / library / frontend 等
    role: str | None         # 功能角色
    path: str | None         # 相对于 workspace_root 的子目录路径
    repo_url: str | None     # 源码仓库 URL
    default_branch: str | None  # 默认分支
    tech_stack: list[str]    # 技术栈标签列表
    build_command: str | None   # 构建命令
    test_command: str | None    # 测试命令
    source_yaml_path: str    # 来源 YAML 文件相对路径
    status: str              # "active" | "path_missing"
    extra: dict[str, Any]    # YAML 中非标准字段的透传
```

### 接口 3: `ParsedRelation` 数据类（不变）

```python
@dataclass(slots=True)
class ParsedRelation:
    source_key: str          # 源 workspace 的 component_key
    target_key: str          # 目标 workspace 的 component_key
    relation_type: str       # depends_on / consumes_api_from / tests / publishes_to / documents
    description: str | None = None
```

### 接口 4: `ParseResult` 数据类

```python
@dataclass(slots=True)
class ParseResult:
    workspaces: list[ParsedWorkspace] = field(default_factory=list)
    relations: list[ParsedRelation] = field(default_factory=list)
    warnings: list[ParseIssue] = field(default_factory=list)
    errors: list[ParseIssue] = field(default_factory=list)
```

### 接口 5: `ParseIssue` 数据类（不变）

```python
@dataclass(slots=True)
class ParseIssue:
    code: str        # missing_id / duplicate_id / yaml_error / unknown_relation_target / invalid_relation / self_relation / unknown_relation_type / yaml_not_mapping
    file: str | None
    detail: str
    severity: str    # "warning" | "error"
```

### 接口 6: `WorkspaceService.reparse()`

```python
async def reparse(
    self,
    workspace_id: uuid.UUID,
) -> tuple[ParseResult, dict[str, int], list[Workspace], list[WorkspaceRelation]]:
    """解析父 Workspace 下的 projects/*.yaml，为每个组件创建独立子 Workspace + WorkspaceRelation。

    Args:
        workspace_id: 父 Workspace 的 UUID。

    Returns:
        - ParseResult: 原始解析结果（含 warnings/errors）
        - stats: {"parsed": int, "created": int, "updated": int, "deleted": int,
                  "relations_created": int, "relations_deleted": int}
        - list[Workspace]: 当前所有子 Workspace（含新建 + 更新）
        - list[WorkspaceRelation]: 当前所有 WorkspaceRelation

    Raises:
        WorkspaceNotFound: workspace_id 不存在或已软删除

    Side effects:
        - 创建/更新/软删除 Workspace 行
        - 删除旧 WorkspaceRelation 行，创建新 WorkspaceRelation 行
        - COMMIT transaction
    """
```

### 接口 7: `ScanResult` 扩展字段

```python
# ScanResult 新增字段（向后兼容，默认空列表）
parsed_workspaces: list[ParsedWorkspace] = field(default_factory=list)
parsed_relations: list[ParsedRelation] = field(default_factory=list)
parse_warnings: list[ParseIssue] = field(default_factory=list)
parse_errors: list[ParseIssue] = field(default_factory=list)
```

### 接口 8: 子 Workspace 的 `root_path` 构造规则

```python
def _build_child_root_path(parent_root: str, parsed: ParsedWorkspace) -> str:
    """子 Workspace 的 root_path 构造规则。

    1. 若 parsed.path 不为 None 且不为空：
       child_root = os.path.join(parent_root, parsed.path)
    2. 若 parsed.path 为 None：
       child_root = parent_root  # 共享根目录（如 library 可能没有独立子目录）

    返回: str，归一化后的路径
    """
```

### 接口 9: 子 Workspace UPSERT 匹配键

```python
async def _find_existing_child(
    self,
    parent_workspace: Workspace,
    parsed: ParsedWorkspace,
) -> Workspace | None:
    """查找与 ParsedWorkspace 匹配的现有子 Workspace。

    匹配规则（按优先级）：
    1. source_yaml_path 精确匹配
    2. component_key 匹配（在 parent_workspace 的子 Workspace 范围内）

    Args:
        parent_workspace: 父 Workspace
        parsed: 解析出的 ParsedWorkspace

    Returns:
        匹配到的 Workspace 或 None
    """
```

---

## 边界处理

### E-01: YAML 文件不存在或目录为空

`.sillyspec/projects/` 目录不存在或为空时，`reparse()` 正常返回空结果，不报错。`ParseResult.warnings` 包含 `missing_projects_dir` 或空列表。stats 全部为 0。

### E-02: YAML 解析错误（语法错误 / 非 mapping / 编码错误）

单个 YAML 文件解析失败时，跳过该文件，将错误记录到 `ParseResult.errors`（code=`yaml_error` 或 `yaml_not_mapping`）。不影响其他文件的解析。`reparse()` 仍然处理成功解析的 workspaces。

### E-03: component_key 重复或缺失

- **缺失**：`id` 字段不存在时，fallback 到 `name` 或 filename stem，记录 `missing_id` warning。若均无可用值，跳过该文件。
- **重复**：同一 `id` 在多个文件中出现时，保留第一个，后续的记录 `duplicate_id` warning 并跳过。不覆盖已有数据。

### E-04: 子 Workspace 的 root_path 指向不存在的目录

`ParsedWorkspace.status = "path_missing"` 时不跳过，仍然创建 Workspace 行，但将 `status` 字段设为 `"active"`（因为 Workspace 模型的 status 是 active/archived/deleted，不含 path_missing）。`path_missing` 信息通过 `ParseResult.warnings` 透传给调用方。在 `reparse()` 的 path 重新校验步骤中，对 `path_missing` 的 parsed_workspace 用代码仓库根路径重新 resolve，若存在则修正为 `"active"`。

### E-05: ParsedRelation 的 target_key 在当前解析结果中不存在

`WorkspaceParser._collect_relation()` 中 `target not in seen_keys` 时，记录 `unknown_relation_target` warning，丢弃该 relation。不创建 `WorkspaceRelation` 行。`reparse()` 不受影响。

### E-06: 同一对 (source_id, target_id, relation_type) 的重复

`WorkspaceRelation` 表有 UQ 约束 `(source_id, target_id, relation_type)`。`reparse()` 采用先删后建策略（drop all → rebuild），因此不会触发 UQ 冲突。但需在构建时做内存级去重（`seen: set[tuple[UUID, UUID, str]]`），防止同一批次内重复。

### E-07: 自环关系（source_id == target_id）

`WorkspaceParser` 已在 `_collect_relation()` 中检查 `target == source_key` 并丢弃，记录 `self_relation` warning。数据库层 CHECK 约束 `source_id != target_id` 作为二级防护。`reparse()` 不会创建自环 WorkspaceRelation。

### E-08: 父 Workspace 被软删除后调用 reparse

`reparse()` 开头调用 `self.get(workspace_id)`，该方法在 `deleted_at is not None` 时抛出 `WorkspaceNotFound`。因此软删除的 Workspace 无法触发 reparse，符合预期。

---

## 非目标

- **不修改 Workspace 模型字段**：task-01 已完成 Workspace 吸收 component 元数据字段，本任务假定这些字段已存在（component_key, tech_stack, build_command, test_command, role, repo_url, default_branch, source_yaml_path）
- **不修改 WorkspaceRelation 模型**：task-02 已完成 WorkspaceRelation 的 CRUD 模块，本任务只消费其 create/delete 能力
- **不删除 component 模块**：task-06 负责删除，本任务只做迁移（新增 workspace/parser.py），不删除 component/parser.py
- **不修改前端**：本任务只涉及后端解析器和服务的迁移
- **不修改 router 端点**：本任务不新增/修改 HTTP 端点，router 的 reparse 端点由 task-04 单独处理
- **不修改 Alembic 迁移**：数据库 schema 变更由 task-01 完成

---

## 参考

| 文档/代码 | 路径 | 用途 |
|---|---|---|
| 设计文档 | `.sillyspec/changes/2026-05-28-component-as-workspace/design.md` | ADR-07（Workspace 唯一单元）、ADR-08（有向图） |
| 计划文档 | `.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` | Wave 3、task-04 定义 |
| 现有解析器（迁移源） | `backend/app/modules/component/parser.py` | `ComponentParser` 完整实现，迁移为 `WorkspaceParser` |
| 现有组件服务（迁移源） | `backend/app/modules/component/service.py` | `ComponentService.reparse()` 的 UPSERT + 关系重建逻辑 |
| Workspace 扫描器 | `backend/app/modules/workspace/scanner.py` | 扩展 `ScanResult`，集成解析结果 |
| Workspace 服务 | `backend/app/modules/workspace/service.py` | 新增 `reparse()` 方法 |
| Workspace 模型 | `backend/app/modules/workspace/model.py` | 假定 task-01 已添加 component 元数据字段 |
| WorkspaceRelation 服务 | `backend/app/modules/workspace/relation_service.py`（task-02 产出） | reparse 中创建/删除 relation 行 |

---

## TDD 步骤

### Step 1: 为 `WorkspaceParser` 编写单元测试

**文件:** `backend/app/modules/workspace/tests/test_parser.py`

1. **测试正常解析**：创建临时目录 + `.sillyspec/projects/` + 两个 YAML 文件（含合法 component 定义 + relations），断言 `ParseResult.workspaces` 长度为 2，`relations` 长度为 1，`warnings` 和 `errors` 为空
2. **测试 missing_id fallback**：YAML 文件不含 `id` 字段但有 `name` 字段，断言 `component_key` 使用 `name` 值，`warnings` 包含 `missing_id`
3. **测试 duplicate_id**：两个 YAML 文件使用相同 `id`，断言第二个被跳过，`warnings` 包含 `duplicate_id`
4. **测试 yaml_error**：放一个非法 YAML 文件，断言 `errors` 包含 `yaml_error`，其他合法文件正常解析
5. **测试 unknown_relation_target**：relation 引用不存在的 target，断言 `warnings` 包含 `unknown_relation_target`，该 relation 不在结果中
6. **测试 self_relation**：relation 的 target 等于 source，断言 `warnings` 包含 `self_relation`
7. **测试 projects 目录不存在**：断言返回空结果，`warnings` 包含 `missing_projects_dir`
8. **测试 path_missing**：parsed.path 指向不存在的目录，断言 `status == "path_missing"`
9. **测试 unknown_relation_type**：relation_type 不在 ALLOWED_RELATION_TYPES 中，断言 `warnings` 包含 `unknown_relation_type`

### Step 2: 为 `ScanResult` 扩展编写测试

**文件:** `backend/app/modules/workspace/tests/test_scanner.py`（追加）

1. **测试 ScanResult 默认空列表**：构造空 `ScanResult`，断言 `parsed_workspaces`、`parsed_relations`、`parse_warnings`、`parse_errors` 均为空列表
2. **测试 WorkspaceScanner.scan() 填充解析结果**：创建含 `.sillyspec/projects/*.yaml` 的临时目录，调用 `scan()`，断言 `parsed_workspaces` 非空

### Step 3: 为 `WorkspaceService.reparse()` 编写集成测试

**文件:** `backend/app/modules/workspace/tests/test_service.py`（追加）

1. **测试正常 reparse**：创建父 Workspace + `.sillyspec/projects/` 含 2 个 YAML 文件，调用 `reparse()`，断言创建了 2 个子 Workspace 行 + 1 条 WorkspaceRelation，stats 正确
2. **测试 reparse 更新已有子 Workspace**：先 reparse 一次，修改 YAML 内容，再次 reparse，断言子 Workspace 元数据已更新而非重复创建
3. **测试 reparse 软删除消失的组件**：先 reparse 出 3 个子 Workspace，删除 1 个 YAML 文件后再次 reparse，断言消失的子 Workspace 被软删除
4. **测试 reparse 空目录**：`.sillyspec/projects/` 为空，断言返回空结果，无报错
5. **测试 reparse 不存在的 workspace_id**：传入随机 UUID，断言抛出 `WorkspaceNotFound`
6. **测试 reparse 对软删除父 Workspace**：先软删除父 Workspace，调用 reparse，断言抛出 `WorkspaceNotFound`
7. **测试 path_missing 修正**：parsed.path 指向不存在的目录，但代码仓库根目录下该路径存在，断言 status 被修正为 "active"

### Step 4: 实现代码，逐个让测试通过

按 Step 1 → Step 2 → Step 3 的顺序实现代码。每实现一个功能点，运行对应测试确认通过。

```bash
# 运行 parser 测试
pytest backend/app/modules/workspace/tests/test_parser.py -v

# 运行 scanner 测试
pytest backend/app/modules/workspace/tests/test_scanner.py -v

# 运行 service reparse 测试
pytest backend/app/modules/workspace/tests/test_service.py::test_reparse -v

# 运行全部 workspace 测试
pytest backend/app/modules/workspace/tests/ -v
```

---

## 验收标准

| 编号 | 验收条件 | 验证方式 | 优先级 |
|---|---|---|---|
| AC-01 | `backend/app/modules/workspace/parser.py` 文件存在，包含 `WorkspaceParser` 类，可独立导入使用 | `from app.modules.workspace.parser import WorkspaceParser, ParseResult, ParsedWorkspace, ParsedRelation, ParseIssue` 不报错 | P0 |
| AC-02 | `WorkspaceParser().parse()` 对合法 YAML 文件输出正确的 `ParseResult`，`workspaces` 字段包含所有解析出的 ParsedWorkspace | 单元测试：2 个 YAML 文件 → `len(result.workspaces) == 2`，字段值与 YAML 一致 | P0 |
| AC-03 | `WorkspaceParser` 的所有边界处理（missing_id / duplicate_id / yaml_error / unknown_relation_target / self_relation / missing_projects_dir / path_missing / unknown_relation_type）行为与原 `ComponentParser` 完全一致 | 单元测试覆盖全部 8 种边界 case，断言 warnings/errors 的 code 和 count | P0 |
| AC-04 | `ScanResult` 新增 `parsed_workspaces`、`parsed_relations`、`parse_warnings`、`parse_errors` 四个字段，默认值为空列表，不破坏现有 `WorkspaceScanner.scan()` 的调用方 | 现有 scanner 测试全部通过；新测试验证字段存在和默认值 | P0 |
| AC-05 | `WorkspaceService.reparse()` 能正确创建子 Workspace 行，所有 component 元数据字段（component_key, type, role, repo_url, default_branch, tech_stack, build_command, test_command, source_yaml_path）从 `ParsedWorkspace` 正确写入 | 集成测试：reparse 后查询 DB，断言字段值与 YAML 内容一致 | P0 |
| AC-06 | `WorkspaceService.reparse()` 能正确创建 `WorkspaceRelation` 行，source_id 和 target_id 指向正确的子 Workspace UUID，relation_type 与 YAML 中定义一致 | 集成测试：reparse 后查询 workspace_relations 表，断言 relation 数量和字段 | P0 |
| AC-07 | `WorkspaceService.reparse()` 的 UPSERT 逻辑：已存在的子 Workspace（按 source_yaml_path 或 component_key 匹配）被更新而非重复创建 | 集成测试：连续两次 reparse，第二次 `stats["created"] == 0`，`stats["updated"] > 0` | P0 |
| AC-08 | `WorkspaceService.reparse()` 对 YAML 中消失的组件，将其对应的子 Workspace 软删除（设 `deleted_at` 和 `status='deleted'`） | 集成测试：删除 1 个 YAML 后 reparse，断言子 Workspace 的 `deleted_at is not None` | P0 |
| AC-09 | `WorkspaceService.reparse()` 在父 Workspace 不存在或已软删除时抛出 `WorkspaceNotFound` | 集成测试：随机 UUID 和已软删除的 workspace_id 均抛异常 | P0 |
| AC-10 | 子 Workspace 的 `root_path` 构造正确：`parsed.path` 存在时为 `os.path.join(parent_root, parsed.path)`，不存在时等于 `parent_root` | 集成测试：断言 `child_ws.root_path` 值正确 | P0 |
| AC-11 | 所有测试通过：`pytest backend/app/modules/workspace/tests/ -v` 全绿 | CI / 本地运行 | P0 |
| AC-12 | `WorkspaceParser` 是纯函数模块，不导入任何 DB 或 FastAPI 相关依赖 | `grep -E "(sqlalchemy|sqlmodel|fastapi)" backend/app/modules/workspace/parser.py` 返回空 | P1 |
| AC-13 | `WorkspaceParser` 的 `ParseResult` 字段名从 `components` 改为 `workspaces`，所有引用处已更新 | 全局搜索 `result.components` 在 workspace 模块内无匹配 | P1 |
