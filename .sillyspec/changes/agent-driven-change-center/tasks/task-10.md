---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-10
title: human-test API + Schema
wave: W3
priority: P0
estimate: 2h
depends_on: [task-04]
---

# task-10: human-test API + Schema

## 目标

实现人工测试反馈 API。pass 进入归档确认，bug 触发 quick，doc_mismatch 回到 propose。

## 不在范围

- 不实现 proposal-review（task-08）和 plan-review（task-09）

## 输入

- `backend/app/modules/change/router.py`
- `backend/app/modules/change/service.py`
- `backend/app/modules/change/schema.py`

## 产出

- `backend/app/modules/change/schema.py`（改，新增 HumanTestRequest）
- `backend/app/modules/change/service.py`（改，新增 human_test 方法）
- `backend/app/modules/change/router.py`（改，新增路由）

## 实现步骤

1. 在 `schema.py` 新增：
   ```python
   class HumanTestRequest(BaseModel):
       result: Literal["pass", "bug", "doc_mismatch"]
       comment: str | None = None
   ```
2. 在 `service.py` 新增 `human_test()`：
   - 校验 `current_stage == "verify"` 且 `human_gate == "need_human_test"`
   - pass: transition→archive, human_gate=need_archive_confirm
   - bug: dispatch quick agent（不改变 stage），human_gate=none
   - doc_mismatch: transition→propose, dispatch propose agent 携带 comment
3. 在 `router.py` 新增 `POST /changes/{change_id}/human-test`
4. 记录测试结果到 AuditLog

## 验收标准

- [ ] pass 后 current_stage=archive, human_gate=need_archive_confirm
- [ ] bug 后 quick agent 被 dispatch
- [ ] doc_mismatch 后 propose agent 被 dispatch，携带 comment
- [ ] 非 verify+need_human_test 调用返回 409
- [ ] 测试结果记录到 AuditLog

## 风险

- doc_mismatch 直接跳到 propose 跨过了 plan——这是设计决策（文档问题应从 propose 重走流程）

## DoD

- [ ] 代码修改完成
- [ ] 无 lint/type 错误
