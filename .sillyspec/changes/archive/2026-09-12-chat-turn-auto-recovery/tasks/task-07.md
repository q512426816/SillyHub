---
id: task-07
title: 'Wave 5 收尾：三类中断端到端集成验证 + 文档同步'
title_zh: 'Wave 5 收尾：集成验证与文档'
author: 'qinyi'
created_at: 2026-09-12 11:12:00
priority: P0
depends_on: ['task-01','task-02','task-04','task-05','task-06']
blocks: []
requirement_ids: ['NFR-1','NFR-2','NFR-3','NFR-4']
decision_ids: ['D-003','D-007']
allowed_paths:
  - backend/app/modules/daemon/tests/test_auto_recover_integration.py
  - .sillyspec/docs/sillyhub-daemon/modules/model-error.md
  - .sillyspec/docs/sillyhub-daemon/modules/interactive.md
  - .sillyspec/docs/backend/modules/daemon.md
  - .sillyspec/docs/backend/modules/migrations.md
  - .sillyspec/docs/frontend/modules/components-daemon.md
  - .sillyspec/docs/frontend/modules/components-agent-log.md
target_files:
  - NEW:backend/app/modules/daemon/tests/test_auto_recover_integration.py
  - .sillyspec/docs/sillyhub-daemon/modules/model-error.md
  - .sillyspec/docs/sillyhub-daemon/modules/interactive.md
  - .sillyspec/docs/backend/modules/daemon.md
  - .sillyspec/docs/backend/modules/migrations.md
  - .sillyspec/docs/frontend/modules/components-daemon.md
  - .sillyspec/docs/frontend/modules/components-agent-log.md
goal: >
  真实 DB 端到端（对齐 9-10 test_auto_resume_integration.py 范式——plan 审查 P2 名实修正），六场景：①瞬时+干净轮——
  failed run（error_detail=provider_error、无 tool_call）→close 钩子→queued origin 条目→派发→
  新 run metadata_.auto_resume_of；②瞬时+工具活动——nudge 文案入队；③quota+reset_at——
  scheduled 条目 dispatch_at=reset_at+120s→sweep 派发打标；④G10——source 后有更新 run→条目
  取消；⑤链上限——紧链 2 / quota 链 3 达限不动作；⑥开关关闭全分支不动作（NFR-3）。模块文档
  五处同步（文档名以实际存在为准，缺失则以实际命中文件回写本卡）。
implementation: >
  集成测试用真实 Postgres（既有集成测试基建）；daemon 侧改动（task-01/02）以 daemon 回传形态
  的 error payload 直灌 backend 端点模拟（对齐 9-10「daemon 零改动故集成面为 backend 恢复链」
  的口径——本变更 daemon 有改，集成面仍是 backend 恢复链 + 模拟回传）；daemon 自身行为由其
  单测与冒烟承担。完成后提醒：daemon 生产生效需 pnpm bundle + 重新部署镜像。
acceptance: >
  六场景集成测试全绿（真实 DB）；模块文档同步；verify 阶段 integration-critical 门控可复跑
  （claim 命令写入 verify-result）。
constraints: >
  集成测试不 mock DB 事务；六场景缺一不可（禁止只测 happy path）。
verify: '验收标准见 acceptance 字段'
base_commit: '39d13bd4cbd3c9f198b8e24058951cf548dfa3cd'
head_commit: ''
---

## 验收标准

六场景集成测试全绿（真实 DB）；模块文档五处同步；verify 门控可复跑。
