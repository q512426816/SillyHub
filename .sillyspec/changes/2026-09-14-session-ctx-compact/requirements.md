---
author: qinyi
created_at: 2026-09-14 10:55:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 会话用户 | 长会话中在环浮层触发压缩回收上下文，立即看到回执与下一轮环回落 |
| 引擎接入开发者 | 未来接入新引擎，caps.compact 契约与 driver 可选方法指引防漏 |

## 功能需求

### FR-01: caps 第 12 键 compact
覆盖决策：D-001@v1
Given ProviderCaps 单源加 compact 键（claude/pi/codex=true、cursor=false、未知回退 false）
When gen 脚本三端生成 + 双守护测试同步
Then 新引擎漏声明即 satisfies 编译红 + 守护测试红；前端按钮门控与 backend 端点校验有真数据源

### FR-02: 统一端点双分路
覆盖决策：D-002@v1, D-003@v3
Given POST /api/daemon/sessions/{id}/compact（归属+caps+状态三校验）
When claude → 复用 inject 服务发 "/compact"（建 run；DaemonSessionTurnConflict 捕获映射 error）
Then 响应含 run_id/queued；When pi/codex → ws_hub.send_rpc('session_compact', timeout=15)
Then RPC result 映射 tokens_before/estimated_tokens_after（pi）或受理（codex）；三类 RPC 异常映射结构化 error

### FR-03: claude 分路
Given caps.compact=true 且会话空闲
When 用户点压缩
Then inject 通道下发 /compact 文本，SDK 处理 slash，压缩轮作为正常 turn 收敛并在会话流可见；daemon 零改动

### FR-04: pi 分路
Given session_compact RPC 到达 daemon
When session-manager 守卫通过后 PiRpcDriver.compact() 发 {"type":"compact"} 等 response
Then 回执 tokensBefore/estimatedTokensAfter 进 CompactResult → RPC result → 端点响应 → 前端通知带数字

### FR-05: codex 分路
Given 同 FR-04
When CodexAppServerDriver.compact() 经新 id→pending 机制发 thread/compact/start {threadId} 等 response
Then 受理（空响应）→ ok=true 无数字；超时/错误如实回传

### FR-06: 前端按钮
Given 环浮层提供 onCompact 且 caps.compact=true
When turn running → 按钮禁用（tooltip 轮运行中）；预会话不渲染；cursor 引擎不渲染
When 点击 → compactSession() 调端点
Then 三分型成功通知（pi 数字/codex 受理/claude 已发送）或失败通知带 error 原文

### FR-07: 结果呈现
覆盖决策：D-004@v1
Given 压缩完成回执在端点响应中
Then 前端通知呈现；claude 流可见性由 /compact 轮承载；环分子在压缩后下一次调用 usage 到达自然回落（零改动链）

### FR-08: 真机验证
Given 本机三引擎会话各一轮压缩
Then pi 通知带数字、claude 会话流出现压缩轮、codex 受理通知；三引擎下一轮环回落；R-01/02/03 风险点各有真机结论

## 非功能需求

- 兼容性：旧 daemon → DaemonRpcRemoteError 结构化 error 提示升级；cursor/未知引擎三层拒绝；既有 inject/queue 端点与 AgentEvent schema 零变化
- 可回退：claude caps 降 false 即隐藏按钮（R-01 降级路径）；caps 生成响亮失败守卫保持
- 可测试：session-manager 六守卫单测、pi/codex driver 命令形态与超时、codex pending 机制独立单测、backend 三校验与异常映射、前端三分支

## 决策覆盖矩阵（如存在 decisions.md）

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR 全集 | v1 仅手动 |
| D-002@v1 | FR-02/06 | 仅空闲（backend 校验+前端禁用+session-manager 守卫三层） |
| D-003@v3 | FR-02/03/04/05 | 双分路 + ws RPC 回传（三轮审查定案） |
| D-004@v1 | FR-06/07 | 响应回执 + 三分型通知呈现 |
