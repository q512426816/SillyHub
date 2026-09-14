# 实现计划：共识收口超时活动感知续期 + 状态卡名单/原因修复

---
plan_level: full
author: qinyi
created_at: 2026-09-13 15:05:00
---

## 任务展开

### task-01: consensus.py sweeper 活动感知续期
- 改动：`consensus_sweep_once` 死线到点后先判续期——新增模块内 `_member_is_active` helper（影子最新 run status ∈ {running, queued, pending} 或该 run 时间线最近 2 分钟有新行，fail-closed）；`hard_cap = task.created_at + group.consensus_timeout_seconds + 600s`；任一 pending 成员活动 → `deadline_at = min(now + 60s, hard_cap)` + `write_consensus_card`（collecting + 「仍在工作，已延长等待」）+ commit，本轮不收口；全员无活动/达硬上限 → 原收口路径不动。
- target_files: backend/app/modules/daemon/group/service/consensus.py

### task-02: 名单去重 + 同名确定性 + 终态卡原因文案 + 触发失败落快照
- 改动：`create_consensus_task` members 快照按成员 ID 去重；`mentions.py` `by_name` 同名多行改确定性选取（joined_at 最早）；`_card_content` 同名成员显示 `名字(id前6位)`、终态卡带逐成员结局（含汇总人自身状态，200 字符截断）；`messages.py` 触发失败路径将成员快照行落 `state=failed + error 一句话`（FR-5；与 2026-09-12 FK 降级路径无冲突——降级时 consensus_task=None）。
- target_files: backend/app/modules/daemon/group/service/consensus.py, backend/app/modules/daemon/group/service/mentions.py, backend/app/modules/daemon/group/service/messages.py

### task-03: 新增 test_group_consensus_activity.py 测试
- 用例：①死线到点+pending 成员 run running → 顺延不收口+卡面延长提示（AC-1）；②续期达硬上限 → 不再顺延走原收口两分支（AC-2）；③全员无活动（run 终态+时间线 2min 无新行）→ 立即原路径收口无额外等待（AC-3）；④members 快照重复 id 输入 → 去重（AC-4）；⑤同名成员 @ 解析确定性+卡面区分（AC-4）；⑥aborted/timeout 卡面含逐成员结局含汇总人（AC-5）。
- target_files: NEW:backend/app/modules/daemon/tests/test_group_consensus_activity.py

### task-04: 群链路回归 + 真实集成复验
- 回归：共识/触发锁/直聊等群链路既有测试零失败；真实集成（uvicorn+PG verify_consensus 独立库）：长任务成员（>60s 交卷）续期下任务存活至意见交回并完成汇总收口（AC-6）；无活动场景回归原时序。
- task_type: verification
- target_files: (纯验证任务，无源码 diff)

## Wave 编排

### Wave 1（sweeper 续期）
- task-01

### Wave 2（名单+文案+落快照，与 01 共享 consensus.py 故分波）
- task-02

### Wave 3（测试，依赖源码）
- task-03

### Wave 4（回归+复验）
- task-04

## 风险与回滚

- 续期误判（run 状态残留 running 但实际卡死）→ 硬上限 10min 兜底；
- 回滚单文件级（无迁移无 schema 变更），revert 两 commit 即可；
- 真根因名单数据在阿里云端——本地防御修复保底，部署后核对（D-4 双轨）。
