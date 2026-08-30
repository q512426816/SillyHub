---
author: qinyi
created_at: 2026-08-23 21:12:30
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在会话详情查看本地 Agent 会话（tool_report）日志内容的开发者 |
| daemon | 宿主机守护进程，持有本地日志文件，负责解析 |
| backend | 平台后端，负责鉴权与 RPC 透传 |

## 功能需求

### FR-01: zcode 日志对话化渲染
覆盖决策：D-001@v1, D-002@v1, D-004@v1, D-005@v1, D-006@v1

Given 本地 Agent 会话下一条 `format=zcode-model-io-jsonl` 的日志条目
When 用户点击「查看内容 ▾」
Then 面板以对话流渲染：user_input 用户气泡、reply 走 Markdown、thinking 折叠块、
tool_use/tool_result 按 `tool_use_id` 配对成可展开工具卡片；无对应 result 的
tool_use 显示「结果未记录」徽章（非「执行中」）

Given 日志内容含 role=system 消息、request.body.system/tools、user 内容内嵌
`<system-reminder>` 块
When 解析产出消息段
Then 以上内容一律不进入 NormalizedLogMessage（剥离后为空的 user 消息整条丢弃）

### FR-02: daemon 本地解析与 KB 级传输
覆盖决策：D-001@v1, D-004@v1, D-006@v1

Given zcode 日志文件存在于 daemon 宿主机且在 allowed_roots 白名单内
When backend 经 ws rpc 调 `host_fs.read_agent_log_messages {path, format}`
Then daemon 本地全量读文件（预算 20MB 上限）、按绝对 offset 对齐合并
full/delta/tail 窗口、以合并序列为历史权威 + 末行 response 补尾 + 同文去重，
返回归一化消息（跨网络 KB 级），坏行跳过计数、占比>50% 返回 status=parse_error

### FR-03: 失败回落与兼容
覆盖决策：D-003@v1, D-006@v1

Given 任一情形：format 无解析器（unsupported）/ 解析失败（parse_error）/ 文件超
预算（too_large）/ 老 daemon 无该方法（HTTP 422）/ 文件被轮换（404）/ 白名单拒绝
（409）
When 前端请求 messages 端点
Then 一律静默回落现有原文 `<pre>` 查看或沿用既有错误文案，不弹错误框；
旧 content 端点保留不删

### FR-04: 二进制格式维持拦截
覆盖决策：D-002@v1

Given format 含 sqlite/zstd 的日志条目
When 请求 messages 端点
Then 维持既有 409「二进制暂不支持」语义（复用共享 helper 黑名单）

### FR-05: 段窗口与加载更早
覆盖决策：D-005@v1

Given 会话段数超过 200
When 请求 messages 端点
Then 返回最近 200 段 + truncated=true + total_segments；
When 用户点「加载更早」带 before_seq 再请求
Then daemon 无状态重解析按 seq 切片返回更早窗口（seq 不连续以最新解析为准）

## 非功能需求

- 兼容性：老 daemon（无新 RPC）→ 422 回落；未使用新端点时现有行为零变化；
  部署顺序无强依赖。
- 可回退：新链路任何失败均有原文查看兜底（FR-03）；不删旧端点。
- 可测试：解析器纯函数可注入 fixture（三 kind 交错/坏行/截断/配对）；
  status 分层（200+status）与 throw 通道（404/409/422/502/504）分别可断言。
- 隐私：system 内容与 reminder 永不渲染（FR-01 第二 GWT）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02 | 解析在 daemon 本地，backend 零解析，前端零格式知识 |
| D-002@v1 | FR-01, FR-04 | MVP 仅 zcode；二进制维持 409 |
| D-003@v1 | FR-03 | 失败静默回落原文，旧端点保留 |
| D-004@v1 | FR-01, FR-02 | 方案 A 四段式落地 |
| D-005@v1 | FR-01, FR-05 | 对话化交互 + 段窗口按确认原型 |
| D-006@v1 | FR-01, FR-02, FR-03 | 格式事实/前端直构/错误双通道三裁决 |
