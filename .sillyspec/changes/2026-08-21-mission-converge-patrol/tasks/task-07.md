---
id: task-07
title: '豁免解除（窗口耗尽→constraints.zombie_converged=true）(depends_on: task-05)'
title_zh: '豁免解除（窗口耗尽→constraints.zombie_converged=true）(depends_on: task-05)'
author: 'qinyi'
created_at: 2026-08-21 07:22:59
priority: P0
depends_on: [task-05]
blocks: []
requirement_ids: [FR-03.4]
decision_ids: [D-004]
allowed_paths:
  - backend/app/modules/agent/patrol.py
  - backend/app/modules/agent/tests/test_patrol.py
goal: >
  patrol.py 职责③豁免解除段——zombie 主 run 复活窗口耗尽且 daemon 仍离线时，
  mission.constraints 写 zombie_converged=true 解除信号 1 豁免，下轮 schedule_loop
  正常收敛；写后不再干预该 run。
implementation:
  - patrol.py 僵尸段（与 task-06 复活扫描同链路、同轮内先判复活再判耗尽）新增窗口
    耗尽分支——候选 = 主 run error_code 为 orchestrator_zombie 且 now-zombie_marked_at
    >= settings.mission_patrol_revive_window_minutes
  - 仅当 daemon 仍离线（daemon.status != online，判死链路实时查）才向 mission.
    constraints 写 zombie_converged=true 并 commit；daemon 已恢复在线的走 task-06
    复活路径（error_code 被清，本分支天然不命中），两分支互斥
  - 写 zombie_converged 后对该 run 不再做任何状态修改（不清 error_code、不重派、
    不直接调 converge）——下轮 schedule_loop 信号 1 视主 run 终态 failed 正常收敛
    （窗口已过，task-08 豁免条件自然不成立）
  - log info（mission_id/run_id/zombie_marked_at），计数汇入 round_done 结构化日志
  - test_patrol.py 追加用例——窗口耗尽+daemon 离线 → constraints.zombie_converged
    为 True 且 run 状态不变；窗口耗尽+daemon 在线 → 不写（走复活）；窗口内 → 不写；
    幂等（已写 zombie_converged 不重复写）
acceptance:
  - zombie_marked_at 距今 >= revive_window 且 daemon 仍离线——constraints 的
    zombie_converged 为 True，run 保持 failed + error_code=orchestrator_zombie 不变
  - daemon 在线（即使窗口耗尽）不写 zombie_converged，由复活路径接管
  - zombie_converged 写入后 patrol 对该 run 不再有状态修改；下轮 schedule_loop 按
    既有信号 1 逻辑收敛（豁免条件 error_code+时间窗均不满足）
  - test_patrol.py 新增用例全绿，既有 patrol 用例（task-02~06 建）零回归
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_patrol.py -q
constraints:
  - 仅当 daemon 仍离线才标 zombie_converged=true（在线的走 task-06 复活路径，
    两分支互斥）
  - 写后不再干预该 run——不清 error_code / 不重派 / 不直接触发收敛（收敛仍由
    信号 1 既有路径，职责不越界）
  - 只改 patrol.py + test_patrol.py；constraints JSON 复用，无 schema 变更（NFR-03）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
