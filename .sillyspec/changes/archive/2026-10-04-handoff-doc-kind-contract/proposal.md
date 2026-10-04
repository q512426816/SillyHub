---
author: flow-machine-draft
created_at: 2026-10-04T14:48:49.718Z
---
# 提案书（Proposal）— 2026-10-04-handoff-doc-kind-contract

## 动机

任务原话转写：动机：takeover handoff 档交接文档对真实日志全空（用户实测：200 条消息只余工具名节、工作目录 unknown）——build_handoff_prompt 判 kind=='user'/'assistant' 但消息契约是 user_input/reply/thinking/tool_use/tool_result 五值（platform_sync/schema.py:513 钉死），两分支恒不命中；tool_input 契约是 JSON 字符串摘要非 dict，涉及文件节恒空；_build_handoff_first_prompt 的 cwd 只读会话行（建桶不写恒空）不回退 entry 级 agent_cwd。
成功标准：
- build_handoff_prompt 按 kind 五值契约组装：user_input（sender=system_event 跳过）→ 用户行、reply → 助手行（500 截断）、thinking 跳过、tool_use → 操作行+文件提取、tool_result 失败标记回贴配对 tool_use
- tool_input 兼容 JSON 字符串（含 2KB 截断致 json 解析失败的 regex 兜底）与 dict 双形态，涉及文件节真实数据可产出
- _build_handoff_first_prompt 的 cwd 会话行优先、空则回退所选 entry 的 agent_cwd（与 tier3 同口径）
- 测试改用真实契约消息形态，覆盖 system_event 跳过/失败回贴/截断 JSON 兜底/cwd 回退，takeover+handoff 相关测试全绿

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. build_handoff_prompt 按 kind 五值契约组装：user_input（sender=system_event 跳过）→ 用户行、reply → 助手行（500 截断）、thinking 跳过、tool_use → 操作行+文件提取、tool_result 失败标记回贴配对 tool_use
2. tool_input 兼容 JSON 字符串（含 2KB 截断致 json 解析失败的 regex 兜底）与 dict 双形态，涉及文件节真实数据可产出
3. _build_handoff_first_prompt 的 cwd 会话行优先、空则回退所选 entry 的 agent_cwd（与 tier3 同口径）
4. 测试改用真实契约消息形态，覆盖 system_event 跳过/失败回贴/截断 JSON 兜底/cwd 回退，takeover+handoff 相关测试全绿

## 成功标准（可验证）

1. build_handoff_prompt 按 kind 五值契约组装：user_input（sender=system_event 跳过）→ 用户行、reply → 助手行（500 截断）、thinking 跳过、tool_use → 操作行+文件提取、tool_result 失败标记回贴配对 tool_use
2. tool_input 兼容 JSON 字符串（含 2KB 截断致 json 解析失败的 regex 兜底）与 dict 双形态，涉及文件节真实数据可产出
3. _build_handoff_first_prompt 的 cwd 会话行优先、空则回退所选 entry 的 agent_cwd（与 tier3 同口径）
4. 测试改用真实契约消息形态，覆盖 system_event 跳过/失败回贴/截断 JSON 兜底/cwd 回退，takeover+handoff 相关测试全绿
