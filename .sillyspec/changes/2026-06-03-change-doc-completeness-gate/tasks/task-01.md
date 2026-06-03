---
id: task-01
title: 后端 documents_complete 改判四件套 exists
priority: P0
estimated_hours: 1
depends_on: []
blocks: [task-03]
created_at: 2026-06-03 16:57:56
author: qinyi
allowed_paths:
  - backend/app/modules/change/service.py
---

# task-01: 后端 documents_complete 改判四件套 exists

## 背景

`check_archive_gate` 的第 6 项检查 `documents_complete` 当前实现为：

```python
incomplete = [d for d in docs if not d.status and d.exists]
```

但 `ChangeDocument.status` 由解析层从不写入，恒为 `None`。因此 `not d.status` 对任意存在的文档恒为 `True`，导致：只要变更下存在任何文档，`incomplete` 必非空，`documents_complete` 必判 `passed=False`，归档门禁因此必然失败、整个归档流程被卡死。

本任务把第 6 项检查改为「判定四件套 doc_type 是否都 exists」，彻底不再读 `status`。

## 修改文件（必填）

- `backend/app/modules/change/service.py`
  - 方法：`ChangeService.check_archive_gate`
  - 位置：documents_complete 检查项，当前约 **621-630 行**（`# Check 6: documents complete` 注释块）
  - 仅改动这一处，方法签名、其余 5 项检查、`can_archive` 汇总逻辑（约 632 行 `all(...)`）均不动

## 实现要求

### 步骤 1：定位现有代码

在 `check_archive_gate` 中找到第 6 项检查（约 621-630 行）：

**改前：**
```python
        # Check 6: documents complete
        docs, _, _ = await self.get_documents(workspace_id, change_id)
        incomplete = [d for d in docs if not d.status and d.exists]
        checks.append(
            ArchiveCheckItem(
                name="documents_complete",
                passed=len(incomplete) == 0,
                detail="" if not incomplete else f"{len(incomplete)} 个文档未完成",
            )
        )
```

### 步骤 2：替换为四件套 exists 判定

**改后：**
```python
        # Check 6: documents complete - 四件套必须齐全（exists）
        REQUIRED_DOC_TYPES = {"proposal", "design", "requirements", "tasks"}
        docs, _, _ = await self.get_documents(workspace_id, change_id)
        existing_types = {d.doc_type for d in docs if d.exists}
        missing = REQUIRED_DOC_TYPES - existing_types
        checks.append(
            ArchiveCheckItem(
                name="documents_complete",
                passed=len(missing) == 0,
                detail="" if not missing else f"缺少必需文档: {', '.join(sorted(missing))}",
            )
        )
```

### 步骤 3：核对要点

- `get_documents` 返回 `tuple[list[ChangeDocument], list[str], list[str]]`，第一个元素 `docs` 是 `ChangeDocument` ORM 对象列表，含 `.doc_type`（str）、`.exists`（bool）、`.status`（str | None，本任务不再使用）。
- `existing_types` 用集合推导，自动去重（同一 doc_type 多条只算一次）。
- `missing` 为集合差集；`sorted(missing)` 保证 detail 输出顺序稳定可测。
- 常量 `REQUIRED_DOC_TYPES` 就近定义在检查块内即可，无需提到模块级（与现有 5 项检查的内联风格一致，避免扩大改动面）。

## 接口定义（代码类任务必填）

`documents_complete` 检查项最终构造（即步骤 2 的核心片段）：

```python
REQUIRED_DOC_TYPES = {"proposal", "design", "requirements", "tasks"}
docs, _, _ = await self.get_documents(workspace_id, change_id)
existing_types = {d.doc_type for d in docs if d.exists}
missing = REQUIRED_DOC_TYPES - existing_types
checks.append(
    ArchiveCheckItem(
        name="documents_complete",   # 固定，不可改
        passed=len(missing) == 0,    # 四件套全在 → True
        detail="" if not missing else f"缺少必需文档: {', '.join(sorted(missing))}",
    )
)
```

`ArchiveCheckItem` 字段契约（来自 `schema.py`，本任务只用不改）：

| 字段 | 类型 | 本检查取值 |
|---|---|---|
| `name` | `str` | 固定 `"documents_complete"` |
| `passed` | `bool` | `len(missing) == 0` |
| `detail` | `str` | 通过时 `""`；缺件时 `f"缺少必需文档: {', '.join(sorted(missing))}"` |

> 注：`can_archive = all(check.passed for check in checks)` 已在方法末尾存在，第 6 项 `passed` 变化会自动汇入，无需另改。

## 边界处理（必填，≥5 条）

1. **docs 为空列表**：`existing_types = set()`，`missing = {"proposal","design","requirements","tasks"}`，`passed=False`，detail = `"缺少必需文档: design, proposal, requirements, tasks"`（按字母序）。
2. **四件套全缺（有其他文档但无四件套）**：如仅有 `plan`、`prototype`，则四个必需类型全部在 `missing` 中，`passed=False`。
3. **部分缺（如缺 requirements）**：`missing = {"requirements"}`，`passed=False`，detail = `"缺少必需文档: requirements"`。
4. **四件套齐全 + 含可选文档（plan/verify_result/module_impact/prototype/reference 等）**：可选文档不在 `REQUIRED_DOC_TYPES` 中，不影响 `missing`；只要四件套 exists 即 `passed=True`，detail = `""`。
5. **某文档 doc_type 属四件套但 exists=False**：被 `if d.exists` 过滤掉，不进 `existing_types`，对应类型仍计入 `missing`，`passed=False`（即「记录在册但文件不存在」也算缺）。
6. **status 字段完全无关**：新逻辑不读 `d.status`，无论其为 None 还是任何值都不影响判定；不得保留任何 `not d.status` 残留。
7. **同一 doc_type 多条记录**：集合推导自动去重，重复 exists 记录不影响结果。
8. **不动其余 5 项检查**：no_unresolved_feedback / ac_confirmed / tech_verification_passed / business_review_passed / feedback_categorized 的代码逐字保留。
9. **不动 schema**：`ArchiveCheckItem` / `ArchiveGateResponse` 不修改，只消费。
10. **不动 current_stage != accepted 的早退分支**（约 547-565 行）：该分支已对 6 项统一置 False，本任务不涉及。

## 非目标（本任务不做的事）

- 不为 `ChangeDocument.status` 补写入逻辑（解析层、parser 一概不碰）。
- 不修改 `schema.py`（`ArchiveCheckItem` / `ArchiveGateResponse` 保持原样）。
- 不修改其余 5 项门禁检查及 `can_archive` 汇总逻辑。
- 不修改前端（契约对齐为 task-03 / task-04）。
- 不在本任务写测试（测试为 task-02，本任务只交付实现逻辑）。
- 不把 `REQUIRED_DOC_TYPES` 提升为模块级常量或跨文件共享（避免扩大改动面）。

## 参考

`check_archive_gate` 内既有检查项的标准写法（照此风格保持一致），例如 Check 5：

```python
        # Check 5: feedback categorized
        feedback_records = stages.get("feedback_history", [])
        uncategorized = [f for f in feedback_records if not f.get("category")]
        checks.append(
            ArchiveCheckItem(
                name="feedback_categorized",
                passed=len(uncategorized) == 0,
                detail="" if not uncategorized else f"{len(uncategorized)} 条反馈未分类",
            )
        )
```

- 数据来源：`get_documents`（service.py 约 155-163 行）返回 `(docs, prototypes, references)`，`docs` 内每项为 `ChangeDocument`，含 `doc_type` / `exists` / `status` 字段。
- 四件套定义依据：design.md「必需文档 = {proposal, design, requirements, tasks}」。

## TDD 步骤

1. 写测试（属 task-02，本任务不执行）：四件套齐全 → `documents_complete.passed=True`；缺件 → `passed=False` 且 detail 含缺失项名。
2. 确认失败：现有实现因 `not d.status` 对存在文档恒判未完成，缺件/齐全均误判。
3. 写代码：按本文件步骤 2 替换第 6 项检查。
4. 确认通过：齐全用例 passed=True、缺件用例 passed=False 且 detail 正确。
5. 回归：`check_archive_gate` 其余 5 项检查结果与改前一致，`accepted` 早退分支不变。

> 本任务交付的是实现逻辑；测试编写归 task-02（block 关系：task-01 blocks task-03，测试链由 plan 在 Wave 2 安排）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | 在 accepted 阶段、四件套（proposal/design/requirements/tasks）均 exists 的变更上调用 `check_archive_gate` | `documents_complete` 项 `passed=True`、`detail==""` |
| 2 | 构造缺 requirements 的场景（其余三件套 exists） | `documents_complete` 项 `passed=False`、`detail=="缺少必需文档: requirements"` |
| 3 | 构造 docs 为空的场景 | `documents_complete` 项 `passed=False`、`detail=="缺少必需文档: design, proposal, requirements, tasks"`（按字母序） |
| 4 | 构造四件套齐全且额外含可选文档（如 plan、prototype，且其 status 均为 None）的场景 | `documents_complete` 项 `passed=True`，可选文档与 status 均不影响判定 |
| 5 | grep service.py 检查残留 | `check_archive_gate` 中不再出现 `not d.status` / `incomplete` 字样；其余 5 项检查代码逐字未变 |
| 6 | 阅读 diff | 仅改动 `documents_complete` 检查块；未触碰 schema.py、解析层、前端 |
