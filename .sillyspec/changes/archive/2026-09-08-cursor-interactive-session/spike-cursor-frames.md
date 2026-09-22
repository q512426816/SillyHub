---
author: qinyi
created_at: 2026-09-08 14:45:00
---

# Spike 记录：cursor-agent stream-json 真实帧形状（task-01 实测）

> 采集环境：本机 cursor-agent 2026.06.16-20-30-07-a07d3ac（版本目录入口直跑），登录账户 Free 计划（**须 `--model auto`**），命令形如 `node.exe index.js -p --output-format stream-json --force --trust --model auto "<prompt>"`。
> 样本：`sillyhub-daemon/tests/fixtures/cursor/`（turn1-fresh 8 帧 / turn2-resume 6 帧 / create-chat-probe 12 帧 / tool-use-probe 16 帧，逐行 JSON.parse 校验过，脱敏扫描无残留）。

## 验证结论（A 帧形状 / B resume / C create-chat）

- **A 通过**：system/init 帧存在且带 `session_id`（7 键：type/subtype=init/apiKeySource/cwd/session_id/model/permissionMode）。
- **B 通过**：`--resume <session_id>` 记忆连续（暗号 Zebra-42 复述成功）；resume 后所有帧 session_id 与入参同值，同一 ID 空间；服务端恢复历史（cacheReadTokens=15232）。
- **C 通过**：`create-chat` 输出**裸 UUID 文本**（非 JSON，按行 trim 解析）；该 ID 可作 `--resume` 目标，与帧内 session_id 同空间。

## 真实帧型清单（与 claude stream-json 的差异——归一化器映射依据）

| 帧型（type） | 形状要点 | 归一化去向 |
|---|---|---|
| system (init) | session_id + model + permissionMode + apiKeySource + cwd | status/session_started（携 session_id） |
| user | **每轮回显用户 prompt**（message.content=[{type:text}]）——claude 仅 tool_result 时发 user 帧 | 忽略（不透传，防重复渲染） |
| assistant | message.content 块数组，实测仅 {type:text,text} 块；**无 tool_use 块**、无 message 级 usage/id | text（逐块） |
| thinking（顶层帧） | **非 assistant content 块**；subtype=delta（增量 text）/completed（无 text） | delta→thinking（is_partial 流式）；completed→吸收/标记完成 |
| tool_call（顶层帧） | subtype=started/completed；字段 call_id / tool_call（判别联合如 shellToolCall）/ model_call_id；completed 带 result.success.{exitCode,stdout,stderr,executionTime} | started→tool_use（tool_name 从 tool_call 判别键映射，原生保留）；completed→tool_result（call_id 配对，stdout/stderr 进 content） |
| result | subtype=success；duration_ms/duration_api_ms/is_error/result/session_id/request_id/**usage（camelCase：inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens）** | turn_result + usage 四字段短名映射（input/output/cache_read/cache_creation）+ session_id |
| connection | reconnecting/reconnected（attempt/endpoint_url） | 忽略（传输层） |
| retry | starting（attempt/is_resume） | 忽略或降级 status/task_notification |

## 设计影响（已回填 design.md / 任务卡）

1. **usage 命名空间 camelCase**——归一化器加映射层（inputTokens→input_tokens 等）。
2. **thinking 是顶层帧**、工具调用走独立 `tool_call` 帧对——**不能复用 claude 的 content-block 遍历路径**，映射表按上表重写（design 修正）。
3. 实测存在稳定 thinking 帧型 → caps.thinking 可随归一化器映射翻 true（fixture 有样本）。
4. `create-chat` 裸 UUID 解析规则进 driver（兜底来源）。
5. `tool_call.call_id` 字符串内含字面 `\n`——下游按 call_id 拼接/分行逻辑需注意（记录在案）。
6. R-01（帧结构假设）/R-02（chatId ID 空间）两大 P0 风险**解除**：均有实证。
