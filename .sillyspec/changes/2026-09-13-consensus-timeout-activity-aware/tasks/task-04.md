---
id: task-04
title: 'group-chain regression + real-integration re-verify (long-task member survives to convergence)'
title_zh: '群链路回归 + 真实集成复验（长任务成员续期存活至收口）
'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 20:06:00
priority: P1
depends_on: [task-03]
blocks: []
requirement_ids: [FR-1, FR-2]
decision_ids: [D-1, D-3]
task_type: verification
allowed_paths:
  - backend/app/modules/daemon/group/service/consensus.py
target_files: []
goal: >
  群链路既有测试零失败回归；真实集成（uvicorn+PG 独立库）验证长任务成员（>60s
  交卷）在续期下任务存活至意见交回并完成汇总收口；无活动场景回归原时序（AC-6）。
implementation:
  - 回归：群链路测试套件（consensus/trigger_lock/direct/cross_mention/p1/p2 等既有 10 文件）
  - 真实集成：verify_consensus 独立库 + uvicorn（照 2026-09-12 复验环境范式）；造群+两 agent 成员，触发共识消息后人为延迟成员交卷（>60s、跨续期轮），观察任务续期→意见交回→汇总收口完成
  - 无活动对照：成员 run 无输出 → 原超时收口时序不回归
  - ruff/mypy 变更文件零告警
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/（群链路子集）
acceptance:
  - 群链路回归零失败
  - 真实集成：长任务成员任务存活（open 续期中）→ 交卷 → 收口完成（closed/timeout 带汇总）
  - 无活动场景原时序（不引入额外等待）
constraints:
  - 纯验证任务（无源码 diff 是本质属性）
  - 发现缺陷回 execute 修复，不在本 task 内改源码
  - 不跑全量测试（CLAUDE.md 规则 0）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。 -->
