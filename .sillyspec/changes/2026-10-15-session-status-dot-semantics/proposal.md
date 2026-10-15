---
author: flow-machine-draft
created_at: 2026-10-15T06:06:16.365Z
---
# 提案书（Proposal）— 2026-10-15-session-status-dot-semantics

## 动机

任务原话转写：会话列表行内现有两套点：行首状态点（红=失败/绿=已结束/青+光环=active/灰=排队）与行尾活性灯（working 呼吸/blocked/idle/ended），且 active 在本平台语义是「会话开着」而非「正在执行」，两套标识并存导致含义混乱。参考 deepseek-harness 项目 StateDot 五态语义重定义：绿点=执行完成、动态转圈=进行中（含断线恢复中）、红点=异常、琥珀点=在等你、无动态一律留白；行尾活性灯移除并入行首点。
成功标准：
- 行首状态点单一源判定：failed→红点；ended→绿点；活性 working→动态转圈；活性 blocked→琥珀点；reconnecting→动态转圈；其余（active 空闲/pending/suspended/活性 idle/unknown/无活性数据）→零渲染留白
- 终态权威：failed/ended 判定优先于活性信号，终态会话不因陈旧活性数据转圈或琥珀
- 行尾活性小灯移除，悬停详情卡（Popover）与未读红角标迁移到行首点（有活性数据才可悬停出卡，未读角标挂行首槽右上角）
- 批量多选模式行首槽仍为勾选框，状态点与悬停卡零渲染（与现状一致）
- 相关测试更新并通过（session-list-panel 测试 + 门户页测试涉及点），lint 通过

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 行首状态点单一源判定：failed→红点；ended→绿点；活性 working→动态转圈；活性 blocked→琥珀点；reconnecting→动态转圈；其余（active 空闲/pending/suspended/活性 idle/unknown/无活性数据）→零渲染留白
2. 终态权威：failed/ended 判定优先于活性信号，终态会话不因陈旧活性数据转圈或琥珀
3. 行尾活性小灯移除，悬停详情卡（Popover）与未读红角标迁移到行首点（有活性数据才可悬停出卡，未读角标挂行首槽右上角）
4. 批量多选模式行首槽仍为勾选框，状态点与悬停卡零渲染（与现状一致）
5. 相关测试更新并通过（session-list-panel 测试 + 门户页测试涉及点），lint 通过

## 成功标准（可验证）

1. 行首状态点单一源判定：failed→红点；ended→绿点；活性 working→动态转圈；活性 blocked→琥珀点；reconnecting→动态转圈；其余（active 空闲/pending/suspended/活性 idle/unknown/无活性数据）→零渲染留白
2. 终态权威：failed/ended 判定优先于活性信号，终态会话不因陈旧活性数据转圈或琥珀
3. 行尾活性小灯移除，悬停详情卡（Popover）与未读红角标迁移到行首点（有活性数据才可悬停出卡，未读角标挂行首槽右上角）
4. 批量多选模式行首槽仍为勾选框，状态点与悬停卡零渲染（与现状一致）
5. 相关测试更新并通过（session-list-panel 测试 + 门户页测试涉及点），lint 通过
