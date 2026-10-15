---
author: flow-machine-draft
created_at: 2026-10-15T00:49:32.903Z
---
# 提案书（Proposal）— 2026-10-15-ci-recurrence-guard

## 动机

任务原话转写：CI 红灯防复发：把 2026-10-15-fix-ci-red 灭火中发现的三类漏拦（daemon api-types 漂移/菜单测试数量锚/推送前类型检查）机制化到本地闸门。
成功标准：
- check-assertion-surfaces.py 规则⑦ requires 补 menu-permissions.test.ts 与 permission.test.ts，新增规则⑨ openapi.json→双 api-types.ts 同提交，单测覆盖并通过
- knowledge/testing-gotchas.md 共享断言面清单两处同步登记（脚本 docstring 要求）
- CLAUDE.md 第 21 条明示 sillyhub-daemon 的 gen:types 同步义务
- backend/.pre-commit-config.yaml 增 pre-push 快检钩子（frontend+daemon typecheck、双 gen:types:check），本机安装 pre-push 钩子类型并实测拦截/放行各一次
- 「菜单数量锚改推导」评估结论留痕（预期 rejected：钉子锚是有意契约，复发根因是本地缺拦截面）

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. check-assertion-surfaces.py 规则⑦ requires 补 menu-permissions.test.ts 与 permission.test.ts，新增规则⑨ openapi.json→双 api-types.ts 同提交，单测覆盖并通过
2. knowledge/testing-gotchas.md 共享断言面清单两处同步登记（脚本 docstring 要求）
3. CLAUDE.md 第 21 条明示 sillyhub-daemon 的 gen:types 同步义务
4. backend/.pre-commit-config.yaml 增 pre-push 快检钩子（frontend+daemon typecheck、双 gen:types:check），本机安装 pre-push 钩子类型并实测拦截/放行各一次
5. 「菜单数量锚改推导」评估结论留痕（预期 rejected：钉子锚是有意契约，复发根因是本地缺拦截面）

## 成功标准（可验证）

1. check-assertion-surfaces.py 规则⑦ requires 补 menu-permissions.test.ts 与 permission.test.ts，新增规则⑨ openapi.json→双 api-types.ts 同提交，单测覆盖并通过
2. knowledge/testing-gotchas.md 共享断言面清单两处同步登记（脚本 docstring 要求）
3. CLAUDE.md 第 21 条明示 sillyhub-daemon 的 gen:types 同步义务
4. backend/.pre-commit-config.yaml 增 pre-push 快检钩子（frontend+daemon typecheck、双 gen:types:check），本机安装 pre-push 钩子类型并实测拦截/放行各一次
5. 「菜单数量锚改推导」评估结论留痕（预期 rejected：钉子锚是有意契约，复发根因是本地缺拦截面）
