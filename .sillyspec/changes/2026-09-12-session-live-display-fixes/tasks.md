---
author: qinyi
created_at: 2026-09-12T23:55:00
---

# 任务 — 2026-09-12-session-live-display-fixes

> Wave 分组按三端独立可发布划分；每任务含实现与测试同任务闭环（规则：只跑相关面测试）。
> target_files 为精确仓根相对路径（新建加 NEW: 前缀）。

- [x] task-01: revokePartialSegments 全树扫描撤回（FR-1.1）
  - target_files: frontend/src/components/daemon/session-log-assembler.ts, frontend/src/components/daemon/__tests__/session-log-assembler.test.ts
- [x] task-02: dropPrefixPartialReply 全桶前缀收编 + F7 cell 失效（FR-1.2/1.3/1.4）
  - target_files: frontend/src/components/daemon/session-log-assembler.ts, frontend/src/components/daemon/__tests__/session-log-assembler.test.ts
  - depends_on: task-01
- [x] task-03: 运行中轮计时锚点优先 run 快照（FR-4.1/4.2）
  - target_files: frontend/src/components/daemon/session-panel/page-helpers.tsx, frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx
- [x] task-04: extractCode 原因短语锚定 + 静默断流专属文案（FR-2.1/2.2/2.3）
  - target_files: sillyhub-daemon/src/model-error/classifier.ts, sillyhub-daemon/tests/model-error/classifier.test.ts
- [x] task-05: 纯切换轮跳过 user_input 落库与 turn_count（FR-3.1~3.4）
  - target_files: backend/app/modules/daemon/session/service/inject.py, backend/app/modules/daemon/tests/test_inject_silent_switch.py
- [x] task-06: chain-limit 停跑补 error_detail.hint + auto_resume_stopped（FR-5.1/5.2）
  - target_files: backend/app/modules/daemon/session/service/auto_resume.py, backend/app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py
- [x] task-07: 三端相关面测试 + lint/typecheck 全绿
  - target_files: （无新增改动，验证任务）
  - depends_on: task-01,task-02,task-03,task-04,task-05,task-06
- [x] task-08: 部署验证（backend/frontend 镜像 + daemon bundle 分发 + 生产会话实测）
  - 结果：R1 三轮直播正文 live==clean 零碎片 / R3 双向切换零日志行 turn_count 不变 / R4 计时锚 started_at <1.5s / R2·R5 条件式过；证据 evidence/prod-live-test-20260913.md
  - target_files: （部署任务，无仓内改动）
  - depends_on: task-07
