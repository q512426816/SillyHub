---
id: task-02
title: 'member list dedup + same-name determinism + terminal card reason + trigger failure snapshot'
title_zh: '名单去重 + 同名确定性 + 终态卡原因文案 + 触发失败落快照'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 20:06:00
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-3, FR-4, FR-5]
decision_ids: [D-4]
allowed_paths:
  - backend/app/modules/daemon/group/service/consensus.py
  - backend/app/modules/daemon/group/service/mentions.py
  - backend/app/modules/daemon/group/service/messages.py
target_files:
  - backend/app/modules/daemon/group/service/consensus.py
  - backend/app/modules/daemon/group/service/mentions.py
  - backend/app/modules/daemon/group/service/messages.py
goal: >
  状态卡名单任何数据形态下不重复（ID 去重+同名确定性+卡面标注）；aborted/timeout
  卡面带逐成员结局原因（含汇总人自身状态）；发送侧触发失败落 state=failed+error
  摘要到任务快照。
implementation:
  - create_consensus_task members 明细构造按成员 ID 去重（dict 保序，重复行不进快照）
  - mentions.py by_name 构造改确定性：同 display_name 多行取 joined_at 最早（与 broadcast 成员表序一致）；@ 解析仍按 id 去重保首序
  - _card_content 成员段遇同名成员（不同 id 同名）显示「名字(id前6位)」区分；终态卡（aborted/timeout）content 拼逐成员结局摘要（「名字 触发失败(原因)/超时未响应/已交卷」，含汇总人自身），保持 200 字符截断
  - messages.py 触发失败路径（gather 结果 failed 的成员）：任务快照对应行落 state=failed + error 一句话（经既有 mark/登记路径或直接 UPDATE members JSONB）；与 2026-09-12 FK 降级路径无冲突（降级时 consensus_task=None 短路在前）
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_group_consensus.py app/modules/daemon/tests/test_group_trigger_lock.py
acceptance:
  - members 快照输入含重复 id 行 → 快照无重复（AC-4）
  - 同名成员 @ 解析确定性命中 joined_at 最早一行；卡面同名可区分（AC-4）
  - aborted/timeout 卡面含逐成员结局（含汇总人自身状态），截断内（AC-5）
  - 触发失败成员快照行 state=failed + error 摘要；FK 降级路径行为不变
constraints:
  - 不改前端（卡面数据后端生成，ConsensusCardData 结构兼容——members[].name/state 字段形状不变）
  - 不动投影/影子会话/daemon 触发链（2026-09-12 锁降级语义保持）
  - error 摘要一句话（不入原文全文，防快照膨胀）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。 -->
