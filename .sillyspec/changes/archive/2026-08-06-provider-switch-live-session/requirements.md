---
author: WhaleFall
created_at: 2026-08-06 15:08:37
---

# 需求规格(Requirements)

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在 /settings/providers 启动/停止默认供应商,期望运行中会话随之切换 |
| 运行中会话 | /runtimes 中 active 的交互式 claude 会话,需热切换供应商且保留对话 |

## 功能需求

### FR-01: 启动供应商(set_default)触发热切换 + 凭证探测
覆盖决策:D-001@v1, D-003@v1
Given 用户有 active 交互式会话正在用旧供应商
When 用户在 /settings/providers 启动新供应商(set_default)
Then 后端先用新凭证做轻量探测请求验证有效
Then 探测通过 → 设默认 → 通知 daemon 热切换到新供应商(当前回复完成后生效)
Then 探测失败 → 不改默认、不通知、会话不动、前端提示错误

### FR-02: 停止供应商(unset_default)触发热切换回退本机
覆盖决策:D-004@v1
Given 用户有 active 交互式会话正在用某平台供应商
When 用户停止该供应商(unset_default,导致无默认)
Then 后端通知 daemon 热切换(provider_config=null)
Then daemon 重启子进程时用宿主机 ~/.claude 本机凭证
Then 本机未配凭证时子进程报未登录(预期),前端提示

### FR-03: 后端查 active 会话 + WS 推送 PROVIDER_CONFIG_CHANGED
覆盖决策:D-001@v1, D-005@v1
Given 默认供应商变更(set/unset)成功
When 后端查询该用户 active interactive session(`status IN ('active','reconnecting')`)
Then 按归属 daemon_id 分组
Then 经 `ws_hub.send_session_control` 推送 PROVIDER_CONFIG_CHANGED(含 session_id + provider_config 或 null)
Then 无 active 会话时推送 0 次(no-op)

### FR-04: daemon 接收 + 延迟到 turn 边界切换
覆盖决策:D-002@v1
Given daemon 收到某 session 的 PROVIDER_CONFIG_CHANGED
When 该会话空闲(无在跑 turn / currentRunId 空)
Then 立即 reloadWithProvider 重启
When 该会话正在生成(turn in-flight)
Then 仅标记 pendingSwitch 不中断,等 _onResult(turn 完成)再 reload

### FR-05: session-manager 受控重启保留对话上下文(resume)
覆盖决策:D-002@v1
Given 会话触发 reload(provider_config 新值或 null)
When 执行 reloadWithProvider
Then close 旧子进程(SDK kill 链)+ 用新 env `driver.start({resume: agentSessionId})`
Then SDK 从 `~/.claude/projects/<cwd>/<sid>.jsonl` 重新加载完整对话历史(上下文不丢)
Then 替换 state.query/env,重启 consume,清 pendingSwitch
Then reload 失败 → 保留旧 query + 上报,会话不崩溃

### FR-06: provider_config 构造逻辑复用
覆盖决策:D-006@v1
Given claim 与 set_default 都需构造中性 ProviderConfig
When 抽取 `resolve_default_provider_config` helper
Then claim 的 `_inject_provider_config` 与 set_default 共用同一构造逻辑(单一真相源)
Then 无默认供应商时返回 None

### FR-07: 前端切换结果反馈
Given set/unset_default 返回 `{switched, affected_sessions, error?}`
When 切换成功
Then 提示「已切换,N 个运行中会话将在当前回复完成后生效」(停止提示回退本机)
When 凭证失败
Then 提示具体错误原因

### FR-08: 凭证失败回滚不破坏运行中会话
覆盖决策:D-003@v1
Given set_default 凭证探测失败
When 回滚
Then is_default 不变、不推送、运行中会话完全不受影响

## 非功能需求
- 兼容性:未切换时行为逐字不变;daemon 旧版本忽略未知 WS 消息(向前兼容)
- 可回退:reload 失败保留旧 query(降级不崩溃)
- 可测试:后端/daemon 关键路径有单测;启动切换 + 停止回退 + 生成中等待 + 凭证失败回滚有集成测试
- 安全:api_key 走现有 WS 通道,日志经 redactProviderConfig 守卫
- 跨平台:Windows/Linux/macOS 兼容(SDK kill 链已全平台)

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-03 | WS 推送触发(否决 lease 重claim / 轮询) |
| D-002@v1 | FR-04, FR-05 | 等 turn 边界(否决立即中断) |
| D-003@v1 | FR-01, FR-08 | 凭证失败回滚(否决会话失败) |
| D-004@v1 | FR-02 | 停止也热切换(回退本机) |
| D-005@v1 | FR-03 | 复用 send_session_control |
| D-006@v1 | FR-06 | provider_config helper 抽取 |

无未覆盖决策 / 剩余风险。
