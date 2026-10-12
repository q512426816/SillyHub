---
author: flow-machine-draft
created_at: 2026-10-12T06:43:13.857Z
---
# 提案书（Proposal）— 2026-10-12-run-level-change-attribution

## 动机

任务原话转写：动机：一个会话先后执行多个变更（sillyspec run / flow 两命令族）时，交互轮 AgentRun 创建不带变更锚点（agent/service.py:1910、daemon/session/service/inject.py:608 change_id 恒 None），变更执行用量聚合（change/usage_service.py R-03 口径）把绑定会话的全部 run 完整摊给每个绑定变更，导致每个变更行显示同一组会话总和数字，无法区分各变更真实消耗；参考本地 CLI 水位差分（2026-10-03-local-usage-segment-attribution）思想改为轮级归属。
成功标准：
- 会话轮消息中出现 sillyspec run/flow --change 命令后，平台记录会话级「当前变更上下文」（agent_sessions 新列），后续新开轮（inject）创建的 AgentRun.change_id 记为该上下文
- bind_session_to_change 返回变更 id 供 run_sync 通道回写上下文；platform_sync agent-logs 通道绑定行为不变
- 变更用量聚合口径调整：带 change_id 的 run 独占归该变更；change_session_links 会话链路只认领 change_id 为空的 run（存量无锚 run 行为不变，防回归）
- 同一会话先后执行两个变更（打锚后）时，两个变更的执行用量统计互不相同且各只含自己时段的轮
- 既有 usage_stats 与相关 binding 测试全部通过，并新增打锚与聚合拆分用例

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 会话轮消息中出现 sillyspec run/flow --change 命令后，平台记录会话级「当前变更上下文」（agent_sessions 新列），后续新开轮（inject）创建的 AgentRun.change_id 记为该上下文
2. bind_session_to_change 返回变更 id 供 run_sync 通道回写上下文；platform_sync agent-logs 通道绑定行为不变
3. 变更用量聚合口径调整：带 change_id 的 run 独占归该变更；change_session_links 会话链路只认领 change_id 为空的 run（存量无锚 run 行为不变，防回归）
4. 同一会话先后执行两个变更（打锚后）时，两个变更的执行用量统计互不相同且各只含自己时段的轮
5. 既有 usage_stats 与相关 binding 测试全部通过，并新增打锚与聚合拆分用例

## 成功标准（可验证）

1. 会话轮消息中出现 sillyspec run/flow --change 命令后，平台记录会话级「当前变更上下文」（agent_sessions 新列），后续新开轮（inject）创建的 AgentRun.change_id 记为该上下文
2. bind_session_to_change 返回变更 id 供 run_sync 通道回写上下文；platform_sync agent-logs 通道绑定行为不变
3. 变更用量聚合口径调整：带 change_id 的 run 独占归该变更；change_session_links 会话链路只认领 change_id 为空的 run（存量无锚 run 行为不变，防回归）
4. 同一会话先后执行两个变更（打锚后）时，两个变更的执行用量统计互不相同且各只含自己时段的轮
5. 既有 usage_stats 与相关 binding 测试全部通过，并新增打锚与聚合拆分用例
