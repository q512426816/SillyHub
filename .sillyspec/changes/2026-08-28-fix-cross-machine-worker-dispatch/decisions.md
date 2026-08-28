---
author: WhaleFall
created_at: 2026-08-28 14:59:07
---

# Decisions — 2026-08-28-fix-cross-machine-worker-dispatch

## D-001@v1 选机语义：目标工作区绑定机器唯一钉定（弃 owner 自有在线优先）

- **type**: architecture
- **source**: user
- **question**: 分身子会话派发选机应使用哪台机器？（现状 mcp_tools.py:1108 owner 自有在线机器优先 → 跨机工作区时与 worktree 创建机器分裂）
- **answer**: 用户钦定方案A——"分身派发改为目标工作区绑定机器唯一钉定"。读 workspace_member_runtimes 解析目标工作区绑定机器（复用预检 resolve_representative_binding 结果），恒以该机器为 pinned_runtime_id；绑定机器不在线 → 422 预检拒绝（已有），绝不静默回落 owner 自有机器。备选方案B（保留 owner 优先 + daemon 事后探测补救）被否：事后补救不解决根因、探测不可靠；备选方案C（下沉到 placement 层改全部交互会话语义）被否：影响面超出本次修复范围（普通 create_session 不在范围）。
- **evidence**: brainstorm step4 方案对比轮；用户原始指令原话："分身派发改为目标工作区绑定机器唯一钉定 + allowed_roots 白名单双重校验 + daemon 拒建不存在目录"；DB 实证：workspace_member_runtimes 表 QM小程序→crrcdt-hubin 绑定已存在但 mcp_tools.py:1108 `_get_online_runtime(owner_id)` 纯查 daemon_runtimes（用户级）从未读它。

## D-002@v1 provider 匹配：严格优先 → 任意在线 binding 回退（对齐现有 fallback 语义）

- **type**: architecture
- **source**: ai
- **question**: 绑定机器的 runtime provider 与目标工作区 default_agent 不一致时怎么办？
- **answer**: 预检 resolve_representative_binding 先按 provider=target_provider 严格解析（SQL 层过滤）；严格解析无果再按 provider=None 回退任意在线 binding（与被删除的 own_rt 路径的 provider fallback 语义对齐，打 placement_provider_fallback 同款 warning 日志）。lease_provider 取 binding 实际 provider（现有代码已如此）。理由：不引入新的拒绝路径，provider 偏好保留、可用性不回退。
- **evidence**: brainstorm step4；对照 placement.py:1508-1520 既有 provider fallback。

## D-003@v1 allowed_roots 双重校验：backend 派发前预检 + daemon 认领时终检

- **type**: architecture
- **source**: user
- **question**: allowed_roots 白名单校验放哪端？
- **answer**: 用户钦定"双重校验"：① backend 派发前（选机钉定后、建 lease 前）校验 resolve_root_path_for_daemon(ws.root_path) ⊆ 钉定机器 allowed_roots（instance ∪ runtime 并集，对齐 daemon _effectiveAllowedRoots 语义）；不通过 → 4xx fail-loud 带中文引导，不建 run/lease。② daemon 认领 interactive 会话时校验 cwd ⊆ _effectiveAllowedRoots()（现状缺口：host_fs RPC 全方法有 assertWithinAllowedRoots，但会话 cwd 无校验）；越界 → notifyRunResult error 拒启动。daemon 端是权威终检，backend 预检是快速失败 + 可诊断错误信息（现状 forbidden 经降级通道被 worktree_create_failed+"rpc unavailable" 掩盖）。
- **evidence**: brainstorm step4；host-fs-handler.ts:906-907 既有模式；daemon.ts:3861 会话 cwd 无校验缺口。

## D-004@v1 daemon 拒建不存在目录：仅保留无 rootPath 兜底路径的 gap-8 mkdir

- **type**: architecture
- **source**: user
- **question**: daemon.ts:3862 无差别 mkdir(cwd, recursive) 如何收敛？
- **answer**: 用户钦定"拒建不存在目录"：execPayload.rootPath 非空（workspace 绑定会话）且 cwd 不存在 → 不 mkdir，notifyRunResult error（明确错误信息：目标目录不存在，可能工作区绑定机器路径错配/错机派发），fail-loud；rootPath 为空（daemon-client 交互会话回落 config.workspace_dir）→ 保留 gap-8 mkdir 修复（该目录是 daemon 自有领地，无错机语义）；借用沙箱（BORROW_SANDBOX_MARKER）路径 prepareWorkspace 自建不改。理由：worktree 已由 host_fs RPC 在绑定机器上先建（正确机器上 cwd 必已存在），错机上必不存在——存在性即"对机"的试金石。Grill D-1.2 细化：非空判定按 truthy（空串 '' 与 undefined/null 同走兜底分支）；B2 插入点须在 daemon.ts:3808 firstRunId 非空守卫之后（notifyRunResult 可用性）。
- **evidence**: brainstorm step4；daemon.ts:3852-3869 gap-8 注释（修复原意是 daemon-client 无 workspace 场景，无差别 mkdir 是过度修复）。

## D-003@v2 预检只拒"可判定越界"，不可判定放行交 daemon 权威（替代 v1 的"偏严由 daemon 放行"主张）

- **type**: architecture
- **source**: ai
- **question**: Grill B-1 发现 v1 内部矛盾——backend 400 后不建 run/lease，请求到不了 daemon，"预检偏严由 daemon 终检放行"不可能成立。如何修正？
- **answer**: v1 作废两点：①数据源从"instance ∪ 钉定 runtime 两行"扩为"instance ∪ 该 instance 名下**全部** daemon_runtimes"（对齐 daemon `_effectiveAllowedRoots` 同机全量并集，缩小偏严窗口）；②拒绝规则改为**仅可判定越界才 400**（并集存在绝对路径根且路径不在任何根内），全部根为 `~`/空并集一律放行。救济方向如实登记为单向：偏松由 daemon 终检兜底；偏严误拒（daemon 本地 config 缩减未重注册的极窄窗口）登记为残余风险，不再声称"不会误杀"。
- **evidence**: Design Grill 独立审查 fail 级发现 B-1（agent_8543c839）；daemon.ts:2577-2585 `_effectiveAllowedRoots` 并集覆盖全部 policyCache runtime 根 vs v1 仅取两行。

## D-005@v1 双源同序全序：钉定解析与 worktree 路由收敛同机

- **type**: architecture
- **source**: ai
- **question**: Grill D-1.1/F-1.2 发现钉定解析（resolve_representative_binding，分支1 LIMIT 1 无 ORDER BY）与 worktree 路由（resolve_daemon_instance_for_workspace，LIMIT 1 无 ORDER BY）是两个独立非确定查询——多成员多机绑定时可分叉（worktree 建 A 机、lease 钉 B 机），"唯一钉定"与"对机试金石"均无可测试定义。如何收敛？
- **answer**: 两查询统一补全序 `ORDER BY daemon 心跳 DESC, daemon_id ASC`（queries.py 两处）——相同候选集上必选同机。残余形态（在线性差异、心跳同刻）由既有 fail-loud 通道收敛（worktree RPC 失败 / daemon cwd_not_found），不静默。
- **evidence**: Design Grill 独立审查 gap 级发现 D-1.1/F-1.2；queries.py:297-315（分支1 无序）、queries.py:145-156（host_fs 路由无序）。

