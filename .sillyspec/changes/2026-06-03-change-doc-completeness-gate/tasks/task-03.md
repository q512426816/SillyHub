---
id: task-03
title: 后端归档门禁测试（覆盖四件套齐全通过 / 缺件失败）
priority: P0
estimated_hours: 1
depends_on: [task-01]
blocks: [task-05]
created_at: 2026-06-03 16:57:56
author: qinyi
allowed_paths:
  - backend/tests/modules/change/test_archive_gate.py（新建）
---

# task-03: 后端归档门禁测试（覆盖四件套齐全通过 / 缺件失败）

## 修改文件（必填）

grep 定位结论（关键词 `check_archive_gate` / `archive_gate` / `documents_complete`）：

- 被测源码：`backend/app/modules/change/service.py` — `ChangeService.check_archive_gate`（538-633 行），其中 documents_complete 在 621-630 行（task-01 改造对象）。
- 既有 `check_archive_gate` / `archive_gate` 测试：**无**。全仓 grep 仅命中 `service.py` 与 `router.py`，无任何测试覆盖该方法。
- change 模块现存两处测试目录，风格分两类：
  - `backend/app/modules/change/tests/`（`test_router.py`、`test_transition_response.py` 等）— 走 HTTP `client` fixture + 文件 fixtures，偏端到端。
  - `backend/tests/modules/change/`（`test_dispatch.py`、`test_router_transition.py` 等）— **直接用 `db_session` fixture 构造 model 行 + 直接调用 service/函数**，service 级单测风格。
- 本任务为 service 方法单测，归入 service 级目录，**新建** `backend/tests/modules/change/test_archive_gate.py`。

> 仅新增测试文件，不改 `service.py`（task-01 已实现 documents_complete 新逻辑）。

## 实现要求

为 task-01 改造后的 `documents_complete` 检查项补单测，隔离验证该项（其余 5 项构造为 ready，使其 passed）：

1. `test_documents_complete_passes_when_all_four_present` — 四件套 {proposal, design, requirements, tasks} 全部 `exists=True` 时，`documents_complete` 项 `passed=True`、`detail==""`；且 6 项全 ready 时 `can_archive=True`。
2. `test_documents_complete_fails_when_design_missing` — 缺 design（不建该行，或 `exists=False`）时 `documents_complete.passed=False`，`detail` 含 "design"；`can_archive=False`。
3. `test_documents_complete_detail_lists_all_missing` — 同时缺 requirements 与 tasks，`detail` 同时含 "requirements" 和 "tasks"（断言子串，不绑定顺序/全文）。
4. `test_documents_complete_ignores_optional_docs` — 四件套齐全但缺可选文档（如 plan / verify_result），`documents_complete.passed=True`（可选文档不计入分母）。

辅助断言：每个用例从返回的 `checks` 中按 `name == "documents_complete"` 取项，避免依赖列表下标。

## 接口定义（代码类任务必填）

被测方法签名：

```python
async def check_archive_gate(
    self, workspace_id: uuid.UUID, change_id: uuid.UUID
) -> ArchiveGateResponse
# ArchiveGateResponse { can_archive: bool, checks: list[ArchiveCheckItem] }
# ArchiveCheckItem    { name: str, passed: bool, detail: str }
```

被测项预期（task-01 后）：`name="documents_complete"`，按四件套 `exists` 判定，缺件 `detail` 形如 `缺少必需文档: design, requirements`（断言用子串）。

fixture / 构造步骤（用 `db_session` fixture）：

1. **Workspace 行**：`check_archive_gate` → `self.get` → `self._workspace_service.get(workspace_id)` 需要 Workspace 存在。仿 `test_dispatch.py::_create_workspace`：`Workspace(id, name, slug 唯一, root_path="/tmp/...", status="active")`，commit，返回 `ws.id`。
2. **Change 行（accepted 前置）**：仿 `test_dispatch.py::_create_change`，但需满足进入 6 项检查的前置条件——
   - `current_stage="accepted"`（非 accepted 时直接全 fail 返回，无法隔离 documents_complete）。
   - `feedback_category=None`（否则 no_unresolved_feedback fail）。
   - `stages={"ac_confirmed": True, "tech_verification_passed": True, "business_review_passed": True, "feedback_history": []}`（让 check 2/3/4/5 全 pass）。
   - 其余必填字段：`workspace_id`、`change_key`、`title`、`status`、`location`、`path`。
3. **ChangeDocument 行**：`from app.modules.change.model import ChangeDocument`，按用例建若干行：
   - `ChangeDocument(change_id=change.id, doc_type="proposal", path="...proposal.md", exists=True, status=None)` ，四件套各一行。
   - 缺件用例：不建该 doc_type 的行，或建 `exists=False`。
   - 注意 `status=None` 是默认且应保持 None——验证 task-01 已不再依赖 status（旧逻辑 `not d.status and d.exists` 会让 status=None 的存在文档算"未完成"，新逻辑必须忽略 status）。
4. 实例化 `ChangeService(db_session)`，`await svc.check_archive_gate(ws_id, change.id)`，对返回断言。

## 边界处理（必填，≥5 条）

1. **accepted 前置必须就绪**：未设 `current_stage="accepted"` 或缺 stages 标志位时，方法在 548-565 行短路返回全 fail，documents_complete 永远 False，测试失去意义——每个用例必须把 ac_confirmed/tech_verification_passed/business_review_passed 置 True、feedback_history 置 []、feedback_category 置 None。
2. **缺件断言查 detail 内容**：缺件用例不仅断言 `passed=False`，还要断言 `detail` 包含缺失 doc_type 名（子串匹配，如 `"design" in item.detail`），不写死全文/顺序，兼容 task-01 实现里的 `sorted(missing)` 拼接。
3. **不依赖 status**：四件套行的 `status` 全部留 None（默认值），断言齐全用例仍 `passed=True`——这是对"不再使用 `not d.status` 判定"的回归保护；切勿在 fixture 里给 status 赋值掩盖回归。
4. **可选文档不参与判定**：缺 plan/verify_result/module_impact/MASTER/prototype/reference 时不得使 documents_complete 失败；用例 4 显式建一个缺可选文档的场景断言 passed=True。
5. **复用既有 fixture 与构造风格**：用 conftest 的 `db_session` fixture（非 `client`/HTTP），仿 `backend/tests/modules/change/test_dispatch.py` 的 `_create_change`/`_create_workspace` 直建 model 行，不引入新 fixture 体系、不复制 HTTP 文件 fixtures。
6. **不改 service 实现**：本任务只读 `service.py`、只写测试文件；若测试不通过应判定为 task-01 未达标并回到 task-01，不得在 service 内改逻辑迁就测试。
7. **按 name 取项**：从 `resp.checks` 用 `next(c for c in resp.checks if c.name == "documents_complete")` 提取，不用下标，避免 6 项顺序变动导致脆弱断言。
8. **Workspace slug/name 唯一**：每个用例用 `uuid` 后缀生成唯一 slug/name，避免同库多用例唯一约束冲突（沿用 `_create_workspace` 写法）。

## 非目标

- 不为其余 5 项门禁（no_unresolved_feedback / ac_confirmed / tech_verification_passed / business_review_passed / feedback_categorized）单独补测试。
- 不测 router/HTTP 层归档门禁端点（service 级足够覆盖 documents_complete 逻辑）。
- 不修改 `service.py`、`model.py`、`schema.py` 任何源码。
- 不为 `ChangeDocument.status` 补写入逻辑或测试其写入。
- 不测前端契约对齐（属 task-04）。

## 参考

- 既有 service 级测试风格：`backend/tests/modules/change/test_dispatch.py`（`_create_change`、`_create_workspace`、`_create_agent_run` 直建 model + `db_session` fixture）。
- conftest fixtures：`backend/conftest.py`（`db_session`、`db_engine`，in-memory SQLite，hermetic）。
- 被测源码：`backend/app/modules/change/service.py:538-633`（check_archive_gate，含 accepted 短路与 6 项检查）。
- 模型：`backend/app/modules/change/model.py:211`（ChangeDocument：doc_type/path/exists/status 字段）。
- 设计依据：本变更 `design.md` 第 39-53 行（documents_complete 新逻辑）、第 72-79 行（ArchiveGateResponse 契约）。
- 注：plan.md 中后端门禁测试列为 task-02，本蓝图按下达编号 task-03 落盘，依赖 task-01、阻塞 task-05，等价同一任务。

## TDD 步骤

1. 新建 `backend/tests/modules/change/test_archive_gate.py`，加 `from __future__ import annotations`、`import uuid`、`import pytest`，导入 `Change`、`ChangeDocument`、`ChangeService`、`Workspace`。
2. 写 `_make_workspace(session)` 与 `_make_accepted_change(session, ws_id)` 两个 helper（accepted 前置 stages 就绪）。
3. 写 helper `_add_doc(session, change_id, doc_type, *, exists=True)`。
4. 先写用例 1（四件套齐全），运行 `python -m pytest backend/tests/modules/change/test_archive_gate.py -q`——若 task-01 未完成会 fail（红）。
5. 补用例 2/3/4，逐个跑红→确认 task-01 实现后转绿。
6. 全文件跑绿后，跑 change 模块全量回归确认无破坏：`python -m pytest backend/tests/modules/change backend/app/modules/change/tests -q`。

## 验收标准

| 编号 | 验收项 | 验证方式 | 期望 |
|---|---|---|---|
| AC-1 | 四件套齐全通过 | `python -m pytest backend/tests/modules/change/test_archive_gate.py::test_documents_complete_passes_when_all_four_present -q` | passed；documents_complete.passed=True 且 detail=="" 且 can_archive=True |
| AC-2 | 缺件失败且 detail 指明 | `python -m pytest backend/tests/modules/change/test_archive_gate.py::test_documents_complete_fails_when_design_missing -q` | passed；documents_complete.passed=False 且 detail 含 "design"，can_archive=False |
| AC-3 | 多缺件 detail 全列 | `python -m pytest backend/tests/modules/change/test_archive_gate.py::test_documents_complete_detail_lists_all_missing -q` | passed；detail 同时含 "requirements" 与 "tasks" |
| AC-4 | 不依赖 status + 可选文档不计 | `python -m pytest backend/tests/modules/change/test_archive_gate.py::test_documents_complete_ignores_optional_docs -q` | passed；四件套 status=None 仍 passed=True，缺可选文档不影响 |
| AC-5 | change 模块回归无破坏 | `python -m pytest backend/tests/modules/change backend/app/modules/change/tests -q` | 全部 passed，无新增 fail |
