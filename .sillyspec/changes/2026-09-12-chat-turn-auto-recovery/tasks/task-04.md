---
id: task-04
title: 'Wave 2 backend：三分支自动恢复（判定序 + close 钩子接线）'
title_zh: 'Wave 2 backend：三分支自动恢复'
author: 'qinyi'
created_at: 2026-09-12 11:12:00
priority: P0
depends_on: ['task-03']
blocks: ['task-05','task-07']
requirement_ids: ['FR-3.1','FR-3.2','FR-3.3','FR-3.4','FR-3.5','FR-3.6']
decision_ids: ['D-004@v2','D-005','D-006','D-007','D-010']
allowed_paths:
  - backend/app/modules/daemon/session/service/auto_resume.py
  - backend/app/modules/daemon/run_sync/service/close_run_steps.py
  - backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py
  - backend/app/modules/daemon/tests/test_auth_transient_autoretry.py
target_files:
  - backend/app/modules/daemon/session/service/auto_resume.py
  - backend/app/modules/daemon/run_sync/service/close_run_steps.py
  - NEW:backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py
goal: >
  design §5.3：_maybe_autoretry_auth_transient_turn 泛化为 maybe_auto_recover_failed_turn(svc,
  agent_run)（逻辑迁 auto_resume.py，_CLI_AUTH_TRANSIENT_RE 随迁，close_run_steps 调用点改名）。
  判定序：G0 总门（failed / session active / 开关 auto_resume_interrupted 非 False / run 最新
  created_at desc+id desc / 非空 user_input / 双表 origin 幂等）→ 分支 A quota_exceeded+reset_at
  可解析（quota 链 <3 → INSERT AgentSessionScheduledMessage origin='auto_resume:<rid>'
  dispatch_at=reset_at+120s prompt=QUOTA_NUDGE_PROMPT）→ 分支 B 瞬时四类或 raw 命中 auth 正则
  （干净轮：G5 截断 <50000 / G6 附件守卫 → 原 prompt 入排队 origin='auto_resume:<rid>'；有工具
  活动：紧链 <2 → RESUME_NUDGE_PROMPT 入排队）→ 分支 C 其余不动作。RESUME/QUOTA_NUDGE_PROMPT
  常量导出 + 文案锁定。
implementation: >
  守卫复用 auto_resume.py 既有件形态（G4 :164-174 / G5 :191-195 / G6 :198-200 照搬）；排队 origin
  列是 9-10 已有零 migration，定时 origin 列由 task-03 建。auth 类并入统一判定序（D-004@v2 行为
  面变化：origin 补标 + G0 生效 + 开关关闭不重投）。测试覆盖：G0 全守卫正反例、三分支正反例、
  quota 链 3 达限、紧链 2 达限、nudge 文案锁定、auth 并入回归（旧用例迁移更新）、静默容错
  （恢复失败不影响终态）。
acceptance: >
  新测试全绿 + 既有 test_session_recovery / test_terminal_idempotent / 
  test_auth_transient_autoretry（迁移更新后）全绿；开关关闭全分支不动作有用例（NFR-3）。
constraints: >
  nudge 不带原 prompt（D-005）；同一 run 至多一个恢复动作（FR-3.6）；全程 try/except 静默容错；
  分支互斥 quota 优先判定。
verify: '验收标准见 acceptance 字段'
base_commit: '39d13bd4cbd3c9f198b8e24058951cf548dfa3cd'
head_commit: ''
---

## 验收标准

新分支矩阵测试全绿；既有恢复链测试零回归；开关关闭全分支不动作；nudge 文案锁定。
