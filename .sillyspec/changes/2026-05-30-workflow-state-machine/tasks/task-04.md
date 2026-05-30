---
id: task-04
title: "Spec Guardian G4 — 文档字数 ≥ 100 检查"
priority: P0
estimated_hours: 1
depends_on: [task-03]
blocks: [task-10]
allowed_paths:
  - backend/app/modules/workflow/spec_guardian.py
  - backend/app/modules/workflow/tests/test_spec_guardian.py
  - backend/app/modules/change/service.py
---

# task-04: Spec Guardian G4 — 文档字数 ≥ 100 检查

## 修改文件（必填）
- `backend/app/modules/workflow/spec_guardian.py` — 新增 G4 检查函数 + 修改 `check_change_ready_for_approved`
- `backend/app/modules/workflow/tests/test_spec_guardian.py` — 新增 G4 测试
- `backend/app/modules/change/service.py` — 在文档同步时计算 word_count

## 实现要求

### 1. G4 Guard Rule 逻辑

在 `reviewed → approved` 转换中，检查所有 `exists=True` 的文档，要求每个文档的 `word_count >= 100`。

```python
async def _check_docs_non_trivial(
    session: AsyncSession, change: Change,
) -> list[str]:
    """G4: reviewed → approved — all existing docs must have ≥ 100 words."""
    violations: list[str] = []
    stmt = select(ChangeDocument).where(
        col(ChangeDocument.change_id) == change.id,
        col(ChangeDocument.exists).is_(True),
    )
    docs = (await session.execute(stmt)).scalars().all()
    for doc in docs:
        wc = doc.word_count if doc.word_count is not None else 0
        if wc < 100:
            violations.append(
                f"Document '{doc.doc_type}' has only {wc} words (minimum 100)."
            )
    return violations
```

### 2. 集成到现有 checker

修改 `check_change_ready_for_approved`，在检查 requirements + design 存在之后，额外调用 `_check_docs_non_trivial`：

```python
async def check_change_ready_for_approved(
    session: AsyncSession, change: Change,
) -> list[str]:
    violations: list[str] = []
    for doc_type in ("requirements", "design"):
        stmt = select(ChangeDocument).where(...)
        doc = ...
        if doc is None:
            violations.append(f"{doc_type.capitalize()} document is missing.")
    # G4: 文档字数 ≥ 100
    violations.extend(await _check_docs_non_trivial(session, change))
    return violations
```

### 3. word_count 计算逻辑

在 `change/service.py` 的 `_sync_docs` 方法中，当文档内容可读时计算字数：

```python
# 在 _sync_docs 中，创建或更新 ChangeDocument 时：
# 注意：word_count 在 reparse 时从文件内容计算
# 但 sync 阶段不一定能读文件，所以 word_count 留到 get_document_content 时 lazy 计算
# 或者在 ChangeDocument 创建时默认 None
```

**简化方案**：由于 reparse 流程中可能无法直接读文件内容来计算字数，暂时在 spec_guardian 检查时，如果 `word_count` 为 None，则 fallback 检查文件内容（需要 workspace root_path）。但这引入了 spec_guardian 对 filesystem 的依赖。

**最终方案**：在 `change/service.py` 的 `get_document_content` 方法中，读取文件后更新 `word_count`：

```python
# get_document_content 返回后，更新 word_count
content = full_path.read_text(...)
if content:
    doc.word_count = len(content.split())
    session.add(doc)
```

以及在 `_sync_docs` 中，如果 parsed_doc 包含文件路径，尝试读取并计算。

## 接口定义（代码类任务必填）

```python
# spec_guardian.py — 新增函数签名
async def _check_docs_non_trivial(
    session: AsyncSession, change: Change,
) -> list[str]:
    """G4: reviewed → approved — all existing docs must have ≥ 100 words."""
```

不需要注册到 `_GUARD_RULES` 字典（因为它是 `check_change_ready_for_approved` 的子检查，不是独立 transition）。

## 边界处理（必填）
- `word_count` 为 `None` 时等同于 0，阻止转换（保守策略）
- 文档类型为 `prototype`（HTML）时，字数计算可能不准确，但统一处理
- 空文档（`content = ""`）的 `len(content.split()) = 0`，正确阻止
- `get_document_content` 更新 `word_count` 时不需要额外 commit（调用方会 commit）
- 如果 `get_document_content` 未被调用（纯 API 查询），`word_count` 仍为 NULL，guard 会阻止

## 非目标（本任务不做的事）
- 不修改 FSM 定义
- 不修改 API 端点
- 不实现异步后台 word_count 计算

## 参考
- 现有 guard 规则模式：`spec_guardian.py` 中的 `check_change_ready_for_approved`
- G4 定义在 design.md Guard Rules 表

## TDD 步骤
1. 编写 G4 测试：reviewed → approved 时文档字数 < 100 应被阻止
2. 确认测试失败（guard 规则未实现）
3. 实现 `_check_docs_non_trivial` + 集成到 `check_change_ready_for_approved`
4. 确认测试通过
5. 运行全量 workflow 测试

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | reviewed → approved 文档字数 < 100 | 返回 violation |
| AC-02 | reviewed → approved 文档字数 = 100 | 通过 |
| AC-03 | reviewed → approved 文档字数 > 100 | 通过 |
| AC-04 | reviewed → approved word_count = None | 返回 violation（视为 0） |
| AC-05 | reviewed → approved 无文档 | 仅报告 "missing"，不报 word_count（因为文档不存在） |
| AC-06 | 运行全量测试 | 通过 |
