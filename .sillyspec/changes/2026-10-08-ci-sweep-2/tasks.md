---
author: flow-machine-draft
created_at: 2026-10-08T15:12:55.373Z
---
# 任务注册表（Tasks）— 2026-10-08-ci-sweep-2

- [ ] task-01: git-log-page.test.tsx TABS 数量钉 15→16（用例名+头注释同步），该文件全绿
- [ ] task-02: test_cleanup_stale_runs_error_code.py error_detail 期望改新文案（reason=no daemon activity within grace window (startup cleanup / deferred recheck)/finished_by=stale_run_cleanup），全绿
- [ ] task-03: sillyspec-platform-command.test.ts 6 处与 selfupdate-scenarios.test.ts 2 处 length 断言 10→11（带 task-02 machine-id 尾参注释，同 daemon-heartbeat 先例），全绿
- [ ] task-04: provider-adapter-registry.test.ts readBackendAgentKindVocab 正则改 agent_kinds 复数 list Literal 形态（注释锚同步），对账恢复夹逼语义，全绿
- [ ] task-05: 本地仅跑相关测试文件全绿（全量留 CI），推送后 frontend-ci/backend-ci/daemon-ci/e2e-ci/scan-drift 全绿
