---
author: flow-machine-draft
created_at: 2026-10-15T00:49:32.903Z
---
# 任务注册表（Tasks）— 2026-10-15-ci-recurrence-guard

- [ ] task-01: check-assertion-surfaces.py 规则⑦ requires 补 menu-permissions.test.ts 与 permission.test.ts，新增规则⑨ openapi.json→双 api-types.ts 同提交，单测覆盖并通过
- [ ] task-02: knowledge/testing-gotchas.md 共享断言面清单两处同步登记（脚本 docstring 要求）
- [ ] task-03: CLAUDE.md 第 21 条明示 sillyhub-daemon 的 gen:types 同步义务
- [ ] task-04: backend/.pre-commit-config.yaml 增 pre-push 快检钩子（frontend+daemon typecheck、双 gen:types:check），本机安装 pre-push 钩子类型并实测拦截/放行各一次
- [ ] task-05: 「菜单数量锚改推导」评估结论留痕（预期 rejected：钉子锚是有意契约，复发根因是本地缺拦截面）
