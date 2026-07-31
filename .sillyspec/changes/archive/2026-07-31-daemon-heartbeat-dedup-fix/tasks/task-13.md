---
id: task-13
title: 实跑验证 daemon >2min online + 回复不重复
title_zh: 部署 daemon 实跑验证心跳不卡与回复不重复
author: WhaleFall
created_at: 2026-07-30 16:36:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-002@v1, D-003@v1, D-005@v1]
allowed_paths:
  - .sillyspec/changes/2026-07-30-daemon-heartbeat-dedup-fix/verification/run-log.md
provides:
  - contract: RealRunVerification
    fields: [daemon_online_gt_2min, no_duplicate_reply, heartbeat_updating]
expects_from:
  task-10:
    - contract: SandboxPathCheckTestCoverage
      needs: [before_after_assert]
  task-11:
    - contract: PolicyCacheConsistencyTest
      needs: [no_changed_on_equal]
  task-12:
    - contract: AssistantOverrideDedupTest
      needs: [no_duplicate]
goal: >
  部署 daemon 实跑验证两个 bug 修复：daemon 启动后 >2min 仍 online（跨过当前 2 分钟卡死点，backend 不标 offline，last_heartbeat 持续更新）+ 会话回复不重复（#35 场景消除）。验证结果记录为交付证据。
implementation:
  - 部署 daemon（用 sillyhub-docker-deploy 或 deploy-to-server skill，本地打包镜像部署，daemon 侧改动 rebuild）
  - 启动 daemon，观察 >2min（>8 个 15s 心跳拍）backend /api/daemon/machines status=online、last_heartbeat 持续更新、事件循环不冻死
  - 跑一次会话（#35 复现场景：agent 回复），核对回复不重复（一段内容只出现一次，backend logs 无 #35 式累积）
  - 验证结果（online 时长、last_heartbeat 时间戳序列、会话回复 log/截图）记录到 verification/run-log.md 作为交付证据
  - 若 >2min 仍卡（R4 未消除），在 run-log.md 记录现象，评估 resolveRealPath 异步化/看门狗自愈（D-005）
acceptance:
  - daemon 启动后 >2min 仍 online（status=online，last_heartbeat 持续更新）
  - 会话回复不重复（#35 场景消除，一段内容一次）
  - 验证结果记录在 verification/run-log.md（含 online 时长 + 心跳时间戳 + 会话回复证据）
  - 若仍卡：记录 R4 现象 + 异步化决策（D-005）
verify:
  - 部署后观察 daemon online >2min（backend /api/daemon/machines）
  - 实跑会话核对回复不重复
  - 核对 verification/run-log.md 已填写证据
constraints:
  - 实跑前置：Wave1（task-01..04）+ 部署 daemon online 才能验证（D-003）
  - daemon 侧改动 rebuild 镜像部署；backend 改动 task-08 需 backend rebuild，本次无 schema 改动免 migrate
  - R4 异步化本轮视实跑结果决定（D-005），不预先做
  - allowed_paths 仅验证记录文档（实跑不改产品代码，仅部署+观察+记录证据）
---
