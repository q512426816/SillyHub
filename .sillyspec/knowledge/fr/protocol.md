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

## FR-protocol-009 变更中心展示平台同步处理区
变更：2026-09-04-conflict-resolve-entry
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given workspace 已绑定 daemon 且机器 sillyspec_status 含未决冲突（pending_conflicts）或 ghost 残留（gho；When 用户打开变更中心页 用户打开变更中心页；Then 「解析警告」卡之后渲染「平台同步」卡片：冲突行（类型徽章 spec 树/进度、变更名、活跃警示徽章）与 ghost 区（计数+清单+清理按钮）按原型 proto
全文：.sillyspec/changes/archive/2026-09-04-conflict-resolve-entry/requirements.md#FR-01
最近确认：0d7e66502

## FR-protocol-010 冲突一键裁决（保本地/取平台）
变更：2026-09-04-conflict-resolve-entry
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 用户具备操作权限（FR-04）且机器在线 冲突对应的变更是活跃变更（冲突名出现在 sillyspec_status.changes[]） 机器离线或 WS 下发；When 点击冲突行的「保本地」或「取平台」并在确认弹窗中确认 打开确认弹窗 提交裁决；Then backend 经 WS 下发 `daemon:sillyspec_resolve`（payload 含 change + strategy keep_loca
全文：.sillyspec/changes/archive/2026-09-04-conflict-resolve-entry/requirements.md#FR-02
最近确认：0d7e66502

## FR-protocol-011 ghost 一键清理
变更：2026-09-04-conflict-resolve-entry
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 用户具备操作权限（FR-04）且 ghost_count > 0 ghost_count = 0；When 点击「一键清理 ghost」并在确认弹窗（如实写明波及范围：幽灵记录 + 超 7 天空壳目录）中确认 卡片渲染
全文：.sillyspec/changes/archive/2026-09-04-conflict-resolve-entry/requirements.md#FR-03
最近确认：0d7e66502

## FR-protocol-012 操作权限
变更：2026-09-04-conflict-resolve-entry
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 当前用户是机器所有者（machine.owner.user_id === user.id）或平台管理员 当前用户非上述两者；When 查看平台同步卡片 查看平台同步卡片；Then 可见并可用操作按钮 仅显示只读清单（无按钮）；直调 REST 端点返回 404（backend `_get_owned_instance` 越权与不存在同语义）
全文：.sillyspec/changes/archive/2026-09-04-conflict-resolve-entry/requirements.md#FR-04
最近确认：0d7e66502

## FR-protocol-013 执行结果心跳回显
变更：2026-09-04-conflict-resolve-entry
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 指令已下发且 daemon 执行完毕 下发后 150s（执行上限 120s + 一个心跳周期）无匹配回报（如旧 daemon 静默忽略） daemon 同一时刻；When 下一次心跳（默认 15s）到达 到达超时 新指令到达；Then daemon 携带 `sillyspec_command_result`（action/change/strategy/state/exit_code/erro
全文：.sillyspec/changes/archive/2026-09-04-conflict-resolve-entry/requirements.md#FR-05
最近确认：0d7e66502
