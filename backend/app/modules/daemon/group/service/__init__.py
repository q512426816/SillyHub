"""群聊管理服务（2026-09-01-session-group-chat task-02/03/04/06，design §3/§4/§5/§6.1/§8）。

群 CRUD / 成员管理 / 参与者制权限（``_require_group_member`` 两段式：群成员表
命中 → workspace admin → 404 统一 AppError 不泄露存在性，照
``file_artifacts._check_session_permission`` 先例）。task-03 落群消息与 @触发
管线（design §4.1-4.3）：

- 建群 = 群时间线会话 ``AgentSession(kind='group', status='active')``（无
  lease，design §8 group.created）+ ``AgentGroupChat`` 聚合根行 + 初始成员
  （建群者自身也落用户成员行——§5.3 参与者制的成员判定覆盖群主）；
- ``AgentGroupChat.id == AgentGroupChat.session_id == 群会话 id``（design
  §3.2「id 即群会话的 session_id」不变式；端点 ``/group-chats/{id}`` 的 ``id``
  即群会话 id，群 SSE 复用现有 ``/sessions/{id}/stream`` 天然同 id）；
- 解散 / 移除 agent 成员：对 ``shadow_session_id`` 非空成员走既有会话 end 链
  （服务身份=群主 user_id）+ 影子队列 pending 行删除（design §8
  group.member.removed「防终态后静默丢弃」）；
- 群消息（task-03，§4.1）：载体 run（``status='completed'`` + ``started_at``
  + ``spec_strategy='group_carrier'``）+ ``user_input`` 原文落库 + 群频道
  ``log`` 事件（sender 身份字段，payload 形态照 run_sync session channel log
  事件扩展）→ ``_parse_group_mentions`` @解析 → 命中 agent 成员触发；
- 影子懒建（task-03，§4.3）：成员首次被触发时照 worker 三件套（``_dispatch_
  worker_core`` 先例）——直接 ORM 建行（不走 create_session，审批开关生效位
  在 ``AgentSession.config`` 列）+ ``prepare_interactive_dispatch``（pinned
  runtime + grants 授权分支 ``skip_owner_check=False``，**不照抄 worker 的
  豁免**——群成员机器是群主任意选择的，必须走授权校验，design D-010）+ 回填
  成员表 ``shadow_session_id``/``shadow_status='active'``；``parent_session_id``
  恒 NULL（D-007，§5.1 硬约束：影子挂 parent 会被 5 处 worker 判定链路误杀）；
- 注入（§4.3）：首轮 = 成员简报 + 群背景摘要（§4.2）+ 当前消息，经 lease
  metadata prompt + SESSION_INJECT 控制指令下发（照 create_session 尾段）；
  复用轮走 ``inject_session_as_service``（quick 2026-09-02 忙轮策略翻转：
  忙轮 ``busy_strategy="inject"`` 直接注入当前活跃轮 steering——run_id 沿用
  活跃 run 不建新轮，prompt 头部包中途标注行，409 竞态降级回排队兜底；
  排队快照仍按入队时刻冻结，design §9.7）；run 挂群主 user_id（§9.2 计量
  归属），群链路 metadata（source_group_id/source_member_id/
  source_carrier_run_id/chain_depth/sender_user_id）写本轮 user_input 日志
  ``metadata_`` 列（task-04 互@检测读取）。

权限模型（design §5.3，单聊 kind='chat' 零改动铁律）：

- 任意用户成员：读群（列表/详情/消息/SSE）+ 发消息（§6.1）；
- 群主（+workspace admin）：改设置 / 加删成员 / 解散（§6.1 权限表）；
- 非成员（含普通 workspace 成员）：一律 404，不泄露群存在性。

跨模块权限分支的共享入口：``get_group_accessible_session`` 供
daemon/session/service.py 四处改造点与 daemon/router.py SSE 内联校验懒加载
复用（chat 形态返回 None → 调用方保持原属主路径逐字节不变）。

task-06（design §5.4 实时通道，纯 ephemeral 纪律——不落库不进 AI 上下文不进
群背景摘要）：

- typing：``publish_typing``（端点 ``POST /{id}/typing`` 体）与 agent typing
  自动事件（``_publish_agent_typing_event``，影子 run 开始时发）都 publish 到
  ``group_typing:{group_id}`` 频道——Redis pub/sub 即发即忘，无 key 无存储；
  群 SSE 生成器双订阅本频道合流（订阅侧在 agent/service.py）；
- presence：``group_presence_key`` 单源命名（连接级后缀，群在线实时化 quick
  2026-09-04：同用户多标签页各自 touch）+ ``get_online_member_ids`` 读
  ``group_presence:{gid}:*`` 活跃集（群列表/详情 online_member_ids 消费）；
  touch（SET EX 60 续期）挂在 SSE 生成器（agent/service.py，间隔 45s）；
  上/下线事件（``publish_member_presence`` / ``release_member_presence``，
  SSE 连接建立/断开触发）与 typing 帧同频道合流即时下发——前端在线绿点
  免等列表刷新；
- audience：群操作（建/改/解散/成员变更）经 ``_publish_group_sessions_changed``
  广播 ``agent_sessions:changed``，payload 内嵌全部未移除用户成员 id
  （``audience_user_ids``），订阅侧过滤免每事件查库。

@全体并行触发（群 P2 第二波，2026-09-02）：design §4.1 写「并行」——单请求
AsyncSession 不可并发使用（SQLAlchemy asyncio 约束），实现按 ``dispatch_
next_queued_message`` 的独立 session 工厂模式落地：``send_group_message``
触发编排改为 ``asyncio.gather``（每成员一协程，协程内 ``get_session_factory()``
开独立短 session、重取 group/member/members 行后调同一 ``_trigger_group_member``
——单成员触发路径零变化）；懒建 + readiness wait 在各协程内并行等待（总耗时
= max 而非 sum）；异常项走既有部分失败收集（AppError → ``error`` 字段 + 群
频道系统行，非 AppError 照旧 fail-loud 整条抛）；``triggered`` 按 gather 保序
= 成员序（joined_at）重排。互@路径（``run_cross_mention_detection``，护栏
串行语义）保持顺序触发不变。

task-04（design §4.4 互@协作 / §4.5 配置热切换 / §8 member.config.switched）：

- 互@检测（``run_cross_mention_detection``）：run_sync ``close_interactive_run``
  群 turn_completed 后挂接（该文件不在本卡 allowed_paths——挂接为最小连带
  调用，编排/护栏全在本模块）。读群开关 ``agent_cross_mention`` → 载体 run
  投影行聚合为本轮最终回复文本 → ``detect_cross_mentions`` 复用 @解析（不
  自我 + 仅 agent 成员）→ 命中成员走与用户 @ 相同的 ``_trigger_group_member``
  管线（注入 prompt 当前消息标注「来自 Agent 成员的协作请求」）；
- Redis 防环护栏（全带 TTL 自清理，不建表）：``group_chain:{载体run_id}``
  Hash=链内成员去重集 + ``depth`` 计数（TTL 30min，触发即刷新；用户 @ 直
  触发成员入链深度 0，互@触发沿用原链深度 +1）；``group_rate:{群id}:{成员id}``
  INCR+EXPIRE 60s 滑窗限频（每分钟 6 次，超限群频道系统提示行）。Redis 不可
  用时互@侧 fail-closed（跳过全部触发防环），用户 @ 主链路不受影响；
- 热切换（``update_member`` 六要素 diff）：模型组（provider/llm_provider/
  agent_profile）→ 影子三列同步 + ``inject_session_as_service`` 空 prompt
  静默切换轮（SESSION_SWITCH_CONFIG 下轮边界生效，SDK resume id 不变记忆
  延续）；机器组（runtime/workspace）→ end 影子 + ``pending`` + 指针置空
  （下次触发懒重建，记忆重置）。

quick 群 PPM 项目化+成员头像（2026-09-02）：建群 ``project_id`` 必填，群
workspace 由项目关联工作区集推导（显式传入须在集内 / 未传取首个 / 无关联
400）；建群者与受邀用户须为项目成员（``PpmProjectMember``）；agent 成员
cwd 工作区同样须在项目关联集内。存量群（project_id NULL，含项目删除后
SET NULL 的群）加成员回退 workspace 成员范围。成员 ``avatar``（文件中心
URL）用户与 agent 成员共用，读写透传（None=不改）。

quick 群成员团队能力（2026-09-02）：agent 成员 ``team_enabled`` 开关——开启
后影子懒建 lease stage 用 'orchestrator'（命中 daemon isMainAgentSession 谓词
→ 注入 dispatch_worker 等 5 主控工具，mission 懒建回填链天然兼容），成员简报
追加团队能力段；仅 Claude 引擎可开（建群/加成员/PATCH 三处 400 门控）；热切
换归机器组重建分支（stage 随 lease 建时定，复用轮改不掉）。

quick 群 P2（2026-09-02）四项（全部复用 settings_json，零迁移）：

- 置顶消息：``settings_json.pinned`` 存快照（一次一条，新置顶覆盖旧的），
  ``pin_message``/``unpin_message``（群主/admin）校验目标 log 属本群时间线后
  落库 + 群频道系统行；列表/详情 Read 透出；
- typing 草稿预览默认关：``settings_json.typing_preview``（默认 False——只显
  示「正在输入」不发草稿；True 才随 typing 事件带 preview，入参在关闭时丢弃），
  PATCH 可配；
- 触发失败不再整条抛：``send_group_message`` 逐成员触发捕获 AppError → 中文
  原因摘要进 ``triggered[].error`` + 群频道系统行「成员「X」触发失败：{原因}」，
  其余成员照常触发（消息已落时间线语义不变——部分失败收集替代 fail-loud）；
- @我扫描窗口：``GROUP_LAST_MENTION_SCAN_ROWS`` 20 → 200。

quick 群 P2 第二波（2026-09-02）三项：

- @全体并行触发：见上方「@全体并行触发」段——gather + 每成员独立 session；
- 消息引用回复：``GroupMessageSendRequest.reply_to_log_id`` 校验属本群时间线
  （``_get_timeline_row``，跨群/不存在 404），发送时 user_input 行 metadata 落
  ``reply_to: {log_id, member_name, content_head(60)}`` 快照 + 群频道 log 事件
  payload 透传同结构（回放走 logs DTO metadata 已透出，无需改）；
- 未读位点（服务端）：成员表 ``last_read_at`` 列（迁移 20260902120000）；
  ``PUT /group-chats/{gid}/read``（成员校验，无 body，服务端置 now()）；发送
  消息顺带推进发送者位点（自己发的不算未读）；群列表/详情 Read 加
  ``last_message_at``（时间线最新行 ts）+ ``unread_count``（last_read_at 为
  NULL → 全量；否则 ts > 位点的行数；显示 cap 99+）。

拆分说明（task-09，2026-09-07-arch-large-file-split design §5 Wave 2）：本文件
原为 4844 行单模块 ``group/service.py``，已升级为 10 文件同名包——mentions
（@解析/互@检测编排）/ settings（guardrail 三件套 + 护栏常量）/ typing_
presence（typing/presence Redis 层 + 群频道 publish helper 与系统提示行）/
timeline_reads（读模型三连）/ helpers（错误族 + DTO + 参与者判定 + 实例级
共享 helper）/ shadow（触发与影子会话懒建簇）/ members（成员管理簇）/
messages（消息发送簇 + 影子直聊）/ crud（群 CRUD + 置顶/已读）。本
``__init__`` 是兼容层：

- ``GroupChatService`` 类壳保留全部方法签名（公共签名逐一不变），方法体一行
  委托到子模块函数（第一参数传 service 实例）；导入路径
  ``from app.modules.daemon.group.service import GroupChatService`` 零变化；
- 聚合重导出拆前命名空间的全部被消费符号（task-06 基线 42 符号 + 错误族/
  DTO/私有 helper 完整导出面）。

patch 兼容（D-007，本拆分最高风险点）：本命名空间保留 ``SessionService``
（15 处 patch + test_group_chat_management 类属性别名 setattr）与 ``get_redis``
（18 处 patch）绑定；子模块一律 ``import app.modules.daemon.group.service as
_gsvc`` 后 ``_gsvc.<符号>`` 延迟解析，既有 33 处
patch("app.modules.daemon.group.service.<sym>") 全部继续拦截。
``GROUP_LAST_MENTION_SCAN_ROWS`` 定义于 timeline_reads、经本命名空间重导出，
消费点经 ``_gsvc.`` 取值（test_group_p2 别名 setattr 继续生效）。
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

# D-007 patch 绑定（18 处 patch）：子模块经 _gsvc.get_redis() 延迟解析。
from app.core.redis import get_redis
from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.agent.schema import (
    GroupChatCreate,
    GroupChatRead,
    GroupChatUpdate,
    GroupMemberCreate,
    GroupMemberRead,
    GroupMemberUpdate,
)
from app.modules.auth.model import User

# D-007 patch 绑定（15 处 patch + test_group_chat_management.py:1202 类属性
# setattr）：影子 end/注入/打断链路的 SessionService 构造点一律经
# _gsvc.SessionService 延迟解析。
from app.modules.daemon.session.service import (
    DaemonSessionTurnConflict,
    SessionService,
)
from app.modules.daemon.session_events import (
    SessionChangeEvent,
    publish_sessions_changed,
)

log = get_logger(__name__)

# ── 聚合重导出（import 面 + patch 面，D-006/D-007）─────────────────────────
from .helpers import (  # noqa: E402
    _LLM_PROVIDER_MISSING_WARNING,
    GROUP_AGENT_MEMBER_LIMIT,
    GROUP_CARRIER_SPEC_STRATEGY,
    GROUP_MEMBER_STAGE,
    GROUP_SESSION_PROVIDER,
    GROUP_USER_MEMBER_LIMIT,
    RESERVED_DISPLAY_NAMES,
    SHADOW_DIRECT_SOURCE,
    GroupChatCreateRead,
    GroupChatForbidden,
    GroupChatInvalid,
    GroupChatMemberNotFound,
    GroupChatNotFound,
    GroupChatPinnedRead,
    GroupDirectMessageRead,
    GroupMemberAddRead,
    GroupMemberInterruptRead,
    GroupMemberNoActiveRun,
    GroupMemberTriggerRead,
    GroupMessageNotFound,
    GroupMessageSendRead,
    _attachment_prompt_lines,
    _attachment_summary_rows,
    _build_config_snapshot,
    _build_llm_provider_warnings,
    _ensure_display_name_available,
    _group_pinned_snapshot,
    _rebuild_config_snapshot,
    _user_display_name,
    _validate_display_name,
    get_active_user_membership,
    get_group_accessible_session,
    get_group_chat_by_session,
    resolve_shadow_member,
)
from .mentions import (  # noqa: E402
    _MENTION_BOUNDARY_CHARS,
    _MENTION_TOKEN_RE,
    BROADCAST_MENTION_WORDS,
    _has_broadcast_mention,
    _load_run_reply_text,
    _mention_match,
    _parse_group_mentions,
    _register_chain_members,
    detect_cross_mentions,
    group_chain_key,
    group_rate_key,
    run_cross_mention_detection,
)
from .messages import (  # noqa: E402
    _SHADOW_DIRECT_HEADER,
    prepare_shadow_direct_turn,
)
from .settings import (  # noqa: E402
    _GUARDRAIL_FIELD_RANGES,
    GROUP_CHAIN_DEPTH_FIELD,
    GROUP_CHAIN_TTL_SECONDS,
    GROUP_CROSS_MEMBER_TRIGGER_LIMIT,
    GROUP_RATE_LIMIT_PER_MINUTE,
    GROUP_RATE_WINDOW_SECONDS,
    _group_guardrail_settings,
    _group_typing_preview_enabled,
    _merge_group_settings_json,
    _validate_guardrail_overrides,
)
from .shadow import (  # noqa: E402
    _GROUP_REPLY_MARKER_REQUIREMENT,
    _MID_TURN_NOTICE,
    GROUP_CONTEXT_ENTRY_MAX_CHARS,
    GROUP_CONTEXT_TOTAL_MAX_CHARS,
    _build_group_prompt,
    _load_group_context_lines,
)
from .timeline_reads import (  # noqa: E402
    GROUP_LAST_MENTION_SCAN_ROWS,
    GROUP_LAST_MESSAGE_PREVIEW_CHARS,
    GROUP_UNREAD_DISPLAY_CAP,
    _get_active_memberships,
    _timeline_row_source,
    get_group_unread_counts,
    get_last_mention_previews,
    get_last_message_previews,
)
from .typing_presence import (  # noqa: E402
    GROUP_TRIGGER_FAIL_REASON_MAX_CHARS,
    GROUP_TYPING_PREVIEW_MAX_CHARS,
    _presence_payload,
    _publish_agent_typing_event,
    _publish_group_channel_event,
    _publish_group_typing_event,
    _publish_member_interrupted_notice,
    _publish_rate_limit_notice,
    _publish_trigger_failed_notice,
    _scan_matching_keys,
    _trigger_failure_reason,
    _typing_payload,
    get_online_member_ids,
    get_online_member_ids_bulk,
    group_presence_key,
    group_typing_channel,
    publish_member_presence,
    release_member_presence,
)

# 导出面清单（task-06 基线 42 符号 + 错误族/DTO/私有 helper + patch 专用
# 绑定）——显式声明兼容面，杜绝子模块内部符号意外泄漏 / 遗漏。
__all__ = [
    "BROADCAST_MENTION_WORDS",
    "GROUP_AGENT_MEMBER_LIMIT",
    "GROUP_CARRIER_SPEC_STRATEGY",
    "GROUP_CHAIN_DEPTH_FIELD",
    "GROUP_CHAIN_TTL_SECONDS",
    "GROUP_CONTEXT_ENTRY_MAX_CHARS",
    "GROUP_CONTEXT_TOTAL_MAX_CHARS",
    "GROUP_CROSS_MEMBER_TRIGGER_LIMIT",
    "GROUP_LAST_MENTION_SCAN_ROWS",
    "GROUP_LAST_MESSAGE_PREVIEW_CHARS",
    "GROUP_MEMBER_STAGE",
    "GROUP_RATE_LIMIT_PER_MINUTE",
    "GROUP_RATE_WINDOW_SECONDS",
    "GROUP_SESSION_PROVIDER",
    "GROUP_TRIGGER_FAIL_REASON_MAX_CHARS",
    "GROUP_TYPING_PREVIEW_MAX_CHARS",
    "GROUP_UNREAD_DISPLAY_CAP",
    "GROUP_USER_MEMBER_LIMIT",
    "RESERVED_DISPLAY_NAMES",
    "SHADOW_DIRECT_SOURCE",
    "_GROUP_REPLY_MARKER_REQUIREMENT",
    "_GUARDRAIL_FIELD_RANGES",
    "_LLM_PROVIDER_MISSING_WARNING",
    "_MENTION_BOUNDARY_CHARS",
    "_MENTION_TOKEN_RE",
    "_MID_TURN_NOTICE",
    "_SHADOW_DIRECT_HEADER",
    "DaemonSessionTurnConflict",
    "GroupChatCreateRead",
    "GroupChatForbidden",
    "GroupChatInvalid",
    "GroupChatMemberNotFound",
    "GroupChatNotFound",
    "GroupChatPinnedRead",
    "GroupChatService",
    "GroupDirectMessageRead",
    "GroupMemberAddRead",
    "GroupMemberInterruptRead",
    "GroupMemberNoActiveRun",
    "GroupMemberTriggerRead",
    "GroupMessageNotFound",
    "GroupMessageSendRead",
    "SessionChangeEvent",
    "SessionService",
    "_attachment_prompt_lines",
    "_attachment_summary_rows",
    "_build_config_snapshot",
    "_build_group_prompt",
    "_build_llm_provider_warnings",
    "_ensure_display_name_available",
    "_get_active_memberships",
    "_group_guardrail_settings",
    "_group_pinned_snapshot",
    "_group_typing_preview_enabled",
    "_has_broadcast_mention",
    "_load_group_context_lines",
    "_load_run_reply_text",
    "_mention_match",
    "_merge_group_settings_json",
    "_parse_group_mentions",
    "_presence_payload",
    "_publish_agent_typing_event",
    "_publish_group_channel_event",
    "_publish_group_typing_event",
    "_publish_member_interrupted_notice",
    "_publish_rate_limit_notice",
    "_publish_trigger_failed_notice",
    "_rebuild_config_snapshot",
    "_register_chain_members",
    "_scan_matching_keys",
    "_timeline_row_source",
    "_trigger_failure_reason",
    "_typing_payload",
    "_user_display_name",
    "_validate_display_name",
    "_validate_guardrail_overrides",
    "detect_cross_mentions",
    "get_active_user_membership",
    "get_group_accessible_session",
    "get_group_chat_by_session",
    "get_group_unread_counts",
    "get_last_mention_previews",
    "get_last_message_previews",
    "get_online_member_ids",
    "get_online_member_ids_bulk",
    "get_redis",
    "group_chain_key",
    "group_presence_key",
    "group_rate_key",
    "group_typing_channel",
    "log",
    "prepare_shadow_direct_turn",
    "publish_member_presence",
    "publish_sessions_changed",
    "release_member_presence",
    "resolve_shadow_member",
    "run_cross_mention_detection",
]

# ── 子模块（import 即注册；GroupChatService 类壳在其后定义。仅列持有方法体
# 下沉的 6 个——mentions/settings/timeline_reads 纯模块级函数，经上方聚合重
# 导出块加载即可）────────────────────────────────────────────────────────────
from . import crud as _crud  # noqa: E402
from . import helpers as _helpers  # noqa: E402
from . import members as _members  # noqa: E402
from . import messages as _messages  # noqa: E402
from . import shadow as _shadow  # noqa: E402
from . import typing_presence as _typing_presence  # noqa: E402


class GroupChatService:
    """群管理面业务逻辑（router 薄壳，全部逻辑与权限在此；task-09 拆分类壳）。

    类壳保留全部方法签名（公共签名逐一不变），方法体一行委托到子模块函数
    （第一参数传 service 实例——``self._session`` 经 ``svc._session`` 显式
    传参）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 权限（design §5.3）───────────────────────────────────────────────────

    async def _require_group_member(
        self, group: AgentGroupChat, user: User
    ) -> AgentGroupMember | None:
        return await _helpers._require_group_member(self, group=group, user=user)

    async def _require_group_owner(self, group: AgentGroupChat, user: User) -> None:
        return await _helpers._require_group_owner(self, group=group, user=user)

    async def _get_group(self, group_id: uuid.UUID) -> AgentGroupChat:
        return await _helpers._get_group(self, group_id=group_id)

    async def _get_group_locked(self, group_id: uuid.UUID) -> AgentGroupChat:
        return await _helpers._get_group_locked(self, group_id=group_id)

    # ── 查询 helper ──────────────────────────────────────────────────────────

    async def _list_members(self, group_id: uuid.UUID) -> list[AgentGroupMember]:
        return await _helpers._list_members(self, group_id=group_id)

    async def _list_active_member_rows(self, group_id: uuid.UUID) -> list[AgentGroupMember]:
        return await _helpers._list_active_member_rows(self, group_id=group_id)

    async def _member_name_occupancy(
        self,
        group_id: uuid.UUID,
        *,
        exclude_member_id: uuid.UUID | None = None,
    ) -> tuple[set[str], set[str]]:
        return await _helpers._member_name_occupancy(
            self,
            group_id=group_id,
            exclude_member_id=exclude_member_id,
        )

    async def _get_member(self, group_id: uuid.UUID, member_id: uuid.UUID) -> AgentGroupMember:
        return await _helpers._get_member(self, group_id=group_id, member_id=member_id)

    def _to_read(self, group: AgentGroupChat, members: list[AgentGroupMember]) -> GroupChatRead:
        return _helpers._to_read(self, group=group, members=members)

    # ── 项目口径 helper（quick 群 PPM 项目化）────────────────────────────────

    async def _project_linked_workspace_ids(self, project_id: uuid.UUID) -> set[uuid.UUID]:
        return await _helpers._project_linked_workspace_ids(self, project_id=project_id)

    async def _project_member_user_ids(self, project_id: uuid.UUID) -> set[uuid.UUID]:
        return await _helpers._project_member_user_ids(self, project_id=project_id)

    async def _require_user_in_member_scope(self, group: AgentGroupChat, target: User) -> None:
        return await _helpers._require_user_in_member_scope(self, group=group, target=target)

    async def _ensure_member_workspace_in_project(
        self, group: AgentGroupChat, workspace_id: uuid.UUID
    ) -> None:
        return await _helpers._ensure_member_workspace_in_project(
            self,
            group=group,
            workspace_id=workspace_id,
        )

    # ── 影子会话 end 子链（解散/移除 agent 成员/reset-memory 共用）────────────

    async def _end_member_shadow(
        self,
        member: AgentGroupMember,
        *,
        owner_user_id: uuid.UUID,
        reason: str,
    ) -> bool:
        return await _members._end_member_shadow(
            self,
            member=member,
            owner_user_id=owner_user_id,
            reason=reason,
        )

    # ── 建群 / 列表 / 详情 / 改设置 / 解散 ────────────────────────────────────

    async def create_group(self, user: User, payload: GroupChatCreate) -> GroupChatCreateRead:
        return await _crud.create_group(self, user=user, payload=payload)

    async def list_groups(
        self, user: User, *, archived: bool | None = False
    ) -> list[GroupChatRead]:
        return await _crud.list_groups(self, user=user, archived=archived)

    async def get_group(self, group_id: uuid.UUID, user: User) -> GroupChatRead:
        return await _crud.get_group(self, group_id=group_id, user=user)

    async def get_member_shadow_running(self, group_id: uuid.UUID) -> dict[uuid.UUID, bool]:
        return await _crud.get_member_shadow_running(self, group_id=group_id)

    async def update_group(
        self,
        group_id: uuid.UUID,
        user: User,
        payload: GroupChatUpdate,
    ) -> GroupChatRead:
        return await _crud.update_group(self, group_id=group_id, user=user, payload=payload)

    async def end_group(self, group_id: uuid.UUID, user: User) -> GroupChatRead:
        return await _crud.end_group(self, group_id=group_id, user=user)

    async def archive_group(self, group_id: uuid.UUID, user: User) -> None:
        return await _crud.archive_group(self, group_id=group_id, user=user)

    async def unarchive_group(self, group_id: uuid.UUID, user: User) -> None:
        return await _crud.unarchive_group(self, group_id=group_id, user=user)

    async def delete_group(self, group_id: uuid.UUID, user: User) -> None:
        return await _crud.delete_group(self, group_id=group_id, user=user)

    # ── 成员管理（design §6.1 / §8）─────────────────────────────────────────

    async def add_member(
        self,
        group_id: uuid.UUID,
        user: User,
        payload: GroupMemberCreate,
    ) -> GroupMemberAddRead:
        return await _members.add_member(self, group_id=group_id, user=user, payload=payload)

    async def update_member(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
        payload: GroupMemberUpdate,
    ) -> GroupMemberRead:
        return await _members.update_member(
            self,
            group_id=group_id,
            member_id=member_id,
            user=user,
            payload=payload,
        )

    async def _hot_switch_shadow_config(
        self,
        member: AgentGroupMember,
        *,
        old_config: dict,
    ) -> bool:
        return await _members._hot_switch_shadow_config(self, member=member, old_config=old_config)

    async def remove_member(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
    ) -> None:
        return await _members.remove_member(self, group_id=group_id, member_id=member_id, user=user)

    async def reset_member_memory(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
    ) -> GroupMemberRead:
        return await _members.reset_member_memory(
            self,
            group_id=group_id,
            member_id=member_id,
            user=user,
        )

    # ── 群消息与 @触发管线（task-03，design §4.1-4.3 / §8）──────────────────

    async def send_group_message(
        self,
        group_id: uuid.UUID,
        user: User,
        content: str,
        attachment_ids: list[uuid.UUID] | None = None,
        reply_to_log_id: uuid.UUID | None = None,
    ) -> GroupMessageSendRead:
        return await _messages.send_group_message(
            self,
            group_id=group_id,
            user=user,
            content=content,
            attachment_ids=attachment_ids,
            reply_to_log_id=reply_to_log_id,
        )

    async def _trigger_member_isolated(
        self,
        *,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        member_lines: list[str],
        sender_user_id: uuid.UUID,
        sender_member_name: str,
        content: str,
        carrier_run_id: uuid.UUID,
        exclude_log_id: uuid.UUID | None,
        attachment_ids: list[uuid.UUID] | None = None,
    ) -> GroupMemberTriggerRead:
        return await _messages._trigger_member_isolated(
            self,
            group_id=group_id,
            member_id=member_id,
            member_lines=member_lines,
            sender_user_id=sender_user_id,
            sender_member_name=sender_member_name,
            content=content,
            carrier_run_id=carrier_run_id,
            exclude_log_id=exclude_log_id,
            attachment_ids=attachment_ids,
        )

    async def _validate_group_attachments(
        self, sender_user_id: uuid.UUID, attachment_ids: list[uuid.UUID]
    ) -> list:
        return await _messages._validate_group_attachments(
            self,
            sender_user_id=sender_user_id,
            attachment_ids=attachment_ids,
        )

    async def send_direct_message(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
        content: str,
        attachment_ids: list[uuid.UUID] | None = None,
    ) -> GroupDirectMessageRead:
        return await _messages.send_direct_message(
            self,
            group_id=group_id,
            member_id=member_id,
            user=user,
            content=content,
            attachment_ids=attachment_ids,
        )

    async def interrupt_member(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
    ) -> GroupMemberInterruptRead:
        return await _messages.interrupt_member(
            self,
            group_id=group_id,
            member_id=member_id,
            user=user,
        )

    # ── 置顶消息（quick 群 P2，2026-09-02：settings_json.pinned）──────────────

    async def _get_timeline_row(
        self, group: AgentGroupChat, log_id: uuid.UUID
    ) -> tuple[AgentRunLog, str]:
        return await _crud._get_timeline_row(self, group=group, log_id=log_id)

    async def pin_message(
        self,
        group_id: uuid.UUID,
        user: User,
        log_id: uuid.UUID,
    ) -> GroupChatPinnedRead:
        return await _crud.pin_message(self, group_id=group_id, user=user, log_id=log_id)

    async def unpin_message(self, group_id: uuid.UUID, user: User) -> None:
        return await _crud.unpin_message(self, group_id=group_id, user=user)

    async def mark_group_read(self, group_id: uuid.UUID, user: User) -> None:
        return await _messages.mark_group_read(self, group_id=group_id, user=user)

    async def _trigger_group_member(
        self,
        *,
        group: AgentGroupChat,
        member: AgentGroupMember,
        members: list[AgentGroupMember],
        member_lines: list[str],
        sender_user_id: uuid.UUID,
        sender_member_name: str,
        content: str,
        carrier_run_id: uuid.UUID,
        exclude_log_id: uuid.UUID | None,
        source_member_name: str | None = None,
        chain_depth: int = 0,
        attachment_rows: list | None = None,
    ) -> GroupMemberTriggerRead:
        return await _shadow._trigger_group_member(
            self,
            group=group,
            member=member,
            members=members,
            member_lines=member_lines,
            sender_user_id=sender_user_id,
            sender_member_name=sender_member_name,
            content=content,
            carrier_run_id=carrier_run_id,
            exclude_log_id=exclude_log_id,
            source_member_name=source_member_name,
            chain_depth=chain_depth,
            attachment_rows=attachment_rows,
        )

    async def _get_shadow_active_run(self, shadow_session_id: uuid.UUID) -> AgentRun | None:
        return await _shadow._get_shadow_active_run(self, shadow_session_id=shadow_session_id)

    async def _ensure_shadow_session(
        self,
        group: AgentGroupChat,
        member: AgentGroupMember,
        *,
        first_prompt: str,
        first_turn_metadata: dict,
        attachment_rows: list | None = None,
    ) -> tuple[AgentSession, uuid.UUID | None]:
        return await _shadow._ensure_shadow_session(
            self,
            group=group,
            member=member,
            first_prompt=first_prompt,
            first_turn_metadata=first_turn_metadata,
            attachment_rows=attachment_rows,
        )

    async def _assemble_group_inject_attachments(
        self,
        rows: list,
        *,
        member: AgentGroupMember,
        owner_user_id: uuid.UUID,
    ) -> list[dict]:
        return await _shadow._assemble_group_inject_attachments(
            self,
            rows=rows,
            member=member,
            owner_user_id=owner_user_id,
        )

    async def _send_shadow_first_inject(
        self,
        *,
        shadow_id: uuid.UUID,
        lease_id: uuid.UUID,
        run_id: uuid.UUID,
        prompt: str,
        claim_token: str,
        runtime_id: uuid.UUID,
        inject_attachments: list[dict] | None = None,
    ) -> None:
        return await _shadow._send_shadow_first_inject(
            self,
            shadow_id=shadow_id,
            lease_id=lease_id,
            run_id=run_id,
            prompt=prompt,
            claim_token=claim_token,
            runtime_id=runtime_id,
            inject_attachments=inject_attachments,
        )

    # ── typing / 列表信号（task-06，design §5.4 / §5.3）──────────────────────

    async def publish_typing(
        self,
        group_id: uuid.UUID,
        user: User,
        *,
        typing: bool,
        preview: str | None,
    ) -> None:
        return await _typing_presence.publish_typing(
            self,
            group_id=group_id,
            user=user,
            typing=typing,
            preview=preview,
        )

    async def _publish_group_sessions_changed(
        self, group: AgentGroupChat, event: SessionChangeEvent
    ) -> None:
        return await _typing_presence._publish_group_sessions_changed(
            self,
            group=group,
            event=event,
        )
