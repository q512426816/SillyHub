---
id: task-05
title: '僵尸判死（项目维度限定；running+有 lease+daemon 持续离线超阈值→failed(zombie)+zombie_marked_at；链路断链跳过；幂等判重）(depends_on: task-02)'
title_zh: '僵尸判死（项目维度限定；running+有 lease+daemon 持续离线超阈值→failed(zombie)+zombie_marked_at；链路断链跳过；幂等判重）(depends_on: task-02)'
author: qinyi
created_at: 2026-08-21 07:22:59
priority: P0
depends_on: [task-02]
blocks: [task-06, task-07, task-08]
requirement_ids: [FR-03]
decision_ids: [D-003, D-005]
allowed_paths:
  - backend/app/modules/agent/patrol.py
  - backend/app/modules/agent/tests/test_patrol.py
provides:
  - contract: 僵尸标记态（run/mission 持久化语义，task-06/07/08 消费）
    fields: [AgentRun.status=failed, AgentRun.error_code=orchestrator_zombie, AgentRun.finished_at 置位, mission.constraints.zombie_marked_at=ISO 字符串]
expects_from:
  - contract: MissionPatrolService 巡检骨架（task-02 patrol.py）
    fields: [每轮独立短 session, 活跃 mission 查询, 单 mission 异常隔离, round_done 日志]
goal: >
  在 MissionPatrolService 骨架上实现职责③第一段僵尸判死（design §2.3 Grill 修正后判死逻辑）：
  项目维度 mission 的主 agent run running + 有 lease + 承载 daemon 持续离线超阈值 →
  标 failed(orchestrator_zombie)+finished_at 并在 mission.constraints 写 zombie_marked_at，
  不收敛——两阶段可复活的信号豁免期开始（复活属 task-06、豁免解除属 task-07）。
implementation:
  - 判死候选查询：mission.change_id IS NULL 且 converged_at/cancelled_at 均 NULL（Grill P1 项目维度限定），其主 run role='orchestrator' AND status='running' 且存在 DaemonTaskLease（daemon_task_leases.agent_run_id=run.id）；pending 无 lease 天然排除（pending+no_online_daemon 归职责②重派，design §2.3）。
  - 判死链路逐环解析：主 run → 最新 lease（按 agent_run_id 过滤，order by updated_at desc limit 1）→ DaemonRuntime（lease.runtime_id）→ DaemonInstance（runtime.daemon_instance_id）。
  - 双条件判死（D-003 持续离线语义）：daemon.status != 'online' AND now - daemon.last_heartbeat_at >= settings.mission_patrol_zombie_after_minutes（task-01 配置，默认 60min）——两条件同时满足才判死（R-02 防 status 断连标记滞后）。
  - 判死动作：run.status='failed' + run.error_code='orchestrator_zombie' + run.finished_at=now；mission.constraints['zombie_marked_at']=now ISO 字符串（同 mcp_tools.py conflict_attempts 的 JSON 键复用模式，D-005 无新列）；不触发收敛（豁免期开始，interactive lease 永不过期故无既有兜底）。
  - 链路断链跳过（Grill P2-2）：lease.runtime_id 为 NULL、runtime 行不存在、runtime.daemon_instance_id 为 NULL（迁移期遗留 nullable）、daemon 行不存在 → log.debug 跳过该 run 不判死，不猜不崩。
  - 幂等判重（Grill P2-6）：候选仅取 status='running'，已 failed+error_code='orchestrator_zombie' 的 run 不再进候选、zombie_marked_at 不被覆盖。
  - zombie_marked 计数并入 round_done 日志（与 converged/redispatched 并列）。
  - test_patrol.py 追加用例（design §7 判死组）：三分支——离线超阈值→failed(zombie)+zombie_marked_at、在线→不动、离线未超阈值→不动；限定——change_id 非空 mission 不进候选、无 lease/pending 不进候选；断链——lease 无 runtime_id / runtime.daemon_instance_id NULL 跳过不抛；幂等——已 zombie 的 run 再巡检不重复标。
acceptance:
  - 三分支判死用例绿：running+有 lease+daemon 离线且 now-last_heartbeat_at>=阈值 → run failed + error_code='orchestrator_zombie' + finished_at 置位 + constraints['zombie_marked_at']（ISO 字符串）；daemon 在线 → 全不动；离线但未超阈值 → 全不动。
  - 幂等：已标 orchestrator_zombie 的 run 再巡检不重复判死（zombie_marked_at 不被覆盖）。
  - 项目维度限定：mission.change_id 非空的主 run 不进判死候选（Grill P1）；pending/无 lease 的 run 不进候选。
  - 链路断链（lease 无 runtime_id / runtime.daemon_instance_id NULL）跳过不判死且不抛异常（Grill P2-2）。
  - 判死后 mission 不收敛（converged_at 仍 NULL）——两阶段第一阶段，只标记不收尾。
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_patrol.py -q --no-cov
constraints:
  - 判死候选限定 mission.change_id IS NULL（Grill P1：change 维度 team mission 已有 _handle_team_run_completion 事件驱动兜底，不进判死范围）。
  - 判死=双条件：daemon.status != 'online' 且 now - daemon.last_heartbeat_at >= mission_patrol_zombie_after_minutes，缺一不判死（D-003 持续离线，非瞬时状态；R-02）。
  - 链路断链跳过不判死：lease 无 runtime_id、runtime.daemon_instance_id NULL（迁移期遗留 nullable）→ log debug 跳过，不猜不崩（Grill P2-2）。
  - 幂等：error_code 已 'orchestrator_zombie' 不重复标（候选仅 status='running' 判重 + 不覆盖既有 zombie_marked_at，Grill P2-6）。
  - zombie_marked_at 写 mission.constraints JSON（ISO 字符串，同 conflict_attempts 模式，D-005 无新列），不改表结构、不加 migration。
  - 判死不收敛、不派新 lease、不动 schedule_loop（复活重派属 task-06、豁免解除属 task-07、schedule_loop 豁免属 task-08）；只动 patrol.py + test_patrol.py。
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
