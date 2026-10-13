---
author: flow-machine-draft
created_at: 2026-10-13T15:10:14.439Z
---
# 提案书（Proposal）— 2026-10-13-change-reparse-autobind-remove

## 动机

任务原话转写：动机：reparse 首建变更行时自动绑定工作区最近活跃会话（D-007）误伤面大——闲聊/测试会话躺着中枪（2026-10-13 阿里云实测：变更 2026-10-13-slim-subagent-false-running 被自动绑上「你好」闲聊会话）；「只绑确实在跑 sillyspec 命令的会话」语义已由命令解析通道（run_sync / agent-logs 的 extract_spec_bindings）完整覆盖，D-007 自动绑定整体移除。
成功标准：
- reparse 首次创建变更行（created）不再写任何 change_session_links，即使工作区存在最近活跃会话
- _bind_change_to_session 方法及其唯一调用点删除，无死代码残留
- reparse docstring 与 .sillyspec/docs/backend/modules/change.md、_module-map.yaml 中「自动绑定最近活跃会话」描述同步更新
- 既有命令解析通道绑定行为不变（test_spec_binding.py 全绿）
- test_change_session_binding.py 重写为断言新行为：存在最近活跃会话时 reparse created 仍零 link，重复 reparse 仍零 link

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. reparse 首次创建变更行（created）不再写任何 change_session_links，即使工作区存在最近活跃会话
2. _bind_change_to_session 方法及其唯一调用点删除，无死代码残留
3. reparse docstring 与 .sillyspec/docs/backend/modules/change.md、_module-map.yaml 中「自动绑定最近活跃会话」描述同步更新
4. 既有命令解析通道绑定行为不变（test_spec_binding.py 全绿）
5. test_change_session_binding.py 重写为断言新行为：存在最近活跃会话时 reparse created 仍零 link，重复 reparse 仍零 link

## 成功标准（可验证）

1. reparse 首次创建变更行（created）不再写任何 change_session_links，即使工作区存在最近活跃会话
2. _bind_change_to_session 方法及其唯一调用点删除，无死代码残留
3. reparse docstring 与 .sillyspec/docs/backend/modules/change.md、_module-map.yaml 中「自动绑定最近活跃会话」描述同步更新
4. 既有命令解析通道绑定行为不变（test_spec_binding.py 全绿）
5. test_change_session_binding.py 重写为断言新行为：存在最近活跃会话时 reparse created 仍零 link，重复 reparse 仍零 link
