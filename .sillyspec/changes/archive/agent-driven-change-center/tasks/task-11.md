---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-11
title: verify 自动修复闭环（stages JSON 计数 + max 3 轮）
wave: W4
priority: P1
estimate: 3h
depends_on: [task-07]
---

# task-11: verify 自动修复闭环（stages JSON 计数 + max 3 轮）

## 目标

verify AgentRun 完成后，如果验证不通过，自动 dispatch quick agent 修复并重新 verify，最多 3 轮。超限后设 human_gate=blocked。

## 不在范围

- 不修改 verify prompt 模板
- 不实现 quick agent 的具体修复策略

## 输入

- `backend/app/modules/change/dispatch.py`（auto_dispatch_next_step）
- `backend/app/modules/change/model.py`（stages JSON 结构）

## 产出

- `backend/app/modules/change/dispatch.py`（改）

## 实现步骤

1. 在 `auto_dispatch_next_step()` 的 verify 完成分支中：
   - 检查 `sillyspec.db` 中 verify 的结果（通过/不通过）
   - 如果通过：设 `human_gate=need_human_test`，停止 auto-chain
   - 如果不通过：
     a. 读取 `change.stages.get("_auto_fix_count", 0)`
     b. 如果 count < 3：dispatch quick agent，increment count，quick 完成后自动 dispatch verify
     c. 如果 count >= 3：设 `human_gate=blocked`，停止 auto-chain
2. quick agent 完成后的 `auto_dispatch_next_step` 应自动 dispatch verify（基于 TRANSITIONS 的 quick→verify 出口）
3. 在 stages JSON 中记录每次修复的摘要：`_auto_fix_log: [{attempt, exit_code, summary}]`

## 验收标准

- [ ] verify 通过后 human_gate=need_human_test
- [ ] verify 不通过后自动 dispatch quick agent
- [ ] quick 完成后自动 dispatch verify
- [ ] _auto_fix_count 正确递增
- [ ] 第 3 次修复仍失败后 human_gate=blocked
- [ ] auto-chain 限制机制（原有 _dispatch_chain_count）不被绕过

## 风险

- auto_chain 的 _dispatch_chain_count 与 _auto_fix_count 可能冲突——auto_fix 不应消耗 chain_count
- quick agent 可能永远无法修复某些问题——blocked 状态确保不会无限循环

## DoD

- [ ] 代码修改完成
- [ ] 无 lint/type 错误
