# 决策知识 — backend

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : plan 模式采用强确认交互
状态：implemented
锚点：`frontend/src/components/daemon/plan-approval-card.tsx`
最近确认：04bb45fe
理由：强确认，类似 askuser 弹窗。

## D-001@v1 : 变更删除权限口径 = 变更 owner + 工作区所有者 + 平台管理员
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`backend/app/modules/change/router.py`
最近确认：0ec935c9
理由：DELETE /workspaces/{ws}/changes/{cid} 组合依赖——require_permission(Permission.CHANGE_ARCHIVE)（workspace_owner 角色内置、platform_admin 短路）OR change.owner_id==当前用户；owner 取当前值并接受漂移语义（owner=最新推送人），owner 为空（从未上行进度）时仅前两者可删。名称末段输入防呆 + change_events 审计兜底误删面（R-04）。

## D-002@v1 : 平台删除 = 软删隐藏 location='deleted'，不做恢复 UI
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`backend/app/modules/change/service.py`
最近确认：0ec935c9
理由：Change 行置 location='deleted' 第三区（active/archive 两 tab 显式传参天然不显示，读端 enrich 对 deleted 前置过滤）；镜像文件移 30 天备份区 + manifest platform_deleted 墓碑；写 change_events delete 审计（行保留故 FK 不级联丢审计）；不物理删不做恢复界面（未上线允许 DB 人工恢复，规则 11）。

## D-005@v1 : 删除自动收敛 = 方案 A 镜像驱动收敛（+CLI 墓碑上报增强）
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`backend/app/modules/spec_workspace/service.py`
最近确认：0ec935c9
理由：平台以镜像文件树为唯一权威：apply_ops 幽灵空目录清理 → scoped reparse 定向删除（R-08 收窄：仅 scope∩磁盘确认消失可删，scope 外零动作）→ 删除环顺手清 progress 行 → platform_deleted 四通道拦截。拒 B（墓碑上行驱动——旧版 CLI 不发墓碑照旧残留、且平台删除入口仍需 A 的防复活基建）、拒 C（全量对账常态化——Windows bind mount stat 性能断崖 + 全量 reparse 93s 超时史）。误删面最小（scope 收窄 + 7 天占位保护 + 30 天备份区）；CLI 墓碑上报为收敛加速器，平台闭环不依赖。

## D-006@v1 : Design Grill 加固 — 删除环豁免 deleted 行 + 持久锚点兜底 + 落盘级拦截
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`backend/app/modules/platform_sync/service.py`
最近确认：0ec935c9
理由：B-1/B-2 修复三点：① scoped 与全量两处删除环 + _apply_parsed 更新路径均豁免 location='deleted' 行（不删不回翻，审计不 CASCADE 丢失、锚点行保活）；② _ensure_change_row 拒收双层——Change 行 location='deleted' 为主判据，行缺失时兜底探测 manifest platform_deleted 前缀（LIKE 转义 %/_，变更名含下划线常见）；③ _write_spec_root 落盘集计算阶段排除 platform_deleted 前缀路径（文件不落盘断 parser 复活链，仅挡 manifest 对齐环不够——tar 落盘在先）。附带修正：delete op 对 platform_deleted 幂等放行（仅拦 add/rename）、spec-bundle 鉴权口径 _write_auth、progress 拒收 409 用 code=change_deleted 结构化区分。

## D-002@v1
状态：implemented
变更：2026-08-25-session-spec-binding
锚点：backend/migrations/versions/20260825223000_add_quicklog_session_links.py（播种）
最近确认：a9b06c98
理由：links 为唯一关联真相：读侧全部改走 links；alembic 一次性把存量 change_id 播种成 link 行（ON CONFLICT DO NOTHING）；change_id 列保留并继续写入（创建时锚定主变更的冗余提示，双写），后续变更再评估删列。

## D-006@v1 : raw 端点 50MB 上限 + inline disposition
状态：implemented
变更：2026-08-26-file-fullscreen-preview
锚点：backend/app/modules/change/router.py（files/raw）
最近确认：5d86ddb1
理由：MAX_RAW_BYTES=50MB（变更目录为原型图/文档，远超文本端点 1MB 但无需无限）；Content-Disposition: inline + RFC5987 filename*（前端 XHR 取 blob，disposition 仅供直开兜底）。超限 413。

## D-002@v1 : 数据链路走方案 A——git_log 模块扩展独立轻量 status 端点
状态：implemented
变更：2026-08-26-workspace-git-status
锚点：backend/app/modules/git_log/router.py
最近确认：86d6c405
理由：复用 git_log 模块与 host-fs 平名通道，daemon 加单方法 git_status、backend 加 GET /git-log/status、前端共享组件。

## D-001@v1 : 群聊触发模式 = @提及 + 独立记忆
状态：implemented
变更：2026-09-01-session-group-chat
锚点：`backend/app/modules/daemon/group/service.py`
最近确认：9531f7228
理由：@昵称触发对应 agent、@全体广播；每 agent 影子会话独立记忆；未被 @ 的消息仅进群背景摘要（最近 N 条含 agent 回复，身份标签+截断）。openclaw mention-gating 同构，防刷屏。

## D-002@v1 : 群聊架构 = 影子会话桥接
状态：implemented
变更：2026-09-01-session-group-chat
锚点：`backend/app/modules/daemon/run_sync/service.py`
最近确认：9531f7228
理由：群会话（kind='group'）统一时间线 + 每 agent 成员影子会话（kind='group_member'）独立记忆 + 事务内双写投影行桥接回群；复用 interactive lease/排队/SSE/热切换管线，单聊零改动。备选独立群聊域（2-3 倍工作量）与 mission 扩展（任务/聊天语义冲突）被否。

## D-003@v1 : 群成员模型 = 显式邀请制
状态：implemented
变更：2026-09-01-session-group-chat
锚点：`backend/app/modules/daemon/group/service.py`
最近确认：9531f7228
理由：建群拉 workspace 用户+配置 agent 成员；仅群成员可看可聊（两段式判定：成员命中→workspace admin 兜底→404 不泄露存在性）。

## D-004@v1 : agent 成员六要素 + 群聊中随时热切换
状态：implemented
变更：2026-09-01-session-group-chat
锚点：`backend/app/modules/daemon/group/service.py`
最近确认：9531f7228
理由：昵称（@提及词全局唯一）/机器/工作区/引擎/模型/方案（AgentProfile）；模型组切换 SESSION_SWITCH_CONFIG 下轮生效记忆延续；机器组切换影子重建重置记忆（确认提示）。

## D-005@v1 : 协作模式 = openclaw 同构平等成员（人格即角色）
状态：implemented
变更：2026-09-01-session-group-chat
锚点：`backend/app/modules/daemon/group/service.py`
最近确认：9531f7228
理由：无固定角色系统/派活工具/角色模板；agent 间关联靠群背景摘要被动互见+@全体广播+互@协作（开关默认开带护栏）。分工是人格/工具/工作区配置的自然涌现。

## D-006@v1 : agent 互@协作群级开关默认开 + Redis 防环护栏
状态：implemented
变更：2026-09-01-session-group-chat
锚点：`backend/app/modules/daemon/group/service.py`
最近确认：9531f7228
理由：agent 回复最终文本中的 @昵称 与用户 @ 同管线触发（注入标注来源成员）；护栏 Redis 双轨——group_chain Hash 去重+depth（TTL 30min，DB metadata 兜底）+group_rate 滑窗限频 6/分；不自我触发；关闭时 @ 为纯文本。

## D-007@v1 : 影子会话不挂 parent_session_id（成员表反向指针）
状态：implemented
变更：2026-09-01-session-group-chat
锚点：`backend/app/modules/daemon/group/service.py`
最近确认：9531f7228
理由：parent 恒 NULL、群↔影子经 agent_group_members.shadow_session_id 关联——规避 5 处以 parent 非空为 worker 唯一口径的链路（停机挂起/离线 sweep/自动恢复/自动重派/闸收口）误杀影子。

## D-008@v1 : 桥接投影 = 事务内双写投影行（新 PK）+ 群频道事件携投影行 id
状态：implemented
变更：2026-09-01-session-group-chat
锚点：`backend/app/modules/daemon/run_sync/service.py`
最近确认：9531f7228
理由：submit_messages 事务内插投影行（新 uuid PK 防撞影子行/dedup_key 复用/metadata 身份），群频道事件 log_id=投影行 id——实时与回放同 id 去重闭环；仅投影 assistant 文本；override 按载体 run+segment DELETE。复用原 log_id 会 PK 冲突（Grill P0 修正）。

## D-009@v1 : 昵称全局唯一（用户与 agent 共用命名空间）
状态：implemented
变更：2026-09-01-session-group-chat
锚点：`backend/app/modules/agent/model.py`
最近确认：9531f7228
理由：UNIQUE(group_id, display_name) 全量唯一（含已移除行——查重须全量口径否则撞约束 500，P1 修复 743e9e1c）；@路由无歧义。

## D-011@v1 : 群时间线 = 平铺消息流全局 timestamp 排序
状态：implemented
变更：2026-09-01-session-group-chat
锚点：`frontend/src/components/group-chat/group-chat-panel.tsx`
最近确认：9531f7228
理由：实时事件与回放读库统一按 log timestamp 全局排序、忽略 run 分组——get_agent_session_logs 的 run 锚分组会把迟到回复"吸回"触发消息组，与实时顺序失真。

## D-012@v1 : 群聊首期取舍（审批/计量/排队快照/run 视图/typing）
状态：implemented
变更：2026-09-01-session-group-chat
锚点：`backend/app/modules/daemon/group/service.py`
最近确认：9531f7228
理由：影子 manual_approval=False（审批不进群）；计量归群主（影子 user_id=群主）；排队消息按入队时刻摘要快照派发；群不消费 run 级视图；typing/presence 纯 ephemeral（Redis TTL，不落库不进上下文）；群不绑 change_id。

## D-001@v1 恒读 SQLite，文件仅作失败兜底
状态：implemented
变更：2026-09-10-zcode-session-sqlite-read
锚点：未记录
最近确认：20cf7bc46
理由：恒读 SQLite（文件存在也不读文件）；库读失败（schema 漂移/库损坏/会话不在库/node:sqlite 不可用）才回落文件路径。

## D-002@v1 DB 路径不截断，仅文件回落路径保留 256KB
状态：implemented
变更：2026-09-10-zcode-session-sqlite-read
锚点：未记录
最近确认：20cf7bc46
理由：不截断——按会话查询天然有界，对话窗口即上界；仅 read_file 回落路径保留原 256KB 截断语义。

## D-007@v1 伪 jsonl 固定九字段封闭序列化
状态：implemented
变更：2026-09-10-zcode-session-sqlite-read
锚点：未记录
最近确认：20cf7bc46
理由：NormalizedLogMessage 九字段（seq/kind/text/tool_name/tool_use_id/tool_input/tool_result/is_error/ts）逐行全量 JSON，封闭列举；content 回落捕获范围含 not_found/method_not_found（老 daemon）/离线/超时。

## D-001@v1 : 平台用户头像存文件中心（users.avatar URL 列）
状态：implemented
锚点：`backend/app/modules/auth/model.py:53`
最近确认：41c3b37
理由：2026-09-10-account-avatar-upload——users.avatar VARCHAR(512) NULL 存 /api/file/{id} 或外链（与 agent/群成员头像同构）；上传走既有文件中心端点（owner_type=user_avatar），渲染复用 useAvatarSrc blob 管线，零新存储设施；否决独立公开头像服务（隐私面大）与 base64 存 DB（膨胀）。

## D-002@v1 : 群聊用户成员头像后端回落解析（member.avatar or user.avatar）
状态：implemented
锚点：`backend/app/modules/daemon/group/service/helpers.py:699`
最近确认：41c3b37
理由：2026-09-10-account-avatar-upload——读取路径对 user 成员做平台头像回落（群内自定义优先，NULL/'' 均回落；agent 成员不动），前端零改动即生效；_to_read 同步函数不直查 users 表，crud 调用点批量预取 select in 免 N+1；读取端解析非快照，平台头像更新群读实时取新值。

## D-001@v1 ctx_tokens 派生位置——归一化器源头上报处派生（方案 A），否决消费侧统一派生（方案 B/C）
状态：implemented
变更：2026-09-13-ctx-usage-all-providers
锚点：sillyhub-daemon/src/interactive/providers.ts:ProviderCaps（caps 键落点）+ sillyhub-daemon/src/interactive/usage-ctx.ts:ctxTokensFromNetInput（公式单源落点，execute 新建）
最近确认：未记录
理由：用户原话指定方向：「都要接入的，并且需要统一抽象出来（我记得最近刚刚做了个统一抽象的事情，就是怕后面再接新 agent 又遗漏一些功能）」。据此选方案 A（各归一化器在 usage 构造处用共享 helper 派生 + ProviderCaps 第 11 键声明走既有三端生成与守护链）。

## D-004@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:66（NormalizedLogMessage）、backend/app/modules/platform_sync/router.py:849（messages 端点）
最近确认：53c67e02a
理由：四层打通——daemon 解析器透传 usage/turn/model/耗时 + 全会话累计 → RPC 返回结构 → 平台 GET /agent-logs/{id}/messages schema → gen:types → 前端映射到 SessionTurnView token 字段与会话用量环；老 daemon 字段可选、缺省显示「未知」；cursor-agent 回放 token 恒「未知」（数据不落盘，非解析器可解）

## D-008@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：decisions.md D-001/D-004/D-007
最近确认：53c67e02a
理由：方案A——前端适配器把 NormalizedLogMessage[] 映射为 SessionTurnView 喂 TurnTimeline 真组件；daemon zcode 解析器补 usage/turnId/model/累计 + 新增 claude-code、cursor-agent 解析器与 cursor-agent 扫描上报；平台 messages schema 加可选字段 + gen:types；平台库零表结构改动，按需现读

## D-001@v1 定时发送的实现方案
状态：implemented
变更：2026-09-07-session-pin-rename-scheduled-send
锚点：未记录
最近确认：35f3d6528
理由：**方案 B：新建 `agent_session_scheduled_messages` 表 + 独立 sweeper 常驻协程**。到点扫描 due 条目，逐条复用 `inject_session_as_service`（忙轮自动入 `agent_session_queued_messages` 既有队列），单条状态 pending → dispatched / cancelled / failed，失败隔离。

## D-003@v1 定时到点时队列满员的处理
状态：implemented
变更：2026-09-07-session-pin-rename-scheduled-send
锚点：未记录
最近确认：35f3d6528
理由：**置 failed 并落 error_code=queue_full**（不盲发不丢弃，失败原因用户可见，可取消重建）。不选满员自动延后重试。

## D-001@v1 根治方案选 A——全链强制 workspace_id + daemon 映射查根
状态：implemented
变更：2026-09-09-conflict-root-workspace-scoping
锚点：未记录
最近确认：35f3d6528
理由：**方案 A**。对比 RPC `sillyspec_conflict_snapshot` 与裁决指令 `sillyspec_resolve` 全链（REST 请求体 → WS payload → daemon 消息处理 → 前端弹窗下传）强制携带 `workspace_id`；daemon 用 `_sillyspecStatusRoots.get(workspaceId)` 解析根，**映射未命中不得回退单槽位**，抛 RpcError `workspace_root_unknown`（提示该工作区尚未被本机会话认领）；无 workspace_id 的旧调用形态保留单槽位 legacy 语义。辅防：无 workspaceId 的 claim 不再覆盖单槽位。与根因文档 `docs/sillyspec/conflict-compare-wrong-status-root.md` 已定稿口径一致。

## D-002@v1 P0-2 独立配额池的作用域与实现层次
状态：implemented
变更：2026-09-10-review-dispatch-platform-fixes
锚点：未记录
最近确认：f1bdbef95
理由：用户原话「支持按 workspace 或按 agent_profile 独立配置（独立池或不同 provider）」。探查证实 profile 绑定链路已全通，真缺口=llm_provider schema 锁死 claude + daemon injector REGISTRY 无 pi；补齐后 per-(user, agent_kind=pi) 默认与 profile/workspace(default_agent_profile_id) 两条路都开放，不在本变更里强选一条。

## D-003@v1 P1-3 生效执行器暴露位置
状态：implemented
变更：2026-09-10-review-dispatch-platform-fixes
锚点：未记录
最近确认：f1bdbef95
理由：用户原话「或至少在 mcp-tokens 签发响应/get_daemon_status 里暴露当前生效执行器」。选 get_daemon_status：mcp-tokens 是签发时快照会陈旧，token 是长期凭证不该背 status 类实时信息；daemon 注册/心跳已上报 providers（DaemonRuntime 现成数据）。「管理员把 default_agent 设为 pi」为运维动作随交付文档给出。

## D-002@v1
状态：implemented
变更：2026-09-11-agent-log-attribution-refactor
锚点：backend/app/modules/platform_sync/service.py（_upsert_agent_log_entries_once 归属段）
最近确认：353eb11b0
理由：ctx-owner 解析——按 entry 自身 ctx（quick 优先）解析「主」会话：已绑定该 ctx 的会话（change/quicklog links，含平台派发会话与自动会话）取最近活跃者优先挂；无主则 find-or-create 自动会话。跨 harness 不限制（平台 pi 会话 + 本地 zcode 同变更聚到一起）

## D-003@v1
状态：implemented
变更：2026-09-11-agent-log-attribution-refactor
锚点：backend/app/modules/platform_sync/service.py（find-or-create 段）
最近确认：353eb11b0
理由：沿用现有 find-or-create origin=tool_report 自动会话；聚合键从 "{harness}|{ctx}" 改为 "{ctx}"（同 ctx 跨 harness 聚合进同一会话），标题改「本地 · {ctx}」；空 ctx 保持 workspace+harness 单桶现状

## D-005@v1
状态：implemented
变更：2026-09-11-agent-log-attribution-refactor
锚点：未记录
最近确认：353eb11b0
理由：不动表结构——保留 agent_session_id 单列，靠打标修复 + ctx-owner 解析保证正确性；一条日志行只挂一个会话（其 ctx 的当前 owner），同 ctx 多会话时向最近活跃 owner 漂移

## D-003@v3 pi/codex 结果回传定案 ws RPC（send_rpc + registerRpcHandler），砍 SESSION_COMPACT 控制机器
状态：implemented
变更：2026-09-14-session-ctx-compact
锚点：未记录
最近确认：1aacbb3d9
理由：复用既有 ws RPC 请求-结果通道：backend 端点 ws_hub.send_rpc(daemon_id, 'session_compact', {session_id}, timeout=15)（backend/app/modules/daemon/ws_hub.py:502-560，DaemonRpcTimeout/Offline/RemoteError 异常齐备）；daemon 侧 registerRpcHandler('session_compact')（sillyhub-daemon/src/daemon.ts:6438-6456 既有四先例）→ sessionManager.compact → CompactResult 即 RPC result。SESSION_COMPACT 控制机器三件套（backend protocol.py/control_commands.py + daemon protocol.ts/daemon.ts 三点接线）全部弃用；「无 schema 迁移 / control-dispatcher 零改动」在 v3 下为真。
supersedes：D-003@v2（仅回传机制部分，其余维持）

## D-004@v1 反馈呈现=端点响应回执 + 前端通知三分型
状态：implemented
变更：2026-09-14-session-ctx-compact
锚点：未记录
最近确认：1aacbb3d9
理由：端点响应承载回执，前端按 provider 分型通知：pi「已压缩：X → 约 Y tokens」（数字来自 RPC response）/ codex「已触发上下文压缩」（受理无数字）/ claude「已发送 /compact（压缩轮运行中）」（流程可见性由会话流中的 /compact 轮本身承载）；失败通知带 error 原文（如 pi "Nothing to compact"）。

## D-002@v1 架构=compact 同款 RPC 模式（可选 driver 方法+daemon RPC handler+caps 键）
状态：implemented
变更：2026-09-14-session-thinking-level
锚点：未记录
最近确认：28915f71b
理由：方案 A：照 2026-09-14-session-ctx-compact 刚验证的 RPC 模式——driver.ts 加可选 `getThinkingLevels?(handle)`/`setThinkingLevel?(handle, level)` 两契约方法；daemon.ts 注册 `session_get_thinking_levels`/`session_set_thinking_level` 两 RPC handler；backend 两端点（GET 档位列表+POST 切换）；caps 第 13 键 `thinking_level`（claude/pi/codex=true、cursor=false）。B（进程重启式）否决：切档重启子进程丢流式状态体验差；C（inject 文本）否决：pi/codex 不认文本且档位查询无通道。

## D-001@v1 顺序归属——每人一套（user-scoped order）
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：每人一套（用户 2026-09-14 explore 会话 AskUserQuestion 亲答）。新表 `user_workspace_orders(user_id, workspace_id, sort_position)`。

## D-002@v1 保留服务端分页（量级一两百）
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：一两百个量级，服务端分页（12/页 limit/offset）保留，不做"加载全部"改造。

## D-004@v1 新建工作区落位——最前
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：最前。与现状 `created_at DESC`（最新在前）感知一致；SQL 语义=排序行缺失（NULL）优先于一切已有位置。

## D-007@v1 move 端点鉴权——登录 + 对目标 workspace 有 WORKSPACE_READ
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：登录用户且对目标 workspace 具备 WORKSPACE_READ（与列表可见性一致）。per-user 顺序只影响本人视图，无需管理员/owner 门槛。锚点目标卡（after_id/before_id）不在该用户可见集合时 422。

## D-011@v1 数据层实现——方案 A（排序表 + 浮点中点锚点）
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：方案 A（用户 brainstorm Step 4 AskUserQuestion 亲选）。理由：唯一同时满足锚点跨页（客户端只需边界卡 id）+ 保住现有服务端 limit/offset 分页与四路筛选 SQL（LEFT JOIN 原生 ORDER BY）+ 每次拖拽 O(1) 单行写入；B 把排序挤到应用层与分页 SQL 冲突且全量写放大；C 跨设备不同步、分页下无法独立排序。淘汰记录：B 违反 D-002 精神（架空服务端分页）、C 违反 D-001（顺序非服务端持久）。

## D-006@v2 backfill 幂等化 + 位置方向勘误
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：①backfill 幂等化：每次 move 事务首步 INSERT..SELECT WHERE NOT EXISTS，对（可见 ∧ active+archived ∧ 无行）全集物化，无行组整体赋在现有最小位置之下、组内 created_at DESC——锚点卡永远有行，物化前后显示序零变化。②初始/新增物化位置按 created_at DESC 赋 row_number×1024 **递增**序列（v1"递减"为笔误，display 顺序语义以 design 公式为准）。
supersedes：D-006@v1

## D-012@v1 边缘投放带锚点由服务端页相对解析（to 枚举 + rank 响应）
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：投放带请求改 `{to: "next_page_head"|"prev_page_tail"}`（可选 page_size 默认 12），服务端在默认视图有序序列（可见 ∧ active ∧ 未删，按显示序）上定位被移动卡 rank、按分页数学解析目标插入 rank，再走统一中点路径；响应携带移动后 rank，前端 floor(rank/page_size) 换算目标页自动翻页+高亮。否决客户端预取相邻页方案：每次拖拽多两请求且边界卡在并发移动下会过期，分页数学在客户端重复实现必再出 off-by-one。

## D-013@v1 move 请求契约修订——三选一锚点、无 null 置顶、自锚 422
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：①锚点三选一：after_id / before_id / to 恰好一个出现，全为非 null uuid 或枚举值；置顶场景由弹窗页首锚点表达，删除 null 置顶语义。②锚点有效性 = 存在 ∧ 在可见集合 ∧ deleted_at IS NULL ∧ status ∈ {active, archived}（与 D-006@v2 物化范围对齐），违反 422 HTTP_422_MOVE_ANCHOR_NOT_VISIBLE。③自锚 422 HTTP_422_MOVE_ANCHOR_SELF（前端正常流程不会发，作契约兜底）。

## D-003@v2 边缘投放带锚点表达改 to 枚举（UX 不变）
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：维持边缘投放带路线（用户 explore 亲选的 UX 不变），仅锚点表达从客户端 id 锚点改为 `{to: next_page_head|prev_page_tail}` 服务端解析（D-012）。v1 的锚点写法作废；翻页+高亮闭环承诺保留。
supersedes：D-003@v1

## D-014@v1 分页数量不变量——move 是纯重排
状态：implemented
变更：2026-09-14-workspace-drag-sort
锚点：未记录
最近确认：e21bf19cc
理由：不允许（用户 2026-09-14 明确约束）。move 只做单行 sort_position 更新，不增删任何行；任何移动后 total 不变、每页恒 PAGE_SIZE 张（末页允许不满），跨页移动=源页少一张/目标页多一张后重新切片。

## D-001@v1 thin 接入形态=THIN 新辅助阶段，列表页与常规变更同列（用户裁决）
状态：implemented
变更：2026-09-25-change-center-thin-flow
锚点：未记录
最近确认：9c908b6ae
理由：用户裁决选方案 A（THIN 新辅助阶段），并加 UX 约束原话：「列表页面上我想跟常规变更在一起，内部的逻辑展示可以不一样」——thin 变更是常规 Change 记录，进主变更列表（不像 quicklog 另开 tab），详情页内部按薄流程两段式（start→干活→done）差异化展示。依据：与上游 CLI「存量过渡」语义逐字对齐（quick 保留收尾、新工作走 thin）；新旧隔离清晰存量零风险；manual_dispatch 泛化路径零改动可用；quicklog 那种独立 tab 的形态在核对中被证伪（thin 变更的四件套/归档/事件/蒸馏全在 change 体系，独立入口割裂最重）。
故障面：过渡期 quick/thin 两套辅助阶段并存——前端徽章/筛选/说明卡两态都要活，漏一处即裸显英文 "thin" 或全灰管线（核对报告前端遗漏清单已列全触点）。
退役判据：quick 存量变更全部收尾归档后，可另立决策下线 QUICK 阶段派发面与 quicklog 读侧（读侧至少保留一个归档周期）。

## D-001@v1 数据流=服务端聚合端点（方案 a），thin+brainstorm 跑法（用户裁决）
状态：implemented
变更：2026-09-25-change-precipitated-assets
锚点：未记录
最近确认：a7eca07270b25dbe374717aaf8379f57254fe3df
理由：用户前轮方案对比后裁决「好，做」选定方案 a——后端新增聚合端点按变更名解析 spec 树镜像（knowledge/fr/*.md 与 knowledge/decisions/*.md 的「变更：」行过滤 + 归档目录 test-trace.json/change-patch.json/delta.md 容错读取），前端观测事件卡同构折叠卡；并裁决本变更走「轻量变更+头脑风暴预段」（原话：好，做，第二个变更走轻量变更附加头脑风暴）。b（CLI 命令：tests 无 --json/derive 无对应 facet/decisions list 只读 active）与 c（前端自行解析：全量拉 60+ 域文件 N+1 + CLI 机械解析契约前端化双端漂移）经两子代理核对证伪排除。
故障面：解析契约与 CLI 演进漂移——「变更：」行格式属 CLI 机械契约，上游改格式需同步本解析（加版本容错与未知行跳过）。
退役判据：若平台后续引入结构化资产表（CLI 直推 DB），本解析层可退役改读表。

## D-005@v2 接手参数载体从 inject 修正为 takeover 端点
状态：implemented
变更：2026-09-30-tool-report-activation-wrong-machine
锚点：backend/app/modules/daemon/router/session_crud.py（takeover 路由新增处）
最近确认：58a3516c9
理由：接手参数载体为新端点 POST /sessions/{id}/takeover 的 TakeoverRequest（prompt/provider/agent_profile_id/llm_provider_id），语义不变（handoff 档引擎+档案重选，校验所选引擎 ∈ 原机支持集合）。
supersedes：D-005@v1

## D-001@v1 需求范围 = 本地 CLI 会话的 token 用量纳入变更中心统计
状态：implemented
变更：2026-10-02-change-center-token-usage
锚点：未记录
最近确认：0dc1de6bd
理由：A——本地 CLI 会话（用户 AskUserQuestion 确认）。这类会话已建 agent_sessions 行（origin=tool_report，title=「本地 · 变更名」）并经 change_session_links 绑定变更，但其 token 用量不落库（platform_agent_logs 无 token 列），变更中心用量聚合对它们恒为空。需求 = 让这类用量也进变更中心展示，口径与平台执行展示一致。

## D-002@v1 落库触发方式 = 方案 A 上报链路顺带解析（backend 拉）
状态：implemented
变更：2026-10-02-change-center-token-usage
锚点：未记录
最近确认：0dc1de6bd
理由：方案 A（用户 AskUserQuestion 确认）。CLI 每次 POST /api/agent-logs 上报后，backend 异步经现有 WS RPC 通道让 daemon 解析本次涉及 entry 的日志用量并落库。理由：触发高频自然（CLI 每条命令都上报）、复用回放已有的解析器与 RPC 通道、改动集中 backend；daemon 离线仅暂缓（下次上报全量解析幂等补齐）。否决 B（两端改动 + 持续解析开销与观看需求无关）与 C（列表页批量 RPC 爆炸、离线空数据，不可行）。
故障面：后台摄取任务可能因 daemon 离线/超时长期空转记日志（无失败放大，快照滞后）；上报高峰期重复解析受节流钳制但仍有 RPC 开销
退役判据：若后续 daemon 原生周期推送用量（方案 B 复潮条件：多机环境下报频率不足、新鲜度成为实际痛点），本摄取链路可整体下线，落库快照消费端（聚合/展示）不变

## D-001@v1 daemon 上行同步执行「串行两条 CLI」（platform sync --change + platform sync-docs --change）
状态：implemented
变更：2026-10-13-change-files-refresh-sync
锚点：未记录
最近确认：76ea8a958
理由：串行两条：先 `sillyspec platform sync --change X`（spec 树增量 → apply_ops 落平台镜像目录 + 进度六表，文件树变新鲜）再 `sillyspec platform sync-docs --change X`（四件套全文 upsert 进 DB documents 列）。字面与目标双覆盖；无差异时两条均秒级短路。

## D-002@v1 触发机制采用「GET 内同步 RPC」（send_rpc 阻塞等 daemon 跑完再返回）
状态：implemented
变更：2026-10-13-change-files-refresh-sync
锚点：未记录
最近确认：76ea8a958
理由：GET files 端点内经 DaemonWsHub.send_rpc(daemon_id, 'sillyspec_sync_change', {change, workspace_id}, timeout=15) 同步等 daemon 串行跑完两条 CLI 后再 list_files 返回。刷新一次即最新数据；改动面 backend+daemon 两端，前端零改动。

## D-002@v1 日志采用拉取尾部+手动刷新（非实时流）
状态：implemented
变更：2026-10-13-daemon-log-config-view
锚点：未记录
最近确认：255a46d66
理由：用户选「拉取尾部+手动刷新」：点开查看最近 N 行（默认可调），带刷新按钮；不做 WebSocket 实时滚动
故障面：大日志文件全量读取导致 RPC 超时——须在 daemon 侧或 backend 侧限制返回尾部字节上限
退役判据：未来出现「盯日志实时排障」高频诉求时，再评估升级为 WS 实时流（可基于现有 daemon:ws 通道扩展）

## D-004@v1 采用方案 B——daemon 专用诊断 RPC（log_tail + config_get）
状态：implemented
变更：2026-10-13-daemon-log-config-view
锚点：未记录
最近确认：255a46d66
理由：用户选方案 B：daemon 注册 daemon_log_tail 与 daemon_config_get 两个 RPC handler（路径由 daemon 侧 getLogFile()/loadConfig 权威解析，尾部截断与脱敏在源头做），backend 新增转发端点（复制 daemon_rpc.py 先例），前端 /runtimes 机器卡加入口。理由：路径权威（SILLYHUB_DAEMON_DIR 重定向不影响）、大文件不全量传、脱敏贴近数据源
故障面：老 daemon（未升级）无这两个 RPC → method_not_found；需在 backend 映射 422 + 前端升级提示
退役判据：若未来 host_fs RPC 支持按约定 key 寻址 + tail 参数，可考虑合并回通用文件读通道

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-08-backend-dockerfile-apt-mirror-sjtu
锚点：未记录
最近确认：d304aefe57ac5e79cc74c094f21d1760d3e5ac5f
理由：最大风险：sjtu 源将来同样故障/限速（镜像站轮流抽风的先例：aliyun 2026-07-17、tuna 2026-10-08）——已在 Dockerfile 注释里留下完整的换源史与实测数据，下次故障按同模式 5 分钟内可再换。放弃的方案：① 原样重试（已试，两次死同层，tuna 服务端故障非瞬时抖动）；② 换 aliyun/ustc/huawei/http 官方源/deb.debian.org（实测同慢 ≈80KB/s，9.6MB 索引在 apt 超时内下不完）；③ 走本机 Clash 代理（7897 实测 2MB/33s 无改善）；④ 增大 apt 重试次数（传输中断形态重试无效，且要改同一行不如换源）。

## D-unmapped-006@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-15-deploy-records-unicode-tolerance
原编号：D-001@v1
锚点：未记录
最近确认：95d37f93be47e223ffc6a1f405535b13f7de5d20
理由：最大风险：捕获面过宽掩盖真实文件系统问题——不会：仅新增 `UnicodeDecodeError` 一类，OSError 分支语义不变，`parse_error` 仍留原因供排查。试过放弃的方案：① `read_bytes` + 手动 decode 再走解析——双份解码逻辑，容错分支翻倍不值；② 只修 skill 写入侧（强制 utf-8 落盘）——治不了存量坏文件与本机 Windows 手写文件，且 FR-04 已承诺服务端兜底，属治标不治本。

## D-backend-001@v1 检索端点新建（平台用户侧），不复用 CLI 的 shpsync_ 端点
状态：implemented
变更：2026-10-15-platform-knowledge-search
原编号：D-001@v1
锚点：未记录
最近确认：7af8e0e32
理由：现有端点（2026-10-15-platform-vector-search 落地）只接受 shpsync_ workspace token（CLI 契约固化，非 shpsync_ 一律 403），且语料只索引 knowledge/decisions——消费方是 sillyspec CLI，前端 JWT 无法调用。平台用户侧必须新建独立端点；CLI 端点契约零改动（同号消歧/降级纪律是 CLI 侧语义）。
故障面：双端点并存可能造成语料/索引重复建设——通过共享 embedder 单例与解析工具函数收敛（见 D-007）。
退役判据：若 CLI 侧日后改用用户会话调用平台（CLI 本地零凭据约束解除），可评估收敛为单端点。

## D-backend-002@v1 语料范围 = knowledge/ 全域 + docs/ 全域，不含 changes/ 归档
状态：implemented
变更：2026-10-15-platform-knowledge-search
原编号：D-002@v1
锚点：未记录
最近确认：7af8e0e32
理由：用户列举四类映射到 spec 树：知识=knowledge/ 顶层手册（conventions/patterns/known-issues 等）、需求规格=knowledge/fr/、决策=knowledge/decisions/、（另有 proposed/generated 两个 zone 一并纳入）；模块文档=docs/<project>/modules/，随行纳入 docs/<project>/{scan,flows,glossary.md} 等全部 md。changes/（本仓 7550 个 md，归档历史持续增长）不纳入——噪音大、非「理解知识内容」的主场，且与知识库页现有导航面不匹配。
故障面：docs/ 大文件（本仓 frontend.md 120KB、fr/backend.md 350KB）整文件 embed 会爆索引时间与召回精度——由切块策略消化（D-003）。
退役判据：若用户明确要求搜归档变更文档，再评估纳入 changes/ 的独立 scope（分面开关）。

## D-backend-003@v1 切块策略——条目锚点优先（D-xxx@vN / FR-xxx-NNN）+ 标题切块 + 超长滑窗
状态：implemented
变更：2026-10-15-platform-knowledge-search
原编号：D-003@v1
锚点：未记录
最近确认：7af8e0e32
理由：三档策略：① decisions/*.md 按 `## D-xxx@vN 标题` 条目切（复用现有 parse_decision_entries 口径扩展）；② fr/*.md 按 `## FR-xxx-NNN 标题` 条目切；③ 其余 md（模块文档/scan/flows/knowledge 顶层）按 `##`/`###` 标题切块，单块超 1500 字符再按段落滑窗细分（窗 ~1000 字符 / 重叠 ~150 字符）。每块携带 (文件路径, 锚点/标题, 片段起点) 供前端跳转定位。frontmatter 不入 embedding。
故障面：切块粒度不齐会让融合打分跨档不可比——按块文本长度做归一化惩罚（设计细化）。
退役判据：若引入第三方切块库（unstructured 等）且验证更优，可整体替换本策略。

## D-backend-004@v1 检索算法 = 词面 + 向量融合，向量不可用 fail-soft 纯词面
状态：implemented
变更：2026-10-15-platform-knowledge-search
原编号：D-004@v1
锚点：未记录
最近确认：7af8e0e32
理由：双路融合：词面路子串/大小写不敏感匹配（文件名、标题、正文——scan-docs 已有 LIKE 先例；中文短词精确命中向量不敏感场景必须词面兜底）+ 向量路 fastembed bge-small-zh-v1.5 语义召回（复用平台既有 embedding 基建）。两路分数归一化后加权融合。fastembed 缺席/模型加载失败时（容器无模型、显存不足）端点 fail-soft 返回纯词面结果 + model_ready=false 标注，前端降级展示提示。
故障面：权重失当会让语义噪声压过精确词面命中（如搜文件名被近似文本挤掉）——文件名/标题命中给固定高权重保底（设计细化）。
退役判据：若纯向量在真实语料上人工评测优于融合，可简化为单路。

## D-backend-005@v1 鉴权 = JWT 铸造 + KNOWLEDGE_READ 门控，docs/ 结果按 SCAN_DOCS_READ 过滤
状态：implemented
变更：2026-10-15-platform-knowledge-search
原编号：D-005@v1
锚点：未记录
最近确认：7af8e0e32
理由：端点门控 require_permission(KNOWLEDGE_READ)（搜索入口在知识库页，与页内其它读接口同权限）；docs/ 类结果额外检查调用者是否持有 SCAN_DOCS_READ——无则该类结果从响应中过滤（不是 403，知识结果照常返回）。管理员经 is_platform_admin 短路天然全量。
故障面：权限过滤若发生在召回后置阶段，可能把 top-k 挤空导致结果稀薄——取 3×limit 候选再过滤截断（设计细化）。
退役判据：若平台引入统一「知识域」权限（合并 knowledge/scan-docs 读），过滤逻辑随之删除。

## D-backend-006@v1 交互形态 = 知识库页内嵌搜索 + 结果面板 + 双落点跳转
状态：implemented
变更：2026-10-15-platform-knowledge-search
原编号：D-006@v1
锚点：未记录
最近确认：7af8e0e32
理由：知识库页（/workspaces/[id]/knowledge）顶部内嵌搜索框（用户原话场景：方便在知识库里检索数据和理解知识内容）；结果面板展示 来源徽章/文件路径/条目或标题/片段高亮/匹配度。点击落点分两类：knowledge/ 结果 → 既有深链 ?file=&anchor=（page.tsx deepLinkDoneRef 机制现成）；docs/ 结果 → scan-docs 页新增 ?path= 深链（该页现无 URL 参数定位，需补选中逻辑）。片段文本随结果直接展示，不点开也能看到匹配上下文。
故障面：scan-docs 深链若只按 path 精确匹配而 workspace 尚未同步该文件，会静默落空——落空时保持空白态静默（不报错、不提示、不重试请求）；消费时机对策：ref 只在命中并选中后置位，命中前每次列表刷新（含 reparse 静默刷新）重试匹配，目标出现即自动选中（design.md Phase 4，评审 X5 修订）。
退役判据：若日后引入全局 ⌘K 命令面板聚合搜索，页内搜索框可降级为入口之一。

## D-backend-007@v1 索引生命周期 = 懒构建 + 全语料指纹失效，独立于 decisions 向量索引
状态：implemented
变更：2026-10-15-platform-knowledge-search
原编号：D-007@v1
锚点：未记录
最近确认：7af8e0e32
理由：沿用 vector_search.py 已验证的「查询时懒构建 + 文件集指纹 (name, mtime_ns, size) 失效自愈」模式，但**独立索引实例**——现有 _indexes 键是 (workspace_key, model_name) 且条目形态是 DecisionEntry，直接复用会被新语料污染 CLI 召回结果；新建模块（如 search_index.py）自带索引缓存与指纹。首查构建耗时用前端 loading 文案消化；若实测构建 >5s 则在端点内保留可选的启动后台预热钩子（execute 阶段实测拍板）。
故障面：全语料指纹 mtime 轮询在 Windows bind mount 上有 stat 性能断崖（known-issues 有先例）——指纹只 stat 文件不读内容，且构建结果缓存，风险可控；实现时对单次 stat 失败 fail-soft 跳过。
退役判据：若 daemon 上行时能顺带维护持久化索引，可退役进程内懒构建（届时索引落 DB）。

## D-backend-008@v1 实现方案选定——方案 A（新用户侧端点 + 文件系统直读 + 词面/向量融合）
状态：implemented
变更：2026-10-15-platform-knowledge-search
原编号：D-008@v1
锚点：未记录
最近确认：7af8e0e32
理由：（autonomous 会话代拍板——用户未在线，AI 按仓库既有约束与 D-001~D-007 权衡代选方案 A，待用户复核）方案 A：新建独立搜索服务与用户侧端点，spec 根直读文件、结构切块、词面与向量双路融合、进程内懒索引。理由：①唯一不破坏 CLI 契约（B 的问题）又能复用平台 embedding 基建的路径；②文件直读与 vector_search.py 已验证的懒构建同构，故障面最小；③切块/权限/降级全可控。
故障面：前端需同时接两个后端查询面（知识搜索 + scan-docs 列表）做跳转；若 scan-docs 深链不同步做，docs 结果不可直达（风险已记 D-006）。
退役判据：若 B/C 的否决条件消失（见 D-009/D-010 复潮条件），可重议。

## D-backend-009@v1 落选——方案 B（扩展 CLI 向量端点至全语料 + 放开 JWT）
状态：rejected
变更：2026-10-15-platform-knowledge-search
原编号：D-009@v1
锚点：未记录
最近确认：7af8e0e32
理由：（autonomous 会话代拍板落选，待用户复核）不选 B。
否决理由：破坏 CLI 契约——CLI 向量层结果按决策条目 anchor 语义消费（同号消歧/策略面本地解析），混入非决策条目即破坏召回语义；shpsync_ 通道与 JWT 用户会话鉴权模型冲突，强行放开需重造鉴权分支。
复潮条件：CLI 侧检索契约弃用 anchor 语义（或 CLI 全量改用用户会话调用平台）且平台侧统一鉴权通道时，可重议单端点收敛。

## D-backend-010@v1 落选——方案 C（基于 DB 表混合检索：ScanDocument + 新增 knowledge 入库链路）
状态：rejected
变更：2026-10-15-platform-knowledge-search
原编号：D-010@v1
锚点：未记录
最近确认：7af8e0e32
理由：（autonomous 会话代拍板落选，待用户复核）不选 C。
否决理由：knowledge 侧无 DB 表，需新增同步链路（daemon 挂点或轮询），命中既有防复潮死路④；且 D-unmapped-012 死路③（pgvector/DB 往返）同域否决；延迟同步与索引维护复杂度都高于文件直读。
复潮条件：出现跨 workspace 聚合检索需求（单 workspace 文件直读不满足）或语料量级远超万条致文件直读不可行时，可重议持久化索引方案。

## D-backend-011@v1 词面精确命中判定纳入 anchor 面（执行期裁决）
状态：implemented
变更：2026-10-15-platform-knowledge-search
原编号：D-011@v1
锚点：未记录
最近确认：7af8e0e32
理由：task-01 实现将「标题面」精确命中扩展为 anchor ∨ title（anchor 命中与 title 同级 0.6 权重），exact 判定同步纳入 anchor；单测 test_search_exact_decision_id_ranks_first 钉住（rank=1 + score ≥0.9）。
故障面：anchor 命中给 0.6 权重后，短编号前缀查询（如 "D-001"）可能跨文件多条同分——由 tie-break（spec_path, start_line 排序）与 change 字段前端展示消歧，不额外加权。
退役判据：若未来切块改为把编号并入 title 文本（标题行整体作 title），本裁决自然退役。

## D-backend-012@v1 向量索引持久化选型 = PostgreSQL pgvector（用户裁决）
状态：implemented
变更：2026-10-15-knowledge-search-pgvector
原编号：D-001@v1
锚点：未记录
最近确认：898bb901c
理由：用户裁决走 pgvector。重议依据成立：上一变更（2026-10-15-platform-knowledge-search）design R-01 实测首查 304.67s（6586 chunks/437 文件）且语料持续增长，触发其归档决策 D-unmapped-012 死路③的复潮条件「语料量级远超万条致文件直读不可行」的同类信号（重启代价随语料线性恶化）；当时否决前提「2400 条暴力余弦毫秒级、首查秒级可接受」已被 304s 实测打破。选 pgvector 而非本地文件缓存的理由：重启零重建、增长曲线稳定（KNN 毫秒级不随量级退化）、数据可查可运维；复杂度大头（增量同步）两方案等价。
故障面：PG 不可用/表损坏 → 检索降级纯词面（与 embedder 缺席同款 fail-soft，不 5xx）。
退役判据：若未来迁移到专用向量库（milvus/qdrant），本方案整体退役。

## D-backend-013@v1 表结构 = chunks 表 + state 表（workspace 级指纹与模型版本）
状态：implemented
变更：2026-10-15-knowledge-search-pgvector
原编号：D-002@v1
锚点：未记录
最近确认：898bb901c
理由：两表：①knowledge_search_chunks（workspace_id FK、spec_path/kind/title/anchor/start_line/text、embedding vector(512)、行级内容 hash 用于差量比对；索引：workspace_id + 查询用 ivfflat/hnsw cosine——量级 ~7k 起步 hnsw 更优但 PG16 vector 扩展两者皆可，初版建基础索引+KNN，量级到十万再补 ANN 索引）；②knowledge_search_state（workspace_id 唯一、corpus_fingerprint JSON、model_version、updated_at）——指纹存 state 而非逐 chunk，与现有 corpus_fingerprint() 单一源口径一致。ORM 先例对齐 hits.py 的 KnowledgeHit(BaseModel, table=True)。
故障面：bge-small-zh-v1.5 维度 512 硬编码 → 换模型维度变化需迁移改列——model_version 字段触发全量重算兜底，维度变更走显式迁移。
退役判据：无。

## D-backend-014@v1 增量同步 = 查询时指纹比对 + 差量 upsert/delete（无后台任务）
状态：implemented
变更：2026-10-15-knowledge-search-pgvector
原编号：D-003@v1
锚点：未记录
最近确认：898bb901c
理由：沿用现内存方案的懒触发形态：每次查询先算 corpus_fingerprint（全语料 (path, mtime_ns, size) 元组）与 state 表比对——一致直接查库；不一致进入差量同步：逐文件比内容 hash（新文件插入、变更重嵌、消失删除），完成后更新 state。不改 daemon、不加后台任务、不加同步配置——上一变更 D-010 死路④（daemon 挂点）继续规避。首查构建与差量同步走 run_in_threadpool 同款卸载。
故障面：指纹漂移（mtime 变了内容没变）→ 逐文件 hash 层吸收（hash 未变不重嵌，只更新记录）。
退役判据：若引入文件监听（watcher）主动同步，懒触发可退役。

## D-backend-015@v1 查询方言分叉 = PG 走 pgvector KNN；SQLite/降级走候选拉回 Python 余弦
状态：implemented
变更：2026-10-15-knowledge-search-pgvector
原编号：D-004@v1
锚点：未记录
最近确认：898bb901c
理由：查询层按 dialect 分叉：PG → ORDER BY embedding <=> :q LIMIT k（余弦距离，1-distance 转回相似度）；SQLite（测试）→ 拉回该 workspace 全部 chunk 的 embedding（JSON 文本解析）Python 余弦打分（7k 条×512 维纯 Python 毫秒~十毫秒级，测试可接受）。方言分叉先例：patrol.py _dialect_name、scan_docs LIKE 跨方言注释。
故障面：SQLite 路径性能随 chunk 数线性——仅测试环境受影响，量级受控（测试语料人工构造）。
退役判据：测试库换 PG（testcontainers）时统一走 KNN。

## D-backend-016@v2 对外契约零变化 + 执行模型定案（async 编排）——修订 v1 的注入物描述
状态：implemented
变更：2026-10-15-knowledge-search-pgvector
原编号：D-005@v2
锚点：未记录
最近确认：898bb901c
理由：定案方案④（四选一之首）：search_sync 改造为 async 协程——DB await 在调用方事件循环原生执行（全局 async 工厂与 loop 同源，跨 loop 面不存在），CPU/IO（嵌入/文件扫描）经 asyncio.to_thread 卸载；端点直接 await，原 run_in_threadpool 整体卸载退役。注入物 = session_factory（async_sessionmaker，缺省取全局）。对外契约（端点签名/响应形态/api-types/前端）零变化口径不变；search_sync 的 sync→async 属内部协作面（审查判定：内部参数/形态扩展不算对外契约变化）。
supersedes：D-005@v1
故障面：嵌入批量（建库 304s 级）在 to_thread 内执行——事件循环不阻塞，其余请求可并发；长事务持锁窗口 = 同步短会话内（秒级），可接受。
退役判据：无。

## D-backend-017@v1 词面路去内存全量化 = SQL ILIKE 候选 + Python 精确打分
状态：implemented
变更：2026-10-15-knowledge-search-pgvector
原编号：D-006@v1
锚点：未记录
最近确认：898bb901c
理由：不需要：词面候选用 SQL（WHERE title/spec_path/text ILIKE %q% ESCAPE，跨方言对齐 scan_docs LIKE 转义先例）取回候选集，Python 侧按现 _word_score 口径精确打分（anchor/title/path/text 权重与次数增益）。候选集小（命中项），单查开销可控；重启后词面路同样零重建。零信号过滤语义保持。
故障面：ILIKE 候选在中文短查询（单字）可能命中过千 → LIMIT 候选上限 + 提示用户查询过短（沿用现有零信号过滤，超限截断保 top）。
退役判据：若 PG 侧引入全文索引（tsvector/zhparser），词面候选可升级。

## D-backend-018@v1 模型版本管理 = state.model_version 驱动全量重算
状态：implemented
变更：2026-10-15-knowledge-search-pgvector
原编号：D-007@v1
锚点：未记录
最近确认：898bb901c
理由：state 表存 model_version（settings.knowledge_embedding_model 值）；查询时版本不一致 → 全量重嵌（清 chunks 重算），完成后写新版本。embedder 不可用时不动库（纯词面降级不触发重算）。
故障面：全量重嵌期间的长查询——与首查同款（run_in_threadpool + 前端 loading 文案已有）。
退役判据：无。

## D-backend-019@v1 部署变更 = 镜像换 pgvector/pgvector:pg16 + 迁移内装扩展；升级步骤单列
状态：implemented
变更：2026-10-15-knowledge-search-pgvector
原编号：D-008@v1
锚点：未记录
最近确认：898bb901c
理由：①docker-compose 的 postgres 镜像 postgres:16-alpine → pgvector/pgvector:pg16（数据卷不丢，官方同源镜像+vector 扩展）；②扩展安装放 alembic 迁移内（CREATE EXTENSION IF NOT EXISTS vector + 方言守卫——pgcrypto/pg_trgm 同款）；③升级顺序：换镜像重启 PG → 跑迁移 → 重启 backend；④升级前生产库跑验证 SQL（SELECT name FROM pg_available_extensions WHERE name='vector'）确认扩展可用（用户可能手动装过——核实过代码无痕迹，但手工操作查不到）。dev compose 同步换。
故障面：迁移先于镜像替换执行 → 方言守卫内检查 extension 可用性，缺失时报错中止（信息含修复指引），不留半态表。
退役判据：无。

## D-backend-020@v1 落选——本地文件缓存（向量序列化到 .runtime 缓存文件）
状态：rejected
变更：2026-10-15-knowledge-search-pgvector
原编号：D-009@v1
锚点：未记录
最近确认：898bb901c
理由：（用户裁决落选）不选本地文件缓存。
否决理由：重启加载仍需读文件+反序列化（秒级但非零）；数据不可查不可运维（出问题只能删缓存）；与平台既有 PG 基础设施割裂，多一套存储形态。
复潮条件：无 PG 的轻量部署形态（如单机 sqlite 化部署）出现时重议。

## D-backend-021@v1 落选——仅做启动预热（不改存储）
状态：rejected
变更：2026-10-15-knowledge-search-pgvector
原编号：D-010@v1
锚点：未记录
最近确认：898bb901c
理由：（随 D-001 落选）不选纯预热。
否决理由：重启后仍要全量重嵌（只是用户看不到）；语料增长后预热窗口持续变长；CPU 空转浪费。
复潮条件：若 pgvector 部署受阻回退内存方案时，预热作为过渡补丁复潮。

## D-backend-022@v1 同步触发机制选定——方案 A（查询路径内联懒同步）
状态：implemented
变更：2026-10-15-knowledge-search-pgvector
原编号：D-011@v1
锚点：未记录
最近确认：898bb901c
理由：方案 A：查询时指纹比对 → 一致直查库 / 不一致差量同步。理由：用户要买的重启零重建由持久化本身交付，与触发机制无关；A 零新增组件、与现内存懒构建语义同构（迁移面最小）、不加 main.py lifespan 边界；库空首查 304s 为一次性成本（建库本质），loading 文案已有兜底。
故障面：并发首查同时触发同步 → 锁内 single-flight（对齐现 _index_lock，DB 面 = workspace 级行锁或进程锁择一，设计细化）。
退役判据：语料十万级或查询 P95 受指纹 stat 挤压 → 后台同步 + ANN 索引一并重议（方案 B 复潮条件）。

## D-backend-023@v1 落选——方案 B（后台常驻同步协程）
状态：rejected
变更：2026-10-15-knowledge-search-pgvector
原编号：D-012@v1
锚点：未记录
最近确认：898bb901c
理由：（落选）不选后台常驻协程。
否决理由：main.py 边界扩张；空转/周期权衡；同步态与查询态竞态面新增；与「懒触发」决策族（上变更 D-007 + 本变更 D-003）不一致。
复潮条件：语料十万级或 KNN P95 退化时，后台同步 + ANN 索引一并重议。

## D-backend-024@v1 落选——方案 C（首查触发 + 周期刷新混合）
状态：rejected
变更：2026-10-15-knowledge-search-pgvector
原编号：D-013@v1
锚点：未记录
最近确认：898bb901c
理由：（落选）不选混合双通道。
否决理由：两套触发路径 = 最大复杂度；收益与 A 重叠（A 已覆盖查询正确性）；维护两份同步态。
复潮条件：同 D-012。

## D-backend-025@v1 治理技术方案选型——子进程封装 + WS 推送 + 预览持久化（方案 A）
状态：implemented
变更：2026-10-16-backend-mem-polling
原编号：D-001@v1
锚点：backend/app/modules/knowledge/vector_search.py:137
最近确认：439cdc46c
理由：**方案 A**。四个机制组合：①嵌入计算子进程封装（闲置自退+OOM 保主进程）；②change-writes 改 WS 事件推送，30s 轮询降 120s 兜底；③会话标题预览持久化为列；④部署内存配额重分配。

## D-backend-026@v1 深扫发现的三处高危内存缺陷纳入本变更任务面
状态：implemented
变更：2026-10-16-backend-mem-polling
原编号：D-004@v1
锚点：backend/app/modules/knowledge/vector_search.py:168
最近确认：439cdc46c
理由：纳入。①knowledge/vector_search.py `_indexes` 无界索引缓存（LRU 工作区上限）；②spec_workspace/service.py `_bundle_gzip_cache` 无全局帽（128MB LRU）；③permission_service.py 权限定时器 pin 已关 session 且 route_key None 路径不提交（idle-in-transaction 元凶，新开短 session+全路径提交）。中危配套（ws_hub _pending_rpcs 泄漏两径/disconnect 无身份校验/附件先读后检/WS 大消息日志）一并治理。

## D-backend-027@v1 执行期裁决——task-04 disconnect 身份校验需调用方透传 ws（边界微扩）
状态：implemented
变更：2026-10-16-backend-mem-polling
原编号：D-005@v1
锚点：backend/app/modules/daemon/ws_hub.py:114
最近确认：439cdc46c
理由：disconnect 加可选 ws 参数（不传保持旧语义向后兼容）；gateway_misc.py 调用点 +1 行透传。非破坏性（可选参数、1 行接线），随 task-04 一并提交。

## D-backend-028@v1 full-tree 冲突记录的兜底读由后端承担（不是 daemon）
状态：implemented
变更：2026-10-16-conflict-full-tree-compare
原编号：D-001@v1
锚点：未记录
最近确认：d3c425bf6
理由：用户确认放后端——后端在 daemon 返回 `conflict_record_missing` 时，以记录名 `full-tree` 重发快照 RPC，并在平台侧按该变更路径前缀过滤后做对比。理由：平台部署即生效，不依赖每台机器 daemon 自更新（daemon 侧修复要等自更新铺开）。
故障面：缺失场景多一次 RPC 往返；后端必须自证「路径归属」过滤正确——漏过滤会把别的变更的文件混入对比。
退役判据：CLI 侧记录命名与平台行归因口径统一（记录名即变更名）后，本兜底可删。

## D-backend-029@v1 「裁决」本轮不修，跨变更记录的裁决留 CLI 侧后续 change
状态：implemented
变更：2026-10-16-conflict-full-tree-compare
原编号：D-002@v1
锚点：未记录
最近确认：d3c425bf6
理由：用户确认本轮只修对比+文案；裁决入口行为保持现状，平台对该类行的正确引导是「重新同步」或 CLI 侧 `sillyspec platform resolve full-tree`；CLI 口径改动另开 change。

## D-backend-030@v1 新增平台侧「标记已处理」关闭入口（复用已有 resolve 接口）
状态：implemented
变更：2026-10-16-conflict-full-tree-compare
原编号：D-003@v1
锚点：未记录
最近确认：d3c425bf6
理由：用户确认加——冲突行上加「标记已处理」，调用已有 `POST /api/workspaces/{workspace_id}/spec-conflicts/{conflict_id}/resolve`，仅可操作者（canOperate）可见/可点。

## D-backend-031@v2 兜底裁剪输入面与来源提示语义修订（supersedes D-006@v1）
状态：implemented
变更：2026-10-16-conflict-full-tree-compare
原编号：D-006@v2
锚点：未记录
最近确认：d3c425bf6
理由：修订为——归属校验与裁剪一律以 **`snapshot.files[].path`** 为输入（entry 保持完整，与 `_build_spec_tree_compare` 的消费面一致）；`path_total` 语义＝**兜底快照返回的路径总数**（受 daemon 300 路径帽截断，不声称记录真实总数）；来源提示为**固定说明行、无关闭控件**（告知性质；如需关闭控件另开）。
supersedes：D-006@v1

## D-backend-032@v1 实现方案选定——后端「失败即重试 full-tree」兜底（方案 A）
状态：implemented
变更：2026-10-16-conflict-full-tree-compare
原编号：D-009@v1
锚点：未记录
最近确认：d3c425bf6
理由：用户选定方案 A：compare 端点收到 `conflict_record_missing` 时以 `change='full-tree'` 重发一次快照 RPC，后端校验该变更路径在记录内并裁成该变更范围后走既有 diff；响应标注记录来源。理由要点：与 D-001 一致（平台侧落地、无 daemon 依赖）、落地面最小、部署即生效；B/C 的抗未来命名变化收益在 CLI 口径未变前属过度设计且需跨端发布。
故障面：多一次 RPC 往返（仅缺失场景）；裁剪逻辑若按前缀误配（如变更名前缀互相包含）会把无关路径带入——实现需按 `changes/(archive/)?<change>/` 段边界匹配并以测试钉住。
退役判据：CLI 记录命名与平台行归因口径统一（记录名=变更名）后，兜底删除回落到单次 RPC。

## D-backend-033@v1 落选——平台行携带记录名（方案 B）
状态：rejected
变更：2026-10-16-conflict-full-tree-compare
原编号：D-010@v1
锚点：未记录
最近确认：d3c425bf6
理由：方案 B 落选（用户选 A）。
否决理由：需改外部 CLI 仓并发布，存量行无该字段仍要兜底，跨仓联动周期长、收益兑现慢。
复潮条件：CLI 侧因其他需求必须改动 spec-sync 推送负载（顺带携带记录名零成本）时，可重议并以「记录名直读」取代名字兜底。

## D-sillyhub-daemon-001@v1 落选——新增 daemon「列记录」RPC（方案 C）
状态：rejected
变更：2026-10-16-conflict-full-tree-compare
原编号：D-011@v1
锚点：未记录
最近确认：d3c425bf6
理由：方案 C 落选（用户选 A）。
否决理由：必须等 daemon 自更新铺开才生效，新增 RPC 带来协议/权限/测试成本，而当前机器侧只有 full-tree 一种已成形形态，收益是假想的未来变化。
复潮条件：机器侧出现第三种以上记录命名形态（如按工作区/轮次改名）导致「猜名字」清单不可维护时，重议升级为目录发现。

## D-backend-034@v1 首轮独立审查其余修订项（分支键/失效键/关闭范围/保真损失）
状态：implemented
变更：2026-10-16-conflict-full-tree-compare
原编号：D-012@v1
锚点：未记录
最近确认：d3c425bf6
理由：全部按审查结论修订进 design/requirements/tasks——①失败卡分支键＝`details.daemon_code`（daemon 业务失败时外层 `ApiError.code` 恒为 `HTTP_502_DAEMON_RPC_REMOTE`，不可作键；离线/超时臂按外层 `HTTP_504_DAEMON_RUNTIME_OFFLINE` / `HTTP_504_DAEMON_RPC_TIMEOUT`）；②关闭成功后 invalidate 键＝`["platform-sync-section","spec-conflicts",workspaceId]`（`QUERY_KEY_ROOT=["platform-sync-section"]` 实际值）；③「标记已处理」关闭范围＝整条注册表记录（一条记录可含多个变更名，并列展示的兄弟行会一起消失），写进确认文案并记 R-07；④兜底命中时 `ql_id` 恒 null、archive 路径排序沉底、>300 路径时属该变更的路径可能被帽截掉（表现为缺路径）——均接受为已知边界，记 R-08/R-02。

## D-backend-035@v1 方案 A——平行状态接口 + 前端 join（选定）
状态：implemented
变更：2026-10-25-explorer-git-status
原编号：D-007@v1
锚点：sillyhub-daemon/src/daemon.ts:7803
最近确认：19783ad99
理由：用户选定方案 A——daemon 新增「改动文件清单」（porcelain v2 文件行 + ignored --directory 聚合 + numstat）与「工作区单文件 vs HEAD diff」两个平名 RPC，backend 暴露两个只读端点；前端一次拉清单建 path→status 映射，explorer 树着色与 Git 日志页修改集合同源消费
故障面：状态清单为拉取式快照，daemon 侧文件变动后页面不自动变色——需手动刷新或重新进页
退役判据：出现「多端同改工作区需秒级感知」的真实场景时重议推送（见 D-009）

## D-backend-036@v1 覆盖范围=盲区补齐 + 轮内统一阶段轴
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-002@v1
锚点：`backend/app/modules/daemon/control_commands.py`、`sillyhub-daemon/src/daemon.ts`
最近确认：cf17c6a9f
理由：盲区+统一阶段轴——静默盲区（平台转发→执行器领取→启动准备→等待首响）补齐信号，并把 AI 干活期间已有信号（执行命令/工具调用/输出间隙）统一映射到同一阶段文案体系。
故障面：统一阶段轴依赖三端词表同步——任一端词表漂移（新增 phase 未同步前端映射）会显示原始英文 phase 值；已由兼容策略「未知 phase 显示原始字符串兜底」覆盖。
退役判据：若阶段体系演进为服务端驱动的通用任务阶段模型（跨会话/任务类型复用），本词表并入更大模型后本决策由 v2 收编。

## D-backend-037@v1 实现方案=方案 A 阶段事件推送（新增 turn_phase 事件 kind）
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-004@v1
锚点：`backend/app/modules/daemon/router/notify.py`、`sillyhub-daemon/src/daemon.ts`、`frontend/src/lib/daemon/session-sse.ts`
最近确认：cf17c6a9f
理由：方案 A——新增会话 SSE 事件 kind `turn_phase`。启动准备各步骤边界由 daemon 经既有 endStep 钩子新增 HTTP 上报端点发出（照抄 notify_bash_status 已验证模式）；平台转发段由 backend 在控制指令状态机翻转点（delivered/acked）直接发布（零 daemon 改动）；轮内阶段由已有事件映射。前端 SessionEventKind 加 kind、分发器加 case、状态条消费。
故障面：SSE 无历史（Redis pub/sub 无持久化），断线/刷新期间错过的阶段事件不可回放，重连后只能显示最新已知阶段或回退兜底文案——属轻量形态（D-001）可接受范围。
退役判据：若后续引入会话事件持久化回放（可查询历史阶段轨迹），单行实时文案可升级为轨迹回看而不废弃事件本身。

## D-backend-038@v1 delivered 阶段挂 ack 回执点（非 mark_delivered push 成功点）
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-011@v1
锚点：backend/app/modules/daemon/control_commands.py:331
最近确认：cf17c6a9f
理由：我的判断：挂 **ack 回执点**——「执行器已接收」以 daemon 真实确认为准；mark_delivered（control_commands.py:233）与 ack（:331）是状态机两个不同时刻，daemon 离线补拉时差可达分钟级，挂 push 成功点会在离线场景显示假「已接收」。
故障面：ack 回执路径需能拿到 session_id/run_id（控制指令 payload 反查），若 ack 处理缺上下文需补传递。
退役判据：无——挂点跟随状态机语义，状态机不变则不变。

## D-backend-039@v1 SSE 键名三端逐字对齐（phase/detail/timestamp）
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-012@v1
锚点：backend/app/modules/daemon/run_sync/service/publish.py、frontend/src/lib/daemon/session-sse.ts:160
最近确认：cf17c6a9f
理由：我的判断：以发布侧组装为单一事实源，三端逐字对齐为 `phase` / `detail` / `timestamp`（timestamp 复用前端信封既有字段名）——SSE 透传层原样转发不改名（agent/service.py transparent passthrough 实证），键名不一致字段必丢且无映射层。
故障面：后续新增 phase 事件字段时同样必须三端同提交（与 WS 消息类型双侧契约同性质）。
退役判据：无——键名契约长期有效。

## D-backend-040@v1 阶段展示精度包——at 时钟源/run_id 必填/轮终态清理/防重键/并行边界
状态：implemented
变更：2026-10-26-session-stage-progress
原编号：D-013@v1
锚点：frontend/src/components/daemon/session-panel/turn-state.ts、sillyhub-daemon/src/interactive/session-manager/events.ts
最近确认：cf17c6a9f
理由：我的判断：① at=客户端本地 Date.now()（事件到达时刻，规避时钟偏移）；② run_id 必填（daemon 恒带 firstRunId，daemon.ts:9522 守卫后必非空——「create 前 run 未定」原假设与代码不符），前端对缺失 run_id 的 phase 事件防御丢弃；③ turn_completed/failed/killed 终态分支清空 currentPhase（兑现 R-01「不显示陈旧值」，防断线场景假超时警示）；④ first_event 防重键=(session_id, run_id)（run 级标志，新 AgentRun 自然重置）；⑤ 冷启动三步 Promise.all 并行保持独立上报+覆盖式刷新（跳动亚秒级真实，聚合文案违背轻量）；SWR 跳过步不发事件。
故障面：终态清理若漏接（如新增终态类型未清 phase）会复现假警示——测试断言面需覆盖全部终态枚举。
退役判据：无——精度规则跟随轮生命周期语义。

## D-frontend-024@v1 长操作实时感知走独立 turn_heartbeat 事件通道
状态：implemented
变更：2026-10-29-engine-live-perception
原编号：D-001@v1
锚点：sillyhub-daemon/src/types.ts:AgentEvent
最近确认：de68b356befe540e0c77695de92216fb36c1a5e9
理由：用户选定方案二（新增独立心跳事件），事件名细化为 turn_heartbeat（防与 hub-client 机器级 heartbeat 同名混淆，命名细化不改变决策语义）。载荷：kind（awaiting_first_token/generating_tool_args/generating_text）+ est_chars/est_tokens + precision（authoritative/estimated）+ source + parent_tool_use_id；不落库只透传、节流 1s、估算系数 3.5 字符/token（三项 agent 代定，用户核阅无异议）。估算值与权威 usage 彻底分道：预算软切断、计费聚合、ctx 环零污染（对齐 2026-08-27「实时/终态口径必须同类」）；前端专道消费，估算补显标「约」+弱化灰、权威值落定即隐。
故障面：心跳节流器/计数器轮结束未清理导致跨轮残留（R-02）；估算值误入聚合（R-03，类型级排除防护）
退役判据：引擎侧（Claude SDK/智谱/codex）原生提供流式 usage 增量且覆盖工具参数期时，本心跳桥接层可简化退役
