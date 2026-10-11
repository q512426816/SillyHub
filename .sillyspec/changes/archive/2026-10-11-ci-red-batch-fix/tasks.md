---
author: flow-machine-draft
created_at: 2026-10-11T14:27:11.533Z
---
# 任务注册表（Tasks）— 2026-10-11-ci-red-batch-fix

- [x] task-01: backend tests/modules/agent/test_agent_run_log_tool_kind.py 定向 pytest 绿（PublishIntent 夹具补 duration_api_ms=None，21eb98d53 加必填位漏更夹具）
- [x] task-02: backend tests/test_align_platform_change_events_migration.py 定向 pytest 绿（head 锚 20261010190000→c515ffd62859 并续写注释链，cc3c022b6 merge 迁移漏更锚）
- [x] task-03: frontend admin/menus page.test.tsx 组内上移/下移声明序 19/20/21→17/18/19（8a928588f 删 components/topology 两项）+ git-log-page.test.tsx TABS 数 16→15，两文件定向 vitest 绿
- [x] task-04: sillyhub-daemon pnpm gen:types 重生成 src/api-types.ts 并提交，gen:types:check 语义（重生成后 git diff 为空）+ daemon typecheck 过
- [x] task-05: 不跑全量测试（规则 0），全量留给 CI
