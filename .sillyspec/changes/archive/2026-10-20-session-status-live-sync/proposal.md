---
author: flow-machine-draft
created_at: 2026-10-20T07:02:11.489Z
---
# 提案书（Proposal）— 2026-10-20-session-status-live-sync

## 动机

任务原话转写：左侧会话状态标签与右侧实时同步

用户反馈：会话页左侧列表的进度状态标签与右侧会话内容有延迟，用起来很难受。机制已查明：右侧是逐会话 SSE 推送（run 状态秒级到达），左侧列表依赖 10s/30s 条件轮询 + agent_sessions:changed 哑信号，但后端 publish_sessions_changed 只覆盖会话生命周期事件（创建/终态翻转/lease kill/子会话），run 级状态迁移点全部不发布信号——run 创建（发消息）、pending→running（run_sync/submit_commit.py 激活块）、→pending_approval（agent/coordinator.py request_approval）、approve 恢复 running、多轮会话 run 终态但会话 keep-active（run_sync/close_run_steps.py _close_flip_session else 分支明确零发布）。左侧徽标信号源 current_run_status 恰来自这些 run 状态，导致右侧已执行/已等审批而左侧最长 10~30s 不动；轮询间隔在列表全静默时退化为 30s 进一步放大。

成功标准：
- 后端在上述 run 状态迁移点补发 publish_sessions_changed（复用既有哑信号链路，Redis 抖动静默容错不拖挂业务写路径）
- 前端收到信号后经既有 400ms 去抖失效列表查询，左侧状态标签在 run 状态迁移后秒级（≤2s）更新，与右侧会话状态一致，不再依赖轮询 tick
- 多轮会话 run 完成（会话保持 active）时左侧转圈徽标同样秒级收敛
- 既有信号点（会话创建/终态/删除/群聊 audience）行为零回归
- 新增信号点有单测覆盖；触及的前后端测试全绿

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 后端在上述 run 状态迁移点补发 publish_sessions_changed（复用既有哑信号链路，Redis 抖动静默容错不拖挂业务写路径）
2. 前端收到信号后经既有 400ms 去抖失效列表查询，左侧状态标签在 run 状态迁移后秒级（≤2s）更新，与右侧会话状态一致，不再依赖轮询 tick
3. 多轮会话 run 完成（会话保持 active）时左侧转圈徽标同样秒级收敛
4. 既有信号点（会话创建/终态/删除/群聊 audience）行为零回归
5. 新增信号点有单测覆盖；触及的前后端测试全绿

## 成功标准（可验证）

1. 后端在上述 run 状态迁移点补发 publish_sessions_changed（复用既有哑信号链路，Redis 抖动静默容错不拖挂业务写路径）
2. 前端收到信号后经既有 400ms 去抖失效列表查询，左侧状态标签在 run 状态迁移后秒级（≤2s）更新，与右侧会话状态一致，不再依赖轮询 tick
3. 多轮会话 run 完成（会话保持 active）时左侧转圈徽标同样秒级收敛
4. 既有信号点（会话创建/终态/删除/群聊 audience）行为零回归
5. 新增信号点有单测覆盖；触及的前后端测试全绿
