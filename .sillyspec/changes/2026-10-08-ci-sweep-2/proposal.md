---
author: flow-machine-draft
created_at: 2026-10-08T15:12:55.373Z
---
# 提案书（Proposal）— 2026-10-08-ci-sweep-2

## 动机

任务原话转写：第二轮 CI 红清偿：2026-10-08 新提交上 frontend-ci/backend-ci/daemon-ci 三线共 8 用例失败，逐一核对生产意图后全部为测试侧未跟上近期有意生产变更（生产零改动）：①frontend git-log-page.test 钉 TABS=15 项，e8da254ce 知识图谱变更加了第 16 个页签（其自身 workspace-tabs.test 已更新，此数量钉漏跟）②backend test_cleanup_stale_runs_error_code 钉旧 error_detail 文案，9f1f974c/89a7e9a42 宽限窗变更评审 P3 有意改文案（reason/finished_by 均换）③daemon 心跳 length 断言钉 10 参，d6fabf408 machine-id 尾参使平铺形态 10→11（daemon-heartbeat 两文件已同步改 11，sillyspec-platform-command 6 处与 selfupdate-scenarios 2 处漏跟）④daemon provider-adapter-registry 对账正则锚单数 agent_kind 冒号形态，2026-10-06 provider 变更把字段改为复数 agent_kinds list Literal 形态致解析失配。

成功标准：
- git-log-page.test.tsx TABS 数量钉 15→16（用例名+头注释同步），该文件全绿
- test_cleanup_stale_runs_error_code.py error_detail 期望改新文案（reason=no daemon activity within grace window (startup cleanup / deferred recheck)/finished_by=stale_run_cleanup），全绿
- sillyspec-platform-command.test.ts 6 处与 selfupdate-scenarios.test.ts 2 处 length 断言 10→11（带 task-02 machine-id 尾参注释，同 daemon-heartbeat 先例），全绿
- provider-adapter-registry.test.ts readBackendAgentKindVocab 正则改 agent_kinds 复数 list Literal 形态（注释锚同步），对账恢复夹逼语义，全绿
- 本地仅跑相关测试文件全绿（全量留 CI），推送后 frontend-ci/backend-ci/daemon-ci/e2e-ci/scan-drift 全绿

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. git-log-page.test.tsx TABS 数量钉 15→16（用例名+头注释同步），该文件全绿
2. test_cleanup_stale_runs_error_code.py error_detail 期望改新文案（reason=no daemon activity within grace window (startup cleanup / deferred recheck)/finished_by=stale_run_cleanup），全绿
3. sillyspec-platform-command.test.ts 6 处与 selfupdate-scenarios.test.ts 2 处 length 断言 10→11（带 task-02 machine-id 尾参注释，同 daemon-heartbeat 先例），全绿
4. provider-adapter-registry.test.ts readBackendAgentKindVocab 正则改 agent_kinds 复数 list Literal 形态（注释锚同步），对账恢复夹逼语义，全绿
5. 本地仅跑相关测试文件全绿（全量留 CI），推送后 frontend-ci/backend-ci/daemon-ci/e2e-ci/scan-drift 全绿

## 成功标准（可验证）

1. git-log-page.test.tsx TABS 数量钉 15→16（用例名+头注释同步），该文件全绿
2. test_cleanup_stale_runs_error_code.py error_detail 期望改新文案（reason=no daemon activity within grace window (startup cleanup / deferred recheck)/finished_by=stale_run_cleanup），全绿
3. sillyspec-platform-command.test.ts 6 处与 selfupdate-scenarios.test.ts 2 处 length 断言 10→11（带 task-02 machine-id 尾参注释，同 daemon-heartbeat 先例），全绿
4. provider-adapter-registry.test.ts readBackendAgentKindVocab 正则改 agent_kinds 复数 list Literal 形态（注释锚同步），对账恢复夹逼语义，全绿
5. 本地仅跑相关测试文件全绿（全量留 CI），推送后 frontend-ci/backend-ci/daemon-ci/e2e-ci/scan-drift 全绿
