---
author: flow-machine-draft
created_at: 2026-10-12T07:28:07.324Z
---
# 提案书（Proposal）— 2026-10-12-backfill-run-change-context

## 动机

任务原话转写：动机：轮级打锚（2026-10-12-run-level-change-attribution）只对新会话生效，存量会话的 run 无 change_id 锚，变更列表执行用量仍显示会话总和；需要按会话消息时间线回填存量 agent_runs.change_id，让历史数据按新口径拆分显示。
成功标准：
- 回填服务按会话内 run 时间序重放 sillyspec 绑定命令游标：run 先按当前游标打锚（无锚才写），再用该 run 消息里的命令更新游标（最后一条生效），与线上运行时语义一致
- 只回填 change_id 为 NULL 的 run，已锚 run（派发）跳过但命令照常推进游标；幂等可重跑
- 命令的 change_key 按（workspace_id, change_key）映射 Change 行，映射不到跳过计数；quicklog 链路与会话链接不改动
- 会话回填结束时把游标终值写 agent_sessions.current_change_id（仅当该会话解析出过命令）
- CLI 脚本默认 dry-run 输出计数，--apply 才落库；支持 --workspace 限定范围
- 测试：同会话先后两变更拆分正确、命令前无锚 run 保持 NULL、幂等重跑结果不变

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. 回填服务按会话内 run 时间序重放 sillyspec 绑定命令游标：run 先按当前游标打锚（无锚才写），再用该 run 消息里的命令更新游标（最后一条生效），与线上运行时语义一致
2. 只回填 change_id 为 NULL 的 run，已锚 run（派发）跳过但命令照常推进游标；幂等可重跑
3. 命令的 change_key 按（workspace_id, change_key）映射 Change 行，映射不到跳过计数；quicklog 链路与会话链接不改动
4. 会话回填结束时把游标终值写 agent_sessions.current_change_id（仅当该会话解析出过命令）
5. CLI 脚本默认 dry-run 输出计数，--apply 才落库；支持 --workspace 限定范围
6. 测试：同会话先后两变更拆分正确、命令前无锚 run 保持 NULL、幂等重跑结果不变

## 成功标准（可验证）

1. 回填服务按会话内 run 时间序重放 sillyspec 绑定命令游标：run 先按当前游标打锚（无锚才写），再用该 run 消息里的命令更新游标（最后一条生效），与线上运行时语义一致
2. 只回填 change_id 为 NULL 的 run，已锚 run（派发）跳过但命令照常推进游标；幂等可重跑
3. 命令的 change_key 按（workspace_id, change_key）映射 Change 行，映射不到跳过计数；quicklog 链路与会话链接不改动
4. 会话回填结束时把游标终值写 agent_sessions.current_change_id（仅当该会话解析出过命令）
5. CLI 脚本默认 dry-run 输出计数，--apply 才落库；支持 --workspace 限定范围
6. 测试：同会话先后两变更拆分正确、命令前无锚 run 保持 NULL、幂等重跑结果不变
