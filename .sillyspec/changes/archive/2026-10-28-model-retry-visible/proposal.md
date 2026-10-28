---
author: flow-machine-draft
created_at: 2026-10-27T23:39:20.199Z
---
# 提案书（Proposal）— 2026-10-28-model-retry-visible

## 动机

任务原话转写：模型限流重试过程实时可见——复用COMPACT_STATUS协议行通道透传api_retry

动机与背景：会话轮内模型 API 限流（智谱 429/1311）时 claude CLI 指数退避重试约 3 分钟，期间 SDK 逐次发出 system/api_retry 帧（attempt/max_retries/retry_delay_ms/error_status/error），但 daemon 归一化器白名单（init/task_*/thinking_tokens/status）不含 api_retry，帧被丢弃，平台零事件，前端 turn-status-bar 段树空、恒显示兜底文案「思考中」，用户无法区分正常慢与卡死（实测两会话 2026-10-27 各卡 3 分钟后静默失败）。仓库已有同构先例 ql-20260917-006：daemon 把上下文压缩过程状态经 onTurnMessage 落 [COMPACT_STATUS] 协议行（stdout 文本行，backend 不产文本行仅落库+SSE 透传），前端 session-log-assembler 分类后运行中轮实时显示「上下文正在重新压缩」。本变更照此先例把 api_retry 接入同一通道，backend 零 schema 改动。

成功标准：
- daemon 归一化器把 system/api_retry 帧转为 status 事件（metadata 含 attempt/max_retries/retry_delay_ms/error_status/error 摘要），session-manager 分发为新 case，经 onTurnMessage 落 [MODEL_RETRY] 单行 JSON 协议行（对齐 COMPACT_STATUS 形态；error 文本截断防超长）
- 前端 session-log-assembler 新增 kind=model_retry 分类；运行中轮时间线实时显示「模型限流重试中 第N/M次」类提示（含错误摘要可读文案），终态轮不在对话正文渲染
- 纯可观测性透传：不改变 CLI/daemon 重试行为本身，不改 backend 表结构
- daemon 与前端新增单测覆盖：归一化 api_retry 帧、分发落行、前端分类与渲染；相关既有测试不回归

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. daemon 归一化器把 system/api_retry 帧转为 status 事件（metadata 含 attempt/max_retries/retry_delay_ms/error_status/error 摘要），session-manager 分发为新 case，经 onTurnMessage 落 [MODEL_RETRY] 单行 JSON 协议行（对齐 COMPACT_STATUS 形态；error 文本截断防超长）
2. 前端 session-log-assembler 新增 kind=model_retry 分类；运行中轮时间线实时显示「模型限流重试中 第N/M次」类提示（含错误摘要可读文案），终态轮不在对话正文渲染
3. 纯可观测性透传：不改变 CLI/daemon 重试行为本身，不改 backend 表结构
4. daemon 与前端新增单测覆盖：归一化 api_retry 帧、分发落行、前端分类与渲染；相关既有测试不回归

## 成功标准（可验证）

1. daemon 归一化器把 system/api_retry 帧转为 status 事件（metadata 含 attempt/max_retries/retry_delay_ms/error_status/error 摘要），session-manager 分发为新 case，经 onTurnMessage 落 [MODEL_RETRY] 单行 JSON 协议行（对齐 COMPACT_STATUS 形态；error 文本截断防超长）
2. 前端 session-log-assembler 新增 kind=model_retry 分类；运行中轮时间线实时显示「模型限流重试中 第N/M次」类提示（含错误摘要可读文案），终态轮不在对话正文渲染
3. 纯可观测性透传：不改变 CLI/daemon 重试行为本身，不改 backend 表结构
4. daemon 与前端新增单测覆盖：归一化 api_retry 帧、分发落行、前端分类与渲染；相关既有测试不回归
