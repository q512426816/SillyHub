## FR-protocol-001 启动供应商(set_default)触发热切换 + 凭证探测
变更：2026-08-06-provider-switch-live-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 用户有 active 交互式会话正在用旧供应商；When 用户在 /settings/providers 启动新供应商(set_default)；Then 后端先用新凭证做轻量探测请求验证有效 探测通过 → 设默认 → 通知 daemon 热切换到新供应商(当前回复完成后生效) 探测失败 → 不改默认、不通知、会话
全文：.sillyspec/changes/archive/2026-08-06-provider-switch-live-session/requirements.md#FR-01
最近确认：db90fa171

## FR-protocol-002 停止供应商(unset_default)触发热切换回退本机
变更：2026-08-06-provider-switch-live-session
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户有 active 交互式会话正在用某平台供应商；When 用户停止该供应商(unset_default,导致无默认)；Then 后端通知 daemon 热切换(provider_config=null) daemon 重启子进程时用宿主机 ~/.claude 本机凭证 本机未配凭证时子进
全文：.sillyspec/changes/archive/2026-08-06-provider-switch-live-session/requirements.md#FR-02
最近确认：db90fa171

## FR-protocol-003 后端查 active 会话 + WS 推送 PROVIDER_CONFIG_CHANGED
变更：2026-08-06-provider-switch-live-session
状态：active
摘要：默认场景
依据决策：D-001@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 默认供应商变更(set/unset)成功；When 后端查询该用户 active interactive session(`status IN ('active','reconnecting')`)；Then 按归属 daemon_id 分组 经 `ws_hub.send_session_control` 推送 PROVIDER_CONFIG_CHANGED(含 se
全文：.sillyspec/changes/archive/2026-08-06-provider-switch-live-session/requirements.md#FR-03
最近确认：db90fa171

## FR-protocol-004 daemon 接收 + 延迟到 turn 边界切换
变更：2026-08-06-provider-switch-live-session
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given daemon 收到某 session 的 PROVIDER_CONFIG_CHANGED；When 该会话空闲(无在跑 turn / currentRunId 空) 该会话正在生成(turn in-flight)；Then 立即 reloadWithProvider 重启 仅标记 pendingSwitch 不中断,等 _onResult(turn 完成)再 reload
全文：.sillyspec/changes/archive/2026-08-06-provider-switch-live-session/requirements.md#FR-04
最近确认：db90fa171

## FR-protocol-005 session-manager 受控重启保留对话上下文(resume)
变更：2026-08-06-provider-switch-live-session
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 会话触发 reload(provider_config 新值或 null)；When 执行 reloadWithProvider；Then close 旧子进程(SDK kill 链)+ 用新 env `driver.start({resume: agentSessionId})` SDK 从 `~
全文：.sillyspec/changes/archive/2026-08-06-provider-switch-live-session/requirements.md#FR-05
最近确认：db90fa171

## FR-protocol-006 provider_config 构造逻辑复用
变更：2026-08-06-provider-switch-live-session
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given claim 与 set_default 都需构造中性 ProviderConfig；When 抽取 `resolve_default_provider_config` helper；Then claim 的 `_inject_provider_config` 与 set_default 共用同一构造逻辑(单一真相源) 无默认供应商时返回 None
全文：.sillyspec/changes/archive/2026-08-06-provider-switch-live-session/requirements.md#FR-06
最近确认：db90fa171

## FR-protocol-007 前端切换结果反馈
变更：2026-08-06-provider-switch-live-session
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given set/unset_default 返回 `{switched, affected_sessions, error?}`；When 切换成功 凭证失败；Then 提示「已切换,N 个运行中会话将在当前回复完成后生效」(停止提示回退本机) 提示具体错误原因
全文：.sillyspec/changes/archive/2026-08-06-provider-switch-live-session/requirements.md#FR-07
最近确认：db90fa171

## FR-protocol-008 凭证失败回滚不破坏运行中会话
变更：2026-08-06-provider-switch-live-session
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given set_default 凭证探测失败；When 回滚；Then is_default 不变、不推送、运行中会话完全不受影响
全文：.sillyspec/changes/archive/2026-08-06-provider-switch-live-session/requirements.md#FR-08
最近确认：db90fa171
