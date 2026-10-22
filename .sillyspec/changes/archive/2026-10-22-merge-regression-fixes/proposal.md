---
author: flow-machine-draft
created_at: 2026-10-22T08:42:05.081Z
---
# 提案书（Proposal）— 2026-10-22-merge-regression-fixes

## 动机

任务原话转写：合并回归债收口：grants 闭包与 lease 双流断言

动机与背景：合并部署后的第三轮验证暴露两类残留（前者为合并引入，后者为全量套件才现形的既有隔离脆性）：
① origin 侧 2026-10-21-agent-profile-slim-default 给 users 新增 default_agent_profile_id FK→agent_profiles，daemon/grants 测试的 selected-metadata 闭包注释明写「users 表自身无外键」假设失效——全量跑 14 errors（NoReferencedTableError('agent_profiles')），隔离跑同样复现；须按姊妹范式（workspace/member_runtimes/tests/conftest.py）把 agent_profiles→workspaces/llm_providers/tool_policies 纳入闭包并补模型 import。
② daemon/lease test_init_claim_tokens 两降级用例断言 structlog 警告在 stdout，全量套件下渲染流为 stderr（Captured stderr 内事件完整）→ 间歇假败（隔离必绿）；断言改 captured.out+err 双流合并，意图（事件+原因枚举在场）不变。

成功标准：
- app/modules/daemon/grants/tests/ 62 passed 零 errors（原 48 passed + 14 errors）
- test_init_claim_tokens.py 两降级用例在任意渲染流下稳定通过（13 passed），全量套件复跑零 failed 零 errors
- 仅测试面改动（conftest + 断言载体），零生产源码变更，无需重新部署

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. app/modules/daemon/grants/tests/ 62 passed 零 errors（原 48 passed + 14 errors）
2. test_init_claim_tokens.py 两降级用例在任意渲染流下稳定通过（13 passed），全量套件复跑零 failed 零 errors
3. 仅测试面改动（conftest + 断言载体），零生产源码变更，无需重新部署

## 成功标准（可验证）

1. app/modules/daemon/grants/tests/ 62 passed 零 errors（原 48 passed + 14 errors）
2. test_init_claim_tokens.py 两降级用例在任意渲染流下稳定通过（13 passed），全量套件复跑零 failed 零 errors
3. 仅测试面改动（conftest + 断言载体），零生产源码变更，无需重新部署
