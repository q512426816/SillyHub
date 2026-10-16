---
author: flow-machine-draft
created_at: 2026-10-16T05:37:22.887Z
---
# 提案书（Proposal）— 2026-10-16-decision-pill-no-workspace

## 动机

任务原话转写：动机：无 workspace 的会话（如 445e12d9，10-09 创建 workspace_id 为空）待决策 pill 不渲染——挂载条件连坐了变更文件 pill 的 workspace_id 门。
成功标准：
- session.workspace_id 为空的会话中，待决策 pill 正常渲染（只要有提问历史/pending）
- 变更文件 pill 在无 workspace 会话维持不渲染（原有显隐契约不变）
- 既有回归测试全绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. session.workspace_id 为空的会话中，待决策 pill 正常渲染（只要有提问历史/pending）
2. 变更文件 pill 在无 workspace 会话维持不渲染（原有显隐契约不变）
3. 既有回归测试全绿

## 成功标准（可验证）

1. session.workspace_id 为空的会话中，待决策 pill 正常渲染（只要有提问历史/pending）
2. 变更文件 pill 在无 workspace 会话维持不渲染（原有显隐契约不变）
3. 既有回归测试全绿
