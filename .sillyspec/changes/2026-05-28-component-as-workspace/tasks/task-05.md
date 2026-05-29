---
author: qinyi
created_at: 2026-05-29T17:40:00+08:00
id: task-05
title: "解析器迁移 — Scanner 创建独立 Workspace + WorkspaceRelation"
priority: P0
estimated_hours: 4
depends_on: [task-01, task-02]
blocks: [task-06, task-08]
allowed_paths:
  - backend/app/modules/workspace/scanner.py
  - backend/app/modules/workspace/service.py
  - backend/app/modules/workspace/parser.py
  - backend/app/modules/workspace/tests/test_scanner.py
  - backend/app/modules/workspace/tests/test_service.py
---

# task-05: 解析器迁移 — Scanner 创建独立 Workspace + WorkspaceRelation

## 修改文件（必填）

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/workspace/scanner.py` | **修改** | `ScanResult` 新增 4 个解析字段；`WorkspaceScanner.scan()` 末尾调用 `WorkspaceParser().parse(root)` 填充这些字段 |
| `backend/app/modules/workspace/service.py` | **修改** | 新增 `reparse()` 方法 + `_build_child_root_path()` + `_find_existing_child()` 两个私有辅助 |
| `backend/app/modules/workspace/tests/test_scanner.py` | **修改** | 新增 2 个测试：默认空列表 + scan 填充解析结果 |
| `backend/app/modules/workspace/tests/test_service.py` | **修改** | 新增 7 个 reparse 集成测试 |

**注意**：`backend/app/modules/workspace/parser.py`（WorkspaceParser）已由前置任务完成，本任务不修改该文件，只消费其输出。

## 实现要求

### IR-01: scanner.py — ScanResult 扩展

在 `ScanResult` dataclass 中新增 4 个字段（已存在骨架，类型为裸 `list`，需改为具体类型注解）：

```python
from app.modules.workspace.parser import ParsedWorkspace, ParsedRelation, ParseIssue

@dataclass(slots=True)
class ScanResult:
    # ... 现有字段保持不变 ...
    parsed_workspaces: list[ParsedWorkspace] = field(default_factory=list)
    parsed_relations: list[ParsedRelation] = field(default_factory=list)
    parse_warnings: list[ParseIssue] = field(default_factory=list)
    parse_errors: list[ParseIssue] = field(default_factory=list)
```

在 `WorkspaceScanner.scan()` 方法的 `return result` 之前，插入解析调用：

```python
# --- task-05: parser integration ---
from app.modules.workspace.parser import WorkspaceParser as _WP

parse_result = _WP().parse(root)
result.parsed_workspaces = parse_result.workspaces
result.parsed_relations = parse_result.relations
result.parse_warnings = parse_result.warnings
result.parse_errors = parse_result.errors
```

解析失败（parse_errors 非空）不阻塞扫描结果返回。即使 `.sillyspec/projects/` 不存在（此时 parsed_workspaces 为空列表），scan 的其余逻辑不受影响。

### IR-02: service.py — 新增 reparse() 方法

在 `WorkspaceService` 类中新增以下方法（完整伪代码见"接口定义"部分）：

1. `reparse(workspace_id: uuid.UUID) -> tuple[ParseResult, dict, list[Workspace], list[WorkspaceRelation]]`
2. `_build_child_root_path(parent_root: str, parsed: ParsedWorkspace) -> str`（静态方法）
3. `_find_existing_child(parent_workspace: Workspace, parsed: ParsedWorkspace) -> Workspace | None`（异步方法）

**reparse() 控制流：**

```
1. 验证父 Workspace
   ws = await self.get(workspace_id)
   # get() 内部已检查 deleted_at，不存在或已软删除则抛 WorkspaceNotFound

2. 确定解析根目录
   root_path = _rewrite_path(ws.root_path)

3. 调用解析器
   parser = WorkspaceParser()
   parse_result = parser.parse(root_path)

4. path_missing 重新校验
   for pw in parse_result.workspaces:
       if pw.status == "path_missing" and pw.path:
           resolved = Path(root_path) / pw.path
           if resolved.exists():
               pw.status = "active"

5. 查询现有子 Workspace（source_yaml_path 在父 root_path 下的所有 Workspace）
   stmt = select(Workspace).where(
       col(Workspace.source_yaml_path).like(root_path.replace("\\", "/") + "%"),
       col(Workspace.deleted_at).is_(None),
   )
   existing_children = {ws.source_yaml_path: ws for ws in (await session.execute(stmt)).scalars().all()}

   备选匹配：按 component_key 匹配
   existing_by_key = {ws.component_key: ws for ws in existing_children.values() if ws.component_key}

6. 遍历 parsed workspaces，UPSERT
   stats = {"parsed": 0, "created": 0, "updated": 0, "deleted": 0, "relations_created": 0, "relations_deleted": 0}
   seen_child_ids: set[UUID] = set()

   for pw in parse_result.workspaces:
       stats["parsed"] += 1
       child_root = self._build_child_root_path(root_path, pw)

       # 查找已有行
       existing = existing_children.get(pw.source_yaml_path) or existing_by_key.get(pw.component_key)

       if existing:
           # UPDATE: 只更新 component 元数据字段
           existing.name = pw.name
           existing.type = pw.type
           existing.role = pw.role
           existing.repo_url = pw.repo_url
           existing.default_branch = pw.default_branch
           existing.tech_stack = pw.tech_stack
           existing.build_command = pw.build_command
           existing.test_command = pw.test_command
           existing.source_yaml_path = pw.source_yaml_path
           existing.component_key = pw.component_key
           existing.root_path = child_root
           existing.updated_at = datetime.utcnow()
           stats["updated"] += 1
           seen_child_ids.add(existing.id)
       else:
           # CREATE
           child = Workspace(
               id=uuid.uuid4(),
               name=pw.name,
               slug=slugify(pw.name) + "-" + pw.component_key[:20],
               root_path=child_root,
               status="active",
               component_key=pw.component_key,
               type=pw.type,
               role=pw.role,
               repo_url=pw.repo_url,
               default_branch=pw.default_branch,
               tech_stack=pw.tech_stack,
               build_command=pw.build_command,
               test_command=pw.test_command,
               source_yaml_path=pw.source_yaml_path,
               created_by=None,
               created_at=datetime.utcnow(),
               updated_at=datetime.utcnow(),
           )
           session.add(child)
           stats["created"] += 1
           seen_child_ids.add(child.id)

   await session.flush()  # 确保 newly created children 拿到 id

7. 软删除已消失的子 Workspace
   for source_path, child in existing_children.items():
       if child.id not in seen_child_ids:
           child.deleted_at = datetime.utcnow()
           child.status = "deleted"
           child.updated_at = datetime.utcnow()
           stats["deleted"] += 1

8. 删除旧 WorkspaceRelation + 创建新 WorkspaceRelation
   # 收集所有子 Workspace 的 component_key -> id 映射
   all_children_stmt = select(Workspace).where(
       col(Workspace.id).in_(seen_child_ids)
   )
   all_children = list((await session.execute(all_children_stmt)).scalars().all())
   key_to_id: dict[str, UUID] = {ws.component_key: ws.id for ws in all_children if ws.component_key}

   # 删除旧的 relation（source_id 或 target_id 在 seen_child_ids 中的）
   # 注意：先 flush 删除，再创建新的
   old_rels_stmt = select(WorkspaceRelation).where(
       col(WorkspaceRelation.source_id).in_(seen_child_ids)
   )
   old_rels = list((await session.execute(old_rels_stmt)).scalars().all())
   for rel in old_rels:
       await session.delete(rel)
       stats["relations_deleted"] += 1

   # 也删除 target 在子 Workspace 中但 source 不是的（因为这是父 workspace 的全部出边）
   old_rels_in_stmt = select(WorkspaceRelation).where(
       col(WorkspaceRelation.target_id).in_(seen_child_ids),
       col(WorkspaceRelation.source_id).in_(seen_child_ids),
   )
   old_rels_in = list((await session.execute(old_rels_in_stmt)).scalars().all())
   for rel in old_rels_in:
       if rel not in old_rels:  # 避免重复删除
           await session.delete(rel)
           stats["relations_deleted"] += 1

   # 创建新 relation，做内存级去重
   seen_edges: set[tuple[UUID, UUID, str]] = set()
   for pr in parse_result.relations:
       src_id = key_to_id.get(pr.source_key)
       tgt_id = key_to_id.get(pr.target_key)
       if not src_id or not tgt_id:
           continue
       edge = (src_id, tgt_id, pr.relation_type)
       if edge in seen_edges:
           continue
       seen_edges.add(edge)
       rel = WorkspaceRelation(
           id=uuid.uuid4(),
           source_id=src_id,
           target_id=tgt_id,
           relation_type=pr.relation_type,
           description=pr.description,
       )
       session.add(rel)
       stats["relations_created"] += 1

9. commit + 返回
   await session.commit()

   # 重新查询最新的子 Workspace 和 relation
   final_children = list((await session.execute(
       select(Workspace).where(col(Workspace.id).in_(seen_child_ids))
   )).scalars().all())
   final_rels = list((await session.execute(
       select(WorkspaceRelation).where(
           col(WorkspaceRelation.source_id).in_(seen_child_ids)
       )
   )).scalars().all())

   return parse_result, stats, final_children, final_rels
```

## 接口定义（代码类任务必填）

### 接口 1: `WorkspaceService.reparse()`

```python
async def reparse(
    self,
    workspace_id: uuid.UUID,
) -> tuple[ParseResult, dict[str, int], list[Workspace], list[WorkspaceRelation]]:
    """解析父 Workspace 下的 projects/*.yaml，为每个组件创建独立子 Workspace + WorkspaceRelation。

    Args:
        workspace_id: 父 Workspace 的 UUID。

    Returns:
        tuple:
        - ParseResult: 原始解析结果（含 warnings/errors）
        - stats: {"parsed": int, "created": int, "updated": int, "deleted": int,
                  "relations_created": int, "relations_deleted": int}
        - list[Workspace]: 当前所有活跃子 Workspace（含新建 + 更新）
        - list[WorkspaceRelation]: 当前所有子 Workspace 间的 WorkspaceRelation

    Raises:
        WorkspaceNotFound: workspace_id 不存在或已软删除

    Side effects:
        - 创建/更新/软删除 Workspace 行
        - 删除旧 WorkspaceRelation 行，创建新 WorkspaceRelation 行
        - COMMIT transaction
    """
```

### 接口 2: `WorkspaceService._build_child_root_path()`

```python
@staticmethod
def _build_child_root_path(parent_root: str, parsed: ParsedWorkspace) -> str:
    """构造子 Workspace 的 root_path。

    规则：
    1. parsed.path 不为 None 且不为空字符串：
       os.path.join(parent_root, parsed.path) → 归一化
    2. parsed.path 为 None 或空字符串：
       直接使用 parent_root

    返回: str，使用正斜杠归一化后的路径
    """
```

### 接口 3: `WorkspaceService._find_existing_child()`

```python
async def _find_existing_child(
    self,
    parent_root: str,
    parsed: ParsedWorkspace,
) -> Workspace | None:
    """查找与 ParsedWorkspace 匹配的现有活跃子 Workspace。

    匹配规则（按优先级）：
    1. source_yaml_path 精确匹配（WHERE source_yaml_path = parsed.source_yaml_path AND deleted_at IS NULL）
    2. component_key 匹配（WHERE component_key = parsed.component_key AND deleted_at IS NULL AND root_path LIKE parent_root%）

    Args:
        parent_root: 父 Workspace 的 root_path（已 rewrite）
        parsed: 解析出的 ParsedWorkspace

    Returns:
        匹配到的 Workspace 或 None
    """
```

注意：在最终实现中 `_find_existing_child` 的查询可能改为批量预加载所有子 Workspace 后内存匹配（更高效），伪代码中步骤 5-6 展示了这种模式。两种方式均可，但必须覆盖相同的匹配逻辑。

### 接口 4: ScanResult 扩展字段（已有骨架，需补充类型注解）

```python
# 当前 scanner.py 中的定义（需修改类型注解）：
parsed_workspaces: list = field(default_factory=list)          # → list[ParsedWorkspace]
parsed_relations: list = field(default_factory=list)           # → list[ParsedRelation]
parse_warnings: list = field(default_factory=list)             # → list[ParseIssue]
parse_errors: list = field(default_factory=list)               # → list[ParseIssue]
```

### 接口 5: 依赖的已有数据类（不修改，仅供参考）

以下数据类已在 `parser.py` 中定义，reparse 消费其输出：

```python
# ParsedWorkspace 字段：component_key, name, type, role, path, repo_url,
#   default_branch, tech_stack, build_command, test_command, source_yaml_path, status, extra

# ParsedRelation 字段：source_key, target_key, relation_type, description

# ParseResult 字段：workspaces, relations, warnings, errors

# ParseIssue 字段：code, file, detail, severity
```

### 接口 6: 需导入的模块清单（service.py）

```python
import os  # 用于 os.path.join
from app.modules.workspace.parser import WorkspaceParser, ParsedWorkspace, ParsedRelation, ParseResult
from app.modules.workspace.model import WorkspaceRelation
from app.modules.workspace.schema import slugify
```

## 边界处理（必填）

### E-01: projects 目录不存在或为空

`WorkspaceParser().parse()` 已经处理：返回 `ParseResult(warnings=[missing_projects_dir])`, `workspaces=[]`。`reparse()` 无需额外处理，stats 全为 0，不创建/删除任何行。

### E-02: YAML 解析错误不阻塞整体流程

`WorkspaceParser` 对每个文件独立处理，单个文件 yaml_error 只记录到 `ParseResult.errors`，不影响其他文件的解析。`reparse()` 仍然处理成功解析的 `workspaces`，`parse_errors` 透传给调用方。

### E-03: 子 Workspace slug 冲突

reparse 创建新子 Workspace 时，slug 生成规则为 `slugify(pw.name) + "-" + pw.component_key[:20]`。若与现有 active Workspace 的 slug 冲突（IntegrityError），捕获异常并追加 component_key 的哈希后缀或 UUID 前 8 位，确保唯一。不允许 slug 冲突静默失败。

### E-04: parsed.path 为 None 的子 Workspace

`_build_child_root_path()` 在 `parsed.path` 为 None 或空时返回 `parent_root`。这意味着该子 Workspace 与父 Workspace 共享同一个 `root_path`。这是合法的（如 library 可能没有独立子目录）。但 `slug` 必须不同以确保唯一约束。root_path 的唯一索引（`ux_workspaces_root_path_active`）会触发 `WorkspacePathDuplicate` 错误——此时需要将 `root_path` 设为 `parent_root + "#" + component_key` 作为区分，或直接使用 `parent_root` 并允许同一 root_path 下多个 Workspace（通过检查唯一索引行为确定）。

**决策**：由于数据库有 `ux_workspaces_root_path_active` 唯一索引（限制 `deleted_at IS NULL`），同一 `root_path` 下只能有一个 active Workspace。对于 `parsed.path` 为 None 的情况，构造 `root_path = parent_root` 会导致冲突。因此改为：**当 `parsed.path` 为 None 时，`root_path = parent_root + "/" + pw.component_key`**（即使该子目录物理上不存在）。这不影响功能，因为 root_path 只是记录位置信息。

### E-05: UPSERT 匹配不到但有脏数据

若 `_find_existing_child()` 按两种规则都匹配不到（比如 source_yaml_path 和 component_key 都变了），则创建新行。旧行会在步骤 7 的"软删除消失的子 Workspace"中被处理。不会出现孤立行。

### E-06: WorkspaceRelation 的 (source_id, target_id, relation_type) 重复

采用先删后建策略：先删除旧 relation，再创建新的。额外的内存级 `seen_edges` 去重防止同一批次内重复。数据库 UQ 约束作为最终防线，若触发则 rollback 并 raise。

### E-07: 自环关系（source_id == target_id）

`WorkspaceParser` 已在 `_collect_relation()` 中丢弃自环（code=`self_relation`），因此 `parse_result.relations` 中不存在自环。`reparse()` 不做额外检查。数据库 CHECK 约束作为二级防护。

### E-08: 父 Workspace 已软删除

`reparse()` 第一步调用 `self.get(workspace_id)`，该方法在 `deleted_at is not None` 时抛出 `WorkspaceNotFound`。不会对已删除的 Workspace 执行 reparse。

### E-09: slug 长度超限

`slugify()` 返回值最长 100 字符。追加 `"-" + component_key[:20]` 后最长 121 字符，超出 `String(100)` 列限制。需截断：最终 slug = `(slugify(name)[:78] + "-" + component_key[:20])[:100]`。

### E-10: 不修改传入参数

`reparse()` 不得修改传入的 `workspace_id` 参数。`_build_child_root_path()` 是纯函数，不修改 `parsed` 对象。path_missing 重新校验步骤中直接修改 `parse_result` 内部的 `ParsedWorkspace.status` 是允许的（这是内部临时数据）。

## 非目标（本任务不做的事）

- **不修改 WorkspaceParser**：parser.py 已由前置任务完成并测试通过，本任务只消费其 `parse()` 输出
- **不修改 Workspace / WorkspaceRelation 模型**：task-01 已完成模型定义
- **不修改 RelationService**：task-02 已完成 CRUD，reparse 中直接操作 `WorkspaceRelation` model 而非调用 RelationService（因为 reparse 是批量操作，需要先删后建的事务语义）
- **不删除 component 模块**：task-06 负责
- **不修改 router.py**：不新增 HTTP 端点。reparse 端点如需暴露，由后续任务处理
- **不修改前端**：纯后端任务
- **不修改 Alembic 迁移**：数据库 schema 变更由 task-01 完成
- **不引入 SpecWorkspace 查询**：design 中的 SpecWorkspace 策略判断（`strategy != "repo-native"`）在当前阶段不需要，reparse 直接用 `_rewrite_path(ws.root_path)` 作为解析根目录

## 参考

### 已有代码（直接消费）

| 文件 | 类/函数 | 用途 |
|---|---|---|
| `backend/app/modules/workspace/parser.py` | `WorkspaceParser.parse()` | 解析 YAML 返回 `ParseResult` |
| `backend/app/modules/workspace/parser.py` | `ParsedWorkspace`, `ParsedRelation`, `ParseIssue`, `ParseResult` | 数据类定义 |
| `backend/app/modules/workspace/model.py` | `Workspace`, `WorkspaceRelation` | ORM 模型 |
| `backend/app/modules/workspace/schema.py` | `slugify()` | 名称 → slug 转换 |
| `backend/app/modules/workspace/scanner.py` | `ScanResult`, `WorkspaceScanner` | 扫描器，需扩展 |
| `backend/app/modules/workspace/service.py` | `WorkspaceService.get()`, `_rewrite_path()` | 已有方法，reparse 中复用 |
| `backend/app/core/errors.py` | `WorkspaceNotFound` | 异常类型 |
| `backend/conftest.py` | `db_session` fixture | 测试用的 in-memory SQLite session |

### 测试 fixture 模式

现有 `test_service.py` 中的 `_make_workspace()` 辅助函数用于创建临时 SillySpec 目录结构：

```python
def _make_workspace(tmp_path: Path, name: str = "workspace") -> Path:
    base = tmp_path / name / ".sillyspec"
    (base / "projects").mkdir(parents=True)
    (base / "changes" / "change").mkdir(parents=True)
    (base / "changes" / "archive").mkdir(parents=True)
    return tmp_path / name
```

reparse 测试中需要在此基础上向 `projects/` 目录写入 YAML 文件。

## TDD 步骤

### Step 1: 为 ScanResult 扩展编写测试

**文件:** `backend/app/modules/workspace/tests/test_scanner.py`（追加）

1. **test_scan_result_parser_fields_default_empty**：构造 `ScanResult(root_path="/tmp", sillyspec_path="/tmp/.sillyspec", is_sillyspec=False)`，断言 `parsed_workspaces == []`、`parsed_relations == []`、`parse_warnings == []`、`parse_errors == []`
2. **test_scan_fills_parser_fields**：创建含 `.sillyspec/projects/backend.yaml` 的临时目录（YAML 内容 `id: backend\nname: Backend\n`），调用 `WorkspaceScanner().scan(tmp_path)`，断言 `result.parsed_workspaces` 长度为 1、`parsed_workspaces[0].component_key == "backend"`

运行：
```bash
pytest backend/app/modules/workspace/tests/test_scanner.py -v
```

### Step 2: 为 WorkspaceService.reparse() 编写集成测试

**文件:** `backend/app/modules/workspace/tests/test_service.py`（追加）

需要定义辅助函数 `_write_yaml` 和 `_make_workspace_with_projects`：

```python
def _write_yaml(directory: Path, filename: str, content: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    p = directory / filename
    p.write_text(content, encoding="utf-8")
    return p

def _make_workspace_with_projects(tmp_path: Path, name: str = "ws") -> Path:
    """创建含 projects/ 的 SillySpec 目录。"""
    root = _make_workspace(tmp_path, name)
    return root
```

测试用例：

1. **test_reparse_creates_child_workspaces**：创建父 Workspace + 2 个 YAML（backend.yaml + frontend.yaml，含 1 条 relation），调用 `reparse()`，断言：
   - `stats["parsed"] == 2`、`stats["created"] == 2`、`stats["updated"] == 0`
   - `len(children) == 2`，每个 child 的 `component_key`、`type`、`tech_stack` 等字段正确
   - `stats["relations_created"] == 1`，relation 的 source_id/target_id 指向正确的 child UUID

2. **test_reparse_updates_existing_children**：第一次 reparse，修改 YAML 内容（如改 `tech_stack`），第二次 reparse，断言：
   - 第二次 `stats["created"] == 0`、`stats["updated"] == 2`
   - child Workspace 的 tech_stack 已更新

3. **test_reparse_soft_deletes_removed_components**：第一次 reparse 3 个 YAML，删除其中 1 个，第二次 reparse，断言：
   - `stats["deleted"] == 1`
   - 消失的 child Workspace `deleted_at is not None`、`status == "deleted"`

4. **test_reparse_empty_projects_dir**：创建父 Workspace 但 projects/ 为空（只有 .gitkeep），调用 reparse，断言 stats 全部为 0，无报错

5. **test_reparse_unknown_workspace_raises**：传入随机 UUID，断言抛出 `WorkspaceNotFound`

6. **test_reparse_soft_deleted_parent_raises**：先 soft_delete 父 Workspace，再调用 reparse，断言抛出 `WorkspaceNotFound`

7. **test_reparse_path_missing_correction**：YAML 中 path 指向不存在的子目录（`path: nonexistent`），但在 tmp_path 下手动创建该子目录后调用 reparse，断言 child 的 root_path 正确、status 为 "active"

运行：
```bash
pytest backend/app/modules/workspace/tests/test_service.py -v -k reparse
```

### Step 3: 实现代码，逐个让测试通过

按 Step 1 → Step 2 顺序实现。每实现一个功能点运行对应测试。

```bash
# Step 1 完成后
pytest backend/app/modules/workspace/tests/test_scanner.py -v

# Step 2 完成后
pytest backend/app/modules/workspace/tests/test_service.py -v -k reparse

# 全量回归
pytest backend/app/modules/workspace/tests/ -v
```

### Step 4: 回归

确认所有现有测试仍然通过：

```bash
pytest backend/app/modules/workspace/tests/ -v
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 检查 `scanner.py` 的 `ScanResult` 字段类型注解 | `parsed_workspaces: list[ParsedWorkspace]`、`parsed_relations: list[ParsedRelation]`、`parse_warnings: list[ParseIssue]`、`parse_errors: list[ParseIssue]`；默认值为空列表 |
| AC-02 | 检查 `WorkspaceScanner.scan()` 返回值的解析字段 | 当 `.sillyspec/projects/` 含合法 YAML 时，`result.parsed_workspaces` 非空，字段值与 YAML 内容一致 |
| AC-03 | 检查 scan 对无 projects 目录的兼容性 | `.sillyspec/projects/` 不存在时，`result.parsed_workspaces == []`，scan 的其他行为（is_sillyspec、structure）不受影响 |
| AC-04 | `WorkspaceService.reparse()` 创建子 Workspace 行 | reparse 后查询 DB，断言子 Workspace 数量 = YAML 文件数，每个子 Workspace 的 `component_key`、`type`、`role`、`repo_url`、`default_branch`、`tech_stack`、`build_command`、`test_command`、`source_yaml_path` 与 YAML 内容一致 |
| AC-05 | `WorkspaceService.reparse()` 创建 WorkspaceRelation | reparse 后查询 `workspace_relations` 表，断言 relation 数量和 `relation_type` 与 YAML 定义一致；`source_id` 和 `target_id` 分别指向正确的子 Workspace UUID |
| AC-06 | reparse UPSERT：已存在的子 Workspace 被更新 | 连续两次 reparse（第二次 YAML 内容有变更），断言第二次 `stats["created"] == 0`、`stats["updated"] > 0`；子 Workspace 元数据已更新 |
| AC-07 | reparse 软删除消失的子 Workspace | 删除 1 个 YAML 后 reparse，断言消失的子 Workspace `deleted_at is not None`、`status == "deleted"` |
| AC-08 | reparse 对不存在/已删除的父 Workspace 抛异常 | 随机 UUID 和已 soft_delete 的 workspace_id 均抛出 `WorkspaceNotFound` |
| AC-09 | 子 Workspace 的 `root_path` 构造正确 | `parsed.path` 非空时 `root_path` 为 `os.path.join(parent_root, parsed.path)` 归一化后的值；`parsed.path` 为 None 时 `root_path` 包含 `component_key` 作为区分 |
| AC-10 | 子 Workspace 的 `slug` 唯一且不超长 | 所有新建子 Workspace 的 slug 不超过 100 字符，且彼此不重复 |
| AC-11 | 全量测试通过 | `pytest backend/app/modules/workspace/tests/ -v` 全绿，无 skip、无 xfail |
| AC-12 | 现有测试无回归 | `test_scanner.py` 和 `test_service.py` 中的已有测试（非 reparse）全部通过 |
