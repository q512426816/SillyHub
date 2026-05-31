# Change 1: file-lifecycle-alignment

## 目标

将 SillyHub 的文件路径、状态读取、归档逻辑全面对齐 SillySpec v4 layout。

## 背景

SillySpec v4 的主线结构：
- 活跃变更：`.sillyspec/changes/<name>/`
- 归档变更：`.sillyspec/changes/archive/<name>/`
- 状态源：`.sillyspec/.runtime/sillyspec.db`（SQLite）
- 门控状态：`.sillyspec/.runtime/gate-status.json`
- 验证报告：`verify-result.md`（不是 `verification.md`）

Hub 当前大面积偏离这个 layout，导致 CLI 产生的变更 Hub 看不到，Hub 产生的变更 CLI 看不到。

## 具体任务（按优先级）

### T1: 创建 SpecPathResolver

新建 `backend/app/core/spec_paths.py`，统一所有模块的路径获取：

```python
class SpecPathResolver:
    def __init__(self, workspace_root: str): ...
    
    # 变更目录
    def change_dir(self, name: str) -> str:
        """活跃变更目录：.sillyspec/changes/<name>/"""
        return self.root / ".sillyspec" / "changes" / name
    
    def archive_dir(self, name: str) -> str:
        """归档目录：.sillyspec/changes/archive/<name>/"""
        return self.root / ".sillyspec" / "changes" / "archive" / name
    
    def changes_root(self) -> str:
        """变更根目录：.sillyspec/changes/"""
        return self.root / ".sillyspec" / "changes"
    
    # 运行时
    def runtime_dir(self) -> str:
        """运行时目录：.sillyspec/.runtime/"""
        return self.root / ".sillyspec" / ".runtime"
    
    def db_path(self) -> str:
        """SQLite DB：.sillyspec/.runtime/sillyspec.db"""
        return self.root / ".sillyspec" / ".runtime" / "sillyspec.db"
    
    def gate_status_path(self) -> str:
        """门控状态：.sillyspec/.runtime/gate-status.json"""
        return self.root / ".sillyspec" / ".runtime" / "gate-status.json"
    
    # 扫描结果
    def docs_dir(self, project: str) -> str:
        """文档目录：.sillyspec/docs/<project>/"""
        return self.root / ".sillyspec" / "docs" / project
    
    def scan_dir(self, project: str) -> str:
        """扫描文档：.sillyspec/docs/<project>/scan/"""
        return self.docs_dir(project) / "scan"
    
    def modules_dir(self, project: str) -> str:
        """模块文档：.sillyspec/docs/<project>/modules/"""
        return self.docs_dir(project) / "modules"
    
    # 变更文件名常量
    PROPOSAL = "proposal.md"
    DESIGN = "design.md"
    REQUIREMENTS = "requirements.md"
    TASKS = "tasks.md"
    PLAN = "plan.md"
    VERIFY_RESULT = "verify-result.md"
    MODULE_IMPACT = "module-impact.md"
    MASTER = "MASTER.md"
    
    # 标准 doc_type 列表（与 scan_docs 模块对齐）
    SCAN_DOC_TYPES = [
        "ARCHITECTURE", "CONVENTIONS", "STRUCTURE",
        "INTEGRATIONS", "TESTING", "CONCERNS", "PROJECT"
    ]
```

### T2: 修改 ChangeParser 读侧

文件：`backend/app/modules/change/parser.py`

当前问题（第 87 行）：
- 扫描 `changes/change/<key>` — 多了一层 `change/`
- doc_type `verification` 映射到 `verification.md`

修改：
1. 活跃变更扫描 `changes/<name>/`（排除 `archive/` 目录本身）
2. 归档变更扫描 `changes/archive/<name>/`
3. `changes/change/*` 作为 legacy 读取，打 warning log，不再写入
4. `verification.md` 作为 `verify-result.md` 的 legacy alias
5. STANDARD_FILENAMES 中的 `"verification": "verification.md"` 改为 `"verify_result": "verify-result.md"`
6. 使用 SpecPathResolver 替代硬编码路径

### T3: 修改 ChangeWriterService 写侧

文件：`backend/app/modules/change_writer/service.py`

当前问题（第 77 行）：写入 `.sillyspec/changes/change/<key>/`

修改：
1. 写入 `.sillyspec/changes/<change_key>/`（去掉中间的 `change/`）
2. 默认生成文件：proposal.md、design.md、requirements.md、tasks.md
3. 所有生成的 .md 文件必须包含 YAML frontmatter（author + created_at）
4. 使用 SpecPathResolver 替代硬编码路径

### T4: 修改 ArchiveService 归档路径

文件：`backend/app/modules/archive/service.py`

当前问题（第 68 行）：mv 到 `<root>/archive/...` — 完全不对

修改：
1. 归档到 `.sillyspec/changes/archive/<name>/`
2. 先 `mkdir -p .sillyspec/changes/archive/`
3. 再 `mv .sillyspec/changes/<name> .sillyspec/changes/archive/<name>`
4. 使用 SpecPathResolver 替代硬编码路径

### T5: 修改 RuntimeService 状态读取

文件：`backend/app/modules/runtime/service.py`

当前问题（第 55 行）：读 `.sillyspec/.runtime/progress.json`

修改：
1. 优先读 `.sillyspec/.runtime/sillyspec.db`（SQLite）
2. `progress.json` 作为 legacy fallback（文件存在时读，打印 warning）
3. 解析 SQLite 的 changes/stages/steps 表，映射为 RuntimeProgress schema
4. RuntimeProgress schema 中的 currentStage 映射到 changes.current_stage
5. stages 列表映射为 stages 表记录

### T6: 数据迁移（一次性脚本）

写一个迁移脚本/逻辑，在服务启动时或手动运行：

1. 把 `changes/change/<key>/` 目录下的文件移到 `changes/<key>/`
2. 删除空的 `changes/change/` 目录
3. 把活跃变更中已处于 archived 阶段的目录实际移入 `changes/archive/`
4. 将 `verification.md` 重命名为 `verify-result.md`（仅活跃变更）
5. 删除根目录下可能残留的 `gate-status.json`（正确位置在 `.sillyspec/.runtime/`）

## 影响的文件

```
backend/app/core/spec_paths.py          ← 新建
backend/app/modules/change/parser.py     ← 修改读侧
backend/app/modules/change_writer/service.py ← 修改写侧
backend/app/modules/archive/service.py   ← 修改归档路径
backend/app/modules/runtime/service.py   ← 修改状态读取
backend/app/modules/runtime/schema.py    ← 可能需调整 schema
```

## 验证标准

- [ ] parser 能正确扫描 `.sillyspec/changes/<name>/` 下的变更
- [ ] parser 对 `changes/change/<key>` legacy 路径打 warning 但仍可读
- [ ] writer 新创建的变更在 `changes/<key>/` 下（无中间 change/ 层）
- [ ] 归档后变更出现在 `changes/archive/<key>/` 下
- [ ] runtime 能从 sillyspec.db 读取状态
- [ ] 所有新生成的 .md 都有 author/created_at frontmatter
- [ ] 现有数据迁移后结构正确
