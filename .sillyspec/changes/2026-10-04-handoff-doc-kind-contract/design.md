---
author: flow-machine-draft
created_at: 2026-10-04T14:48:49.718Z
---
# 设计记录（Design Record）— 2026-10-04-handoff-doc-kind-contract

> 四节每节必答——答案直接写在问题下方；小改动可写「不适用：<理由>」；flow done 空节拒收。
> 需要列改动文件时在「接口契约」节加「文件变更清单」表（| 新增/修改 | 路径 | 说明 |）。

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

改 `backend/app/modules/daemon/session/service/takeover.py` 的 `build_handoff_prompt`（纯函数）：按消息契约（`platform_sync/schema.py:513` 钉死的 kind 五值 `user_input/reply/thinking/tool_use/tool_result`）重组装分支——此前判 `kind=="user"/"assistant"` 是死分支（契约里不存在这两值，真实日志只余 tool_name 进「最近操作」，对话与文件节全空，用户实测 200 条消息只看到 8 个工具名）；`tool_input` 按契约的 JSON 字符串摘要解析（新增 `_collect_tool_files`：json.loads，2KB 截断坏 JSON 用 regex 兜底取首个 path 类键，dict 形态保留兼容）；`_build_handoff_first_prompt` 的 cwd 与 tier3 同口径回退所选 entry 的 `agent_cwd`（会话行 cwd 建桶不写恒空，「工作目录」不再恒 unknown）。选契约对齐而非改 daemon 侧发新 kind：契约本身是对的（前端 /agent-logs/{id}/messages 消费同一份五值），错的是 handoff 组装端自造了一套词表。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

`build_handoff_prompt(harness, cwd, messages, user_prompt, max_chars)` 签名不变、纯函数；行为变化=按 kind 五值契约组装（此前 user/assistant 判断恒不命中，属修复对齐而非语义变更）：user_input（sender=system_event 跳过）→「用户：」行、reply→「助手：」行（500 截断）、thinking 跳过、tool_use→操作行+涉及文件提取、tool_result 的 is_error 按 tool_use_id 回贴配对操作行「（失败）」。`_build_handoff_first_prompt` 内部 cwd 取值加 entry.agent_cwd 回退。HTTP 端点签名无变化。

文件变更清单：

| 新增/修改 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/session/service/takeover.py | build_handoff_prompt 契约对齐 + _collect_tool_files helper + cwd 回退 |
| 修改 | backend/app/modules/daemon/tests/test_takeover_handoff.py | 测试改真实契约消息形态 + 新增截断 JSON 兜底/cwd 回退用例 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：messages 是 daemon 解析器已按全局 seq 重编号的有序窗口，组装按序遍历；tool_result 回贴依赖 tool_use 先于 tool_result 出现（seq 不变式成立）；乱序极端下回贴 miss 只丢「（失败）」标记，不影响其它节。
2. 并发写：纯函数零共享状态、零 IO；`_build_handoff_first_prompt` 只读（entry 查询 + RPC），失败降级路径不变。
3. 切换/生命周期：交接文档只注入新会话首 prompt（一次性写 AgentRunLog），源会话零写红线不变；请求中断=不建接手会话，无中间态。
4. 作用域：messages 按 `agent_session_id == source.id` 过滤后经 RPC 取回，无跨会话混入；tool_use_id 回贴表是单次调用局部变量不跨请求。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：regex 兜底从截断 JSON 提取 path 时，若 path 类键值本身被 2KB 截断切断会取出半截路径进「涉及文件」节（展示性瑕疵，不参与任何匹配/写库）。试过放弃的方案：改 daemon 侧让 tool_input 直接下发结构化 path 字段——要动 RPC 契约 + 老 daemon 兼容窗口 + 前端同步，代价远超收益；JSON 字符串解析在 backend 侧做即可闭环，故弃。
