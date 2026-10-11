---
author: flow-machine-draft
created_at: 2026-10-11T14:27:11.533Z
---
# 提案书（Proposal）— 2026-10-11-ci-red-batch-fix

## 动机

任务原话转写：动机：main 分支 5 处 CI 红灯（backend-ci 2 测试失败、frontend-ci 3 测试失败、daemon-ci api-types 漂移），全部属「生产契约变更漏同步钉子测试/生成物」一类技术债清偿，无生产代码缺陷需改。

成功标准：
- backend tests/modules/agent/test_agent_run_log_tool_kind.py 定向 pytest 绿（PublishIntent 夹具补 duration_api_ms=None，21eb98d53 加必填位漏更夹具）
- backend tests/test_align_platform_change_events_migration.py 定向 pytest 绿（head 锚 20261010190000→c515ffd62859 并续写注释链，cc3c022b6 merge 迁移漏更锚）
- frontend admin/menus page.test.tsx 组内上移/下移声明序 19/20/21→17/18/19（8a928588f 删 components/topology 两项）+ git-log-page.test.tsx TABS 数 16→15，两文件定向 vitest 绿
- sillyhub-daemon pnpm gen:types 重生成 src/api-types.ts 并提交，gen:types:check 语义（重生成后 git diff 为空）+ daemon typecheck 过
- 不跑全量测试（规则 0），全量留给 CI

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. backend tests/modules/agent/test_agent_run_log_tool_kind.py 定向 pytest 绿（PublishIntent 夹具补 duration_api_ms=None，21eb98d53 加必填位漏更夹具）
2. backend tests/test_align_platform_change_events_migration.py 定向 pytest 绿（head 锚 20261010190000→c515ffd62859 并续写注释链，cc3c022b6 merge 迁移漏更锚）
3. frontend admin/menus page.test.tsx 组内上移/下移声明序 19/20/21→17/18/19（8a928588f 删 components/topology 两项）+ git-log-page.test.tsx TABS 数 16→15，两文件定向 vitest 绿
4. sillyhub-daemon pnpm gen:types 重生成 src/api-types.ts 并提交，gen:types:check 语义（重生成后 git diff 为空）+ daemon typecheck 过
5. 不跑全量测试（规则 0），全量留给 CI

## 成功标准（可验证）

1. backend tests/modules/agent/test_agent_run_log_tool_kind.py 定向 pytest 绿（PublishIntent 夹具补 duration_api_ms=None，21eb98d53 加必填位漏更夹具）
2. backend tests/test_align_platform_change_events_migration.py 定向 pytest 绿（head 锚 20261010190000→c515ffd62859 并续写注释链，cc3c022b6 merge 迁移漏更锚）
3. frontend admin/menus page.test.tsx 组内上移/下移声明序 19/20/21→17/18/19（8a928588f 删 components/topology 两项）+ git-log-page.test.tsx TABS 数 16→15，两文件定向 vitest 绿
4. sillyhub-daemon pnpm gen:types 重生成 src/api-types.ts 并提交，gen:types:check 语义（重生成后 git diff 为空）+ daemon typecheck 过
5. 不跑全量测试（规则 0），全量留给 CI
