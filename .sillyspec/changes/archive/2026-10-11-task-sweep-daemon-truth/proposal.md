---
author: flow-machine-draft
created_at: 2026-10-11T03:58:30.390Z
---
# 提案书（Proposal）— 2026-10-11-task-sweep-daemon-truth

## 动机

任务原话转写：用户二次指正：超时无心跳≠死（长耗时任务可能静默很久）——上一变更的 5 分钟宽限启发式仍会误判。彻底修正：死活判定回归唯一真相源 daemon 注册表（mgr._backgroundTasks：task_started 注册、task_notification 注销、会话终态清空=SDK 进程 kill 任务随进程消亡——daemon 自己的权威语义）。实现：daemon 新增 session_live_tasks RPC（backend→daemon 既有 rpc_id 通道，list_dir/linked_repos 同款）；后端清扫改为「确认死才收」——会话终态（ended/failed）直接收（daemon 语义背书），其余逐 runtime 问 daemon 活跃集，不在集合内才收；daemon 离线/超时跳过该批（fail-open 保活）。废除全部时间启发式（TASK_SWEEP_GRACE/延迟复扫宽限）；run 收口改为 +60s 后跑一次确认清扫；复活分支保留为误收兜底。
成功标准：
- daemon session_live_tasks RPC 返回该会话注册表活跃 task_id 列表（未注册会话=空表）
- 后端清扫：会话终态行直接收口；活跃会话行经 daemon 确认不在活跃集才收口；daemon 离线跳过不误收
- 活着但长时间静默的任务（daemon 注册表在）永不被收口——无任何时间启发式参与死判
- 清扫行标记与复活分支保留（误收自愈）；真实终态吸收不回归
- daemon bundle 重建通过、后端测试全绿（新用例：确认收/确认留/离线跳过/会话终态直收）+ 既有 agent_session_tasks 回归

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. daemon session_live_tasks RPC 返回该会话注册表活跃 task_id 列表（未注册会话=空表）
2. 后端清扫：会话终态行直接收口；活跃会话行经 daemon 确认不在活跃集才收口；daemon 离线跳过不误收
3. 活着但长时间静默的任务（daemon 注册表在）永不被收口——无任何时间启发式参与死判
4. 清扫行标记与复活分支保留（误收自愈）；真实终态吸收不回归
5. daemon bundle 重建通过、后端测试全绿（新用例：确认收/确认留/离线跳过/会话终态直收）+ 既有 agent_session_tasks 回归

## 成功标准（可验证）

1. daemon session_live_tasks RPC 返回该会话注册表活跃 task_id 列表（未注册会话=空表）
2. 后端清扫：会话终态行直接收口；活跃会话行经 daemon 确认不在活跃集才收口；daemon 离线跳过不误收
3. 活着但长时间静默的任务（daemon 注册表在）永不被收口——无任何时间启发式参与死判
4. 清扫行标记与复活分支保留（误收自愈）；真实终态吸收不回归
5. daemon bundle 重建通过、后端测试全绿（新用例：确认收/确认留/离线跳过/会话终态直收）+ 既有 agent_session_tasks 回归
