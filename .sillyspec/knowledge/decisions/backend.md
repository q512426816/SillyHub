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
