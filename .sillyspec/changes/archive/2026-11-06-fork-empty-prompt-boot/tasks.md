---
author: flow-machine-draft
created_at: 2026-11-06T15:11:33.328Z
---
# 任务注册表（Tasks）— 2026-11-06-fork-empty-prompt-boot

- [x] task-01: daemon _startInteractiveSession 对带 resumeSessionId 的 lease（fork lease 特征）prompt 为空时不再早退，正常调 SessionManager.create 建引擎会话（复现事故形态的 daemon 级用例：认领 fork 空 prompt lease → 走 create 而非 interactive_missing_fields 早退）
- [x] task-02: 非 fork lease（无 resumeSessionId）空 prompt 行为不变仍早退（防回归用例）
- [x] task-03: backend fork_session 建 B 时继承 source.cwd（源会话有 cwd 则 B 落同值；源为空则 B 保持空，不伪造）
- [x] task-04: 新增/修改的 daemon 与 backend 测试全绿（只跑相关测试，不跑全量）
- [x] task-05: ruff/eslint 对触及文件零告警
