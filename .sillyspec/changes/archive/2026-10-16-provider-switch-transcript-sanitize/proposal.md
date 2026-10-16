---
author: flow-machine-draft
created_at: 2026-10-16T08:32:38.925Z
---
# 提案书（Proposal）— 2026-10-16-provider-switch-transcript-sanitize

## 动机

任务原话转写：切供应商时清洗历史里不可重放的供应商私有工具块

动机与背景：会话历史跨供应商重放会硬失败。实证（SillyHub 会话 f231ca18 第 36 轮，引擎会话 0f782746，CLI 2.1.229，2026-10-16 16:03）：GLM（glm-5.3）在该会话历史里留下 2 个 server_tool_use 块（工具名 analyze_image，GLM 侧服务端工具），且同一条 assistant 消息里挂着同 id 的 tool_result；宿主机 ~/.claude/settings.json 档位切到 MiniMax 后（16:02:54，本机默认会话）重放该历史，MiniMax 的 Anthropic 兼容端点直接 400：API Error: 400 invalid params, tool result's tool id(call_0a26d3a2b8dd4a7e9c5fe566) not found (2013)。历史每轮全量重放 → 该会话在新供应商下永久失败、不自愈；平台内切换供应商路径同理会把该历史发给新供应商。
本地已复核：用同版本 CLI + 本地假端点抓出真实出站请求体（637 条消息/2.59MB），第 406、575 条 assistant 消息同时含 server_tool_use 与同 id tool_result —— 即 Anthropic 协议里不可跨供应商重放的形态（供应商只认 tool_use 配对）。

成功标准：
- 平台内切换供应商（reload 检测到 provider 变更）时，resume 前对 claude transcript 做历史清洗：把 server_tool_use / mcp_tool_use 块及引用它们的配对结果块替换为等价 text 块，保留原文本信息；原文件先备份；记录条数与 uuid/parentUuid 链不变；清洗失败仅 warn，绝不阻断 reload
- 实证形态可修：对 f231ca18 的 transcript 清洗后，出站请求不再含 server_tool_use、不再有无配对 tool_result，且真实供应商（MiniMax Anthropic 兼容端点）接受该请求（实测证据）
- 可读性：模型错误分类器识别该 400 签名，给出可执行中文提示（不再落兜底 运行失败 / hint=null），且不新增 ModelErrorType（daemon/backend/frontend 三端契约零变更）
- 守护测试：清洗内核覆盖 配对 / 同消息 / 无脏块 三类形态 + 记录链路完整 + 备份存在；分类器签名用例；相关 daemon 测试绿、tsc 零错

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 平台内切换供应商（reload 检测到 provider 变更）时，resume 前对 claude transcript 做历史清洗：把 server_tool_use / mcp_tool_use 块及引用它们的配对结果块替换为等价 text 块，保留原文本信息；原文件先备份；记录条数与 uuid/parentUuid 链不变；清洗失败仅 warn，绝不阻断 reload
2. 实证形态可修：对 f231ca18 的 transcript 清洗后，出站请求不再含 server_tool_use、不再有无配对 tool_result，且真实供应商（MiniMax Anthropic 兼容端点）接受该请求（实测证据）
3. 可读性：模型错误分类器识别该 400 签名，给出可执行中文提示（不再落兜底 运行失败 / hint=null），且不新增 ModelErrorType（daemon/backend/frontend 三端契约零变更）
4. 守护测试：清洗内核覆盖 配对 / 同消息 / 无脏块 三类形态 + 记录链路完整 + 备份存在；分类器签名用例；相关 daemon 测试绿、tsc 零错

## 成功标准（可验证）

1. 平台内切换供应商（reload 检测到 provider 变更）时，resume 前对 claude transcript 做历史清洗：把 server_tool_use / mcp_tool_use 块及引用它们的配对结果块替换为等价 text 块，保留原文本信息；原文件先备份；记录条数与 uuid/parentUuid 链不变；清洗失败仅 warn，绝不阻断 reload
2. 实证形态可修：对 f231ca18 的 transcript 清洗后，出站请求不再含 server_tool_use、不再有无配对 tool_result，且真实供应商（MiniMax Anthropic 兼容端点）接受该请求（实测证据）
3. 可读性：模型错误分类器识别该 400 签名，给出可执行中文提示（不再落兜底 运行失败 / hint=null），且不新增 ModelErrorType（daemon/backend/frontend 三端契约零变更）
4. 守护测试：清洗内核覆盖 配对 / 同消息 / 无脏块 三类形态 + 记录链路完整 + 备份存在；分类器签名用例；相关 daemon 测试绿、tsc 零错
