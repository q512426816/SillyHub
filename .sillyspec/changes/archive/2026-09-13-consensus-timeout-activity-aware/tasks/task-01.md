---
id: task-01
title: 'consensus.py sweeper activity-aware deadline extension'
title_zh: 'consensus.py sweeper 活动感知续期（_member_is_active helper + hard_cap + 60s 顺延 + 卡面延长提示）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 20:06:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-1, FR-2]
decision_ids: [D-1, D-2, D-3, D-6]
allowed_paths:
  - backend/app/modules/daemon/group/service/consensus.py
target_files:
  - backend/app/modules/daemon/group/service/consensus.py
goal: >
  死线到点时 sweeper 先判成员活动（run 运行/排队或时间线 2 分钟有新行），
  有活动则顺延 deadline 60s（硬上限=created_at+群timeout+600s）并更新状态卡
  「仍在工作，已延长等待」；全员无活动/达上限走原收口路径（零回归）。
implementation:
  - 新增模块内私有 async helper `_member_is_active(db, shadow_session_id) -> bool`：查该影子会话最新一条 agent_runs（按 created_at/id 倒序取一），status ∈ {running, queued, pending} → True；否则查该 run 的 agent_run_logs max(timestamp) >= now-120s → True；run 不存在/查询异常 → False（fail-closed，不连坐）
  - `consensus_sweep_once` 收口前插入续期判定：hard_cap = task.created_at + group.consensus_timeout_seconds + 600s；now < hard_cap 且 members 中任一 state==pending 成员 is_active → task.deadline_at = min(now+60s, hard_cap)，write_consensus_card(phase=collecting, content 追加「仍在工作，已延长等待」)，commit 后 continue 本轮（不收口）
  - 续期提示进 _card_content 或 write_consensus_card 的 content 拼接（保持 200 字符截断口径）
  - 全员无活动或 now >= hard_cap → 原 else 分支不动（有 delivered → inject_converge_directive(timed_out=True)；零 delivered → aborted）
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_group_consensus.py
acceptance:
  - 死线到点 + pending 成员 run running → deadline 顺延、任务仍 open、卡面出现「仍在工作，已延长等待」（AC-1）
  - 续期累计达 hard_cap 后仍在活动 → 不再顺延，按原路径收口两分支语义不变（AC-2）
  - 全员无活动（run 终态且时间线 2min 无新行）→ 立即原路径收口，无额外等待（AC-3）
  - _member_is_active 查询异常/无 run → False（fail-closed）
constraints:
  - 不动 mark_consensus_member_outcome 终态不可逆语义（D-5）
  - 不新增 DB 列/迁移（deadline_at 复用，hard_cap 用 created_at+群 timeout 推算）
  - per-task 异常吞错语义保持（sweep 单任务失败不连坐）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。 -->
