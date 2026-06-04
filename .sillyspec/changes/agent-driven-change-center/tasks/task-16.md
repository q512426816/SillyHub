---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-16
title: 清理旧状态和旧逻辑
wave: W6
priority: P1
estimate: 2h
depends_on: [task-01]
---

# task-16: 清理旧状态和旧逻辑

## 目标

清理 rework_required/accepted 在代码中的所有残留引用，统一使用 human_gate 机制。

## 不在范围

- 不修改前端（task-13 已替换按钮逻辑）

## 输入

- `backend/app/modules/change/`（所有文件）
- `backend/app/modules/workflow/`（所有文件）

## 产出

- `backend/app/modules/change/model.py`（确认已清理）
- `backend/app/modules/change/service.py`（清理 rework_required/accepted 引用）
- `backend/app/modules/workflow/spec_guardian.py`（更新 guard 规则）
- `backend/app/modules/change/dispatch.py`（清理旧 stage 引用）

## 实现步骤

1. `grep -r "rework_required\|accepted" backend/app/modules/change/ backend/app/modules/workflow/`
2. 清理 `service.py` 中 submit_feedback 的 rework_required 引用（改为 human_gate=blocked 逻辑）
3. 清理 `spec_guardian.py` 中的旧 guard 规则（proposed→reviewed 等已不存在的转换）
4. 清理 `dispatch.py` 中对 rework_required/accepted 的 dispatch 判断
5. 确认 `router.py` 的 feedback 端点适配新状态

## 验收标准

- [ ] grep 搜索不再有 rework_required/accepted 引用
- [ ] 所有现有测试仍通过
- [ ] feedback API 仍可用（但内部逻辑走 human_gate）

## 风险

- 可能遗漏间接引用（如 stages JSON 中的状态值）——搜索要全面

## DoD

- [ ] 清理完成
- [ ] 无 lint 错误
- [ ] 现有测试通过
