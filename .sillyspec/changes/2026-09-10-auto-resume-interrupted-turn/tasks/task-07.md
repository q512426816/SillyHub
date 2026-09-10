---
id: task-07
title: 'Wave 6 收尾：模块文档 + 全链集成验证'
title_zh: 'Wave 6 收尾：模块文档 + 全链集成验证'
author: 'qinyi'
created_at: 2026-09-10 09:30:00
priority: P1
depends_on: ['task-02','task-03','task-04','task-05','task-06']
blocks: []
requirement_ids: ['FR-01','FR-02','FR-07','NFR-01','NFR-02']
decision_ids: ['D-001@v1','D-011@v1']
allowed_paths:
  - backend/app/modules/daemon/tests/test_auto_resume_integration.py
  - .sillyspec/docs/SillyHub/modules/daemon.md
  - .sillyspec/docs/SillyHub/modules/daemon.changelog.md
  - .sillyspec/docs/SillyHub/modules/frontend_components.changelog.md
  - .sillyspec/docs/SillyHub/modules/frontend_lib.md
target_files:
  - NEW:backend/app/modules/daemon/tests/test_auto_resume_integration.py
  - .sillyspec/docs/SillyHub/modules/daemon.md
  - .sillyspec/docs/SillyHub/modules/daemon.changelog.md
  - .sillyspec/docs/SillyHub/modules/frontend_components.changelog.md
  - .sillyspec/docs/SillyHub/modules/frontend_lib.md
goal: >
  集成测试（integration-critical 证据）：模拟完整序列——seed active 会话+running run+user_input 日志，recover(interrupted_run_id) 断言队列行入队，confirm 断言 active+派发触发，新 run 带 metadata_.auto_resume_of 且 prompt 含包装头，二次中断链上限第 3 次不再入队，confirm 后派发前插手动重发（G10 命中则续跑条目删行跳过不派发，契约表 §8.5 第 5 行，plan 审查 P2-2），恢复失败路径队列行收敛 failed。模块文档四处同步（daemon.md 恢复链段+changelog、frontend 两 changelog，引用本 change 名）。
implementation: >
  集成测试（integration-critical 证据）：模拟完整序列——seed active 会话+running run+user_input 日志，recover(interrupted_run_id) 断言队列行入队，confirm 断言 active+派发触发，新 run 带 metadata_.auto_resume_of 且 prompt 含包装头，二次中断链上限第 3 次不再入队，confirm 后派发前插手动重发（G10 命中则续跑条目删行跳过不派发，契约表 §8.5 第 5 行，plan 审查 P2-2），恢复失败路径队列行收敛 failed。模块文档四处同步（daemon.md 恢复链段+changelog、frontend 两 changelog，引用本 change 名）。
acceptance: >
  集成测试全绿（真实 DB 事务，非 mock 断言）+ 受影响模块全量（daemon/session 相关）零回归 + 文档 gate 通过。
constraints: >
  见 design.md 对应决策与 NFR；禁止越 allowed_paths 改文件；先例引用以行号锚定；既有测试零回归（NFR-01）。
verify: '验收标准见 acceptance 字段'
---


## 验收标准

集成测试全绿（真实 DB 事务，非 mock 断言）+ 受影响模块全量（daemon/session 相关）零回归 + 文档 gate 通过。
