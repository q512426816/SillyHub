---
id: task-05
title: "修正 human-test（pass→archive+need_archive_confirm, bug→quick, doc_mismatch→propose）"
priority: P0
estimated_hours: 1
depends_on: [task-01, task-02]
blocks: [task-06]
author: WhaleFall
created_at: 2026-06-04 13:50:10
---

# task-05: 修正 human_test 三路分支

## 修改文件

| 文件 | 改动 |
|------|------|
| `backend/app/modules/change/service.py` | 重写 `human_test()` 方法，修正三路分支逻辑 |

## 实现要求

### Guard 条件（保持不变）

方法入口 guard 保持现有逻辑：`current_stage == "verify" AND human_gate == "need_human_test"`，不满足则抛 `InvalidTransition`。

### 分支 1: result=="pass" — 进入 archive 等待确认

1. 调用 `transition(workspace_id, change_id, target_stage="archive", user_role="reviewer", reason=...)` 转移到 archive 阶段
2. **不调用 `transition_with_dispatch`**，因为需要避免自动 dispatch archive Agent
3. transition 成功后，**手动**设置 `change.human_gate = "need_archive_confirm"`
4. 写入 `stages["last_review"]` = `{decision: "pass", comment, user_id, submitted_at, from_stage: "verify", target_action: "archive"}`
5. `session.commit()` 并返回 `{change: change, agent_dispatch: {}}`
6. **关键**：AD-04 明确要求 pass 不 dispatch archive，要有人工确认步骤（task-06）

### 分支 2: result=="bug" — 进入 quick 自动修复

1. 设置 `change.human_gate = "none"`
2. 写入 `stages["last_review"]` = `{decision: "bug", comment, user_id, submitted_at, from_stage: "verify", target_action: "quick"}`
3. 调用 `transition_with_dispatch(workspace_id, change_id, target_stage="quick", user_role="admin", reason=..., user_id=user_id)`
4. 此路径保持 dispatch 行为，quick Agent 应立即启动

### 分支 3: result=="doc_mismatch" — 回退到 propose

1. 设置 `change.human_gate = "none"`
2. 写入 `stages["last_review"]` = `{decision: "doc_mismatch", comment, user_id, submitted_at, from_stage: "verify", target_action: "propose"}`
3. 调用 `transition_with_dispatch(workspace_id, change_id, target_stage="propose", user_role="admin", reason=..., user_id=user_id)`
4. 此路径依赖 task-02 在 TRANSITIONS 中添加的 `verify→propose` 回退边

### review_history 记录格式

每次调用统一写入 `stages["last_review"]` 字段：

```python
stages = change.stages or {}
stages["last_review"] = {
    "decision": result,       # "pass" | "bug" | "doc_mismatch"
    "comment": comment,       # 用户填写的备注，可为 None
    "user_id": str(user_id),  # 操作人
    "submitted_at": datetime.now(timezone.utc).isoformat(),
    "from_stage": "verify",
    "target_action": target_action,  # "archive" | "quick" | "propose"
}
change.stages = stages
```

## 接口定义

方法签名保持不变（前端不感知内部逻辑变化）：

```python
async def human_test(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    result: str,           # "pass" | "bug" | "doc_mismatch"
    comment: str | None,
    user_id: uuid.UUID,
) -> dict:
```

Router 端点无需修改：`POST /changes/{change_id}/human-test`，请求体 `HumanTestRequest` 不变。

## 边界处理

| # | 边界场景 | 处理方式 |
|---|----------|----------|
| 1 | `current_stage != "verify"` | 抛 `InvalidTransition`，携带 `{current_stage, human_gate}` 详情 |
| 2 | `human_gate != "need_human_test"` | 抛 `InvalidTransition`，同上 |
| 3 | `result` 不是 "pass"/"bug"/"doc_mismatch" | 抛 `ValueError("invalid human_test result: {result}")`，不静默忽略 |
| 4 | pass 分支 transition 到 archive 失败 | 异常自然抛出，change 不被修改（数据库事务安全） |
| 5 | bug/doc_mismatch 分支 dispatch 失败 | `transition_with_dispatch` 内部已 best-effort 处理，不会阻塞 transition 本身 |
| 6 | comment 为 None | 记录到 `stages["last_review"]["comment"]` 时保留 None，reason 用默认文案 |

## 非目标

- 不修改 `human_test` 的 API 签名或路由端点
- 不处理 archive-confirm 流程（task-06 负责）
- 不修改 `transition_with_dispatch` 方法本身
- 不添加 `review_history` 列表追加模式（当前只写 `last_review` 字段，与 proposal_review/plan_review 保持一致）
- 不修改 `HumanTestRequest` schema

## 参考

- design.md AD-03（verify→propose 回退边）、AD-04（pass 不 dispatch archive）
- plan.md Wave 2, task-05 描述
- `service.py` 第 987-1034 行：当前 `human_test` 实现
- `service.py` 第 880-927 行：`proposal_review` 参考（类似的 review 模式）
- `model.py` TRANSITIONS 定义（verify 条目）

## TDD

### 测试用例列表

| # | 测试名 | 场景 | 断言 |
|---|--------|------|------|
| 1 | `test_human_test_pass_to_archive` | verify+need_human_test, result="pass" | `current_stage=="archive"`, `human_gate=="need_archive_confirm"`, **无** agent_dispatch |
| 2 | `test_human_test_bug_to_quick` | verify+need_human_test, result="bug" | `current_stage=="quick"`, agent_dispatch 包含 quick dispatch |
| 3 | `test_human_test_doc_mismatch_to_propose` | verify+need_human_test, result="doc_mismatch" | `current_stage=="propose"`, agent_dispatch 包含 propose dispatch |
| 4 | `test_human_test_wrong_stage` | current_stage="plan" | 抛 `InvalidTransition` |
| 5 | `test_human_test_wrong_gate` | human_gate="none" | 抛 `InvalidTransition` |
| 6 | `test_human_test_invalid_result` | result="something_else" | 抛 `ValueError` |
| 7 | `test_human_test_pass_no_dispatch` | pass 分支 | 返回中 `agent_dispatch` 为空或无 dispatch 字段 |
| 8 | `test_human_test_review_history` | 任意分支 | `stages["last_review"]` 包含 decision, comment, user_id, submitted_at, from_stage, target_action |

## 验收标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | human_test("pass") 后 `current_stage=="archive"` 且 `human_gate=="need_archive_confirm"` | 单元测试 + 手动验证 |
| 2 | human_test("pass") 不触发 archive Agent dispatch | 单元测试断言 `agent_dispatch` 为空 |
| 3 | human_test("bug") 后 `current_stage=="quick"` 并 dispatch quick Agent | 单元测试 |
| 4 | human_test("doc_mismatch") 后 `current_stage=="propose"` 并 dispatch propose Agent | 单元测试（需 task-02 的 verify→propose 边已就位） |
| 5 | guard 拒绝非 verify+need_human_test 的状态 | 单元测试覆盖错误阶段和错误 gate |
| 6 | 无效 result 值被拒绝 | 单元测试 |
| 7 | `stages["last_review"]` 记录完整，包含 from_stage 和 target_action | 单元测试 |
| 8 | 现有 pytest 全部通过 | `pytest backend/app/modules/change/tests/` |
