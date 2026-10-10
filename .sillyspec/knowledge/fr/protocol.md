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

## FR-protocol-014 纯墓碑冲突按被删变更归因记账并自动清理（sillyspec CLI 仓）
变更：2026-10-09-tombstone-conflict-root-fix
状态：active
摘要：纯墓碑拒收归因落盘；归档区路径剥名；全绿同步清陈旧墓碑记录；进度总览透传墓碑形态
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：纯墓碑拒收归因落盘 — Given 本地存在平台已删除变更 `<X>` 的目录路径，CLI 同步收到纯墓碑拒收（版本冲突面为空、`platform_deleted` 非空）；When CLI 落冲突记录；Then 记录文件为 `spec-sync-conflict-<X>.json`（按被删变更名，非当轮同步标签），内容含 `kind:'tombstone'`、`plat
- 场景：归档区路径剥名 — When `platform_deleted` 路径含归档区前缀 `changes/archive/<X>/…`；Then 同样归因到变更 `<X>`；剥不出变更名的路径归入 `__unattributed__` 聚合记录
- 场景：全绿同步清陈旧墓碑记录 — Given `.runtime/` 下存在纯墓碑形态记录（`conflicting_paths` 为空且 `platform_deleted` 非空——kind 无关，涵盖；When 本轮同步全绿（无冲突无拒收）；Then 全部纯墓碑形态记录被删除；混合形态记录（`conflicting_paths` 非空）不受影响
- 场景：进度总览透传墓碑形态 — When `sillyspec progress show --json` 列出未决冲突；Then 墓碑记录的 `type` 为 `'tombstone'`（优先读记录 `kind` 字段，文件名前缀判定保留兜底）
全文：.sillyspec/changes/archive/2026-10-09-tombstone-conflict-root-fix/requirements.md#FR-01
最近确认：2f6d52515

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-tombstone-conflict-root-fix:task-05:acc-0-a99023d4
  tests: src/spec-sync.js | test/spec-sync-tombstone-attribution.test.mjs
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-05:acc-1-c2f76477
  tests: src/spec-sync.js | test/spec-sync-tombstone-attribution.test.mjs
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-05:acc-2-98534e2e
  tests: src/spec-sync.js | test/spec-sync-tombstone-attribution.test.mjs
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-05:acc-3-99da3d1a
  tests: src/spec-sync.js | test/spec-sync-tombstone-attribution.test.mjs
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active

## FR-protocol-015 前端冲突行识别墓碑形态并露出根因
变更：2026-10-09-tombstone-conflict-root-fix
状态：active
摘要：墓碑行渲染；普通版本冲突行不变；收敛按钮与回显
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：墓碑行渲染 — Given backend spec-conflicts 注册表开放行（status=open）满足纯墓碑判定——`details_json.platform_delete；When 变更中心「平台同步」卡渲染冲突行；Then 该行显示「平台已删」徽章（error 语义色）+ 被删变更名（真凶）+ 非版本冲突说明（裁决无效+恢复指引），**不显示**「查看对比」与裁决入口；数据源为注册
- 场景：普通版本冲突行不变 — Given 冲突行未命中墓碑判定；When 渲染；Then 与现状渲染一致（type 徽章/名称/时间/查看对比/活跃警示）
- 场景：收敛按钮与回显 — Given 用户对墓碑行点「收敛本机目录」（权限=机器所有者/平台管理员，同裁决权限集）；When 后端下发 tombstone_cleanup 指令成功；Then 行内回显「已下发·等待机器回报」→ 心跳 `sillyspec_command_result`（action='tombstone_cleanup' 且 cha
全文：.sillyspec/changes/archive/2026-10-09-tombstone-conflict-root-fix/requirements.md#FR-02
最近确认：2f6d52515

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-tombstone-conflict-root-fix:task-04:acc-0-db7a90fd
  tests: frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-04:acc-1-16400291
  tests: frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-04:acc-2-3af70223
  tests: frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-04:acc-3-ce315e5f
  tests: frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active

## FR-protocol-016 平台删除变更时下发本机收敛指令
变更：2026-10-09-tombstone-conflict-root-fix
状态：active
摘要：删除环自动下发；daemon 执行器隔离区收敛；执行器幂等
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：删除环自动下发 — Given 平台删除变更 `<X>`（墓碑落库完成）且该工作区有绑定数据源机器；When 删除流程收敛环执行；Then 经 WS 通道下发 `daemon:sillyspec_tombstone_cleanup`（payload 含 change 与 workspace_id）；
- 场景：daemon 执行器隔离区收敛 — When daemon 收到 tombstone_cleanup 指令；Then 按 workspace_id 映射定位 spec 根（未命中报 `workspace_root_unknown` 不回退单槽位）；把 `changes/<X>/
- 场景：执行器幂等 — When 指令重放/重试时本机目录已不在（已收敛或从未存在）；Then 回执 state=success，error 注明「目录已不在本地」，无副作用
全文：.sillyspec/changes/archive/2026-10-09-tombstone-conflict-root-fix/requirements.md#FR-03
最近确认：2f6d52515

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-tombstone-conflict-root-fix:task-01:acc-0-d1244a4b
  tests: backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-01:acc-1-fc1cea71
  tests: backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-01:acc-2-79bc5459
  tests: backend/app/modules/daemon/tests/test_machine_tombstone_cleanup.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-02:acc-0-45e3a3da
  tests: backend/app/modules/change/tests/test_delete_change.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-02:acc-1-5bdfa2ab
  tests: backend/app/modules/change/tests/test_delete_change.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-02:acc-2-5b3d4d40
  tests: backend/app/modules/change/tests/test_delete_change.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-03:acc-0-ece38916
  tests: sillyhub-daemon/src/sillyspec-manager.ts | sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-03:acc-1-0143ccd6
  tests: sillyhub-daemon/src/sillyspec-manager.ts | sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-03:acc-2-88c8a511
  tests: sillyhub-daemon/src/sillyspec-manager.ts | sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active
- row: 2026-10-09-tombstone-conflict-root-fix:task-03:acc-3-561829ad
  tests: sillyhub-daemon/src/sillyspec-manager.ts | sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-tombstone-conflict-root-fix
  status: active

## FR-protocol-017 关联仓共享登记（数据模型 + CRUD）
变更：2026-10-10-workspec-maintenance
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个已存在的工作区；When 管理员通过 `POST /api/workspaces/{id}/linked-repos` 提交 `{ name, repo_url?, descriptio；Then 平台落库 `workspace_linked_repos` 新行（`(workspace_id, name)` 唯一，重名 409），无 relation_ki
全文：.sillyspec/changes/archive/2026-10-10-workspec-maintenance/requirements.md#FR-01
最近确认：b15fafc3b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-workspec-maintenance:task-01:acc-0-120f853c
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-01:acc-1-88b1ea29
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-01:acc-2-035e5dc0
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-02:acc-0-9786a5d0
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-02:acc-1-c103a63b
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-02:acc-2-5eecbbe3
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active

## FR-protocol-018 成员级本地路径
变更：2026-10-10-workspec-maintenance
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区已登记关联仓；When 成员调用 `PUT /api/workspaces/{id}/linked-repos/{rid}/my-path` 提交 `{ path }` 或 `{ pa；Then 仅写入/清除该成员自己的 `workspace_linked_repo_paths` 行（`(linked_repo_id, user_id)` 唯一，upse
全文：.sillyspec/changes/archive/2026-10-10-workspec-maintenance/requirements.md#FR-02
最近确认：b15fafc3b

## FR-protocol-019 daemon 双落盘
变更：2026-10-10-workspec-maintenance
状态：active
摘要：默认场景
依据决策：D-004@v2、D-005@v2
场景正文：
- 场景：默认场景 — Given 成员机器 daemon 在线且收到 `linked_repos_sync` RPC（payload 含 workspace、repos[] 配置快照与该成员 r；When daemon 执行同步；Then 在成员本机工作区根依次 spawn：
全文：.sillyspec/changes/archive/2026-10-10-workspec-maintenance/requirements.md#FR-03
最近确认：b15fafc3b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-workspec-maintenance:task-04:acc-0-6d85faa6
  tests: sillyhub-daemon/tests/linked-repos-sync.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-04:acc-1-693c93a8
  tests: sillyhub-daemon/tests/linked-repos-sync.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-04:acc-2-1539fb52
  tests: sillyhub-daemon/tests/linked-repos-sync.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active

## FR-protocol-020 落盘状态回环
变更：2026-10-10-workspec-maintenance
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 完成或跳过/失败任一层；When daemon 调用 `POST /api/daemon/machines/{instance_id}/linked-repos-sync-result` 回报；Then backend 更新该 (workspace, machine, repo, layer) 状态（ok/skipped/failed + detail + 时间
全文：.sillyspec/changes/archive/2026-10-10-workspec-maintenance/requirements.md#FR-04
最近确认：b15fafc3b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-workspec-maintenance:task-03:acc-0-34910d67
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | sillyhub-daemon/tests/linked-repos-sync.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-03:acc-1-2a0defea
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | sillyhub-daemon/tests/linked-repos-sync.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-03:acc-2-41ebc5dc
  tests: backend/app/modules/daemon/tests/test_linked_repos_sync.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | sillyhub-daemon/tests/linked-repos-sync.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active

## FR-protocol-021 同步触发
变更：2026-10-10-workspec-maintenance
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区有关联仓且用户为成员；When 用户在卡片点「立即同步」（`POST …/linked-repos/sync`）；Then backend 向该成员绑定 daemon 发请求-响应 RPC 并受理；配置 CRUD 成功后另向在线 daemon
全文：.sillyspec/changes/archive/2026-10-10-workspec-maintenance/requirements.md#FR-05
最近确认：b15fafc3b

## FR-protocol-022 前端关联仓卡片
变更：2026-10-10-workspec-maintenance
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户打开工作区详情页；When 渲染「关联仓」卡片；Then 列表展示名称/仓库地址/描述/我的本地路径/逐层落盘状态；管理员可新增/编辑/删除（Modal 表单，
全文：.sillyspec/changes/archive/2026-10-10-workspec-maintenance/requirements.md#FR-06
最近确认：b15fafc3b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-workspec-maintenance:task-05:acc-0-e00d4b11
  tests: frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-05:acc-1-98100838
  tests: frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-05:acc-2-83dede27
  tests: frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-06:acc-0-b5661b5e
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_delete_change.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_runs_endpoint.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/__tests__/platform-sync-section.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/daemon/__tests__/turn-speed.test.ts | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/daemon-session-stream-sync.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-06:acc-1-f08d6b7d
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_delete_change.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_runs_endpoint.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/__tests__/platform-sync-section.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/daemon/__tests__/turn-speed.test.ts | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/daemon-session-stream-sync.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active
- row: 2026-10-10-workspec-maintenance:task-06:acc-2-6d306988
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_delete_change.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_runs_endpoint.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/__tests__/platform-sync-section.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/daemon/__tests__/turn-speed.test.ts | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/daemon-session-stream-sync.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/borrow-sandbox-context.test.ts | sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/daemon-status-root-persistence.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-workspec-maintenance
  status: active

## FR-protocol-023 降级与兼容
变更：2026-10-10-workspec-maintenance
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 老 daemon（无 RPC handler）或旧版 sillyspec CLI（无 register-repo 子命令）；When 触发同步；Then 分别得到「daemon 需升级」状态或该层 skipped；未配置关联仓的工作区行为与现状一致；
全文：.sillyspec/changes/archive/2026-10-10-workspec-maintenance/requirements.md#FR-07
最近确认：b15fafc3b
