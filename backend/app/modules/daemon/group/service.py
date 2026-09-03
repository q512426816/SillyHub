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
- presence：``group_presence_key`` 单源命名 + ``get_online_member_ids`` 读
  ``group_presence:{gid}:*`` 活跃集（群列表/详情 online_member_ids 消费）；
  touch（SET EX 60 续期）挂在 SSE 生成器循环（agent/service.py，间隔 45s）；
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
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime

from pydantic import BaseModel, Field, ValidationError
from redis.asyncio import Redis
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import (
    ACTIVE_RUN_STATUSES,
    AgentGroupChat,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
    AgentSession,
    AgentSessionQueuedMessage,
)
from app.modules.agent.schema import (
    GroupChatCreate,
    GroupChatRead,
    GroupChatUpdate,
    GroupMemberAgentConfig,
    GroupMemberCreate,
    GroupMemberRead,
    GroupMemberUpdate,
    GroupMemberUserCreate,
)
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.daemon.session.service import DaemonSessionTurnConflict, SessionService
from app.modules.daemon.session_events import SessionChangeEvent, publish_sessions_changed

log = get_logger(__name__)

# ── 护栏常量（design §9.3：首版保守值，execute 后按实测调）──────────────────
# 每群 agent 成员上限（会话闸共享同一机器，防群内扇出打满 SILLYHUB_MAX_
# ACTIVE_SESSIONS）。
GROUP_AGENT_MEMBER_LIMIT = 8
# 每群用户成员上限（同时防 agent_sessions:changed audience payload 膨胀，
# task-06 消费）。
GROUP_USER_MEMBER_LIMIT = 50
# @路由保留词（design §4.1：@全体/@all 广播触发词，成员昵称不可占用——
# 否则 @解析对「是成员还是广播」产生歧义）。
RESERVED_DISPLAY_NAMES = {"全体", "all"}

# 群会话 provider 占位值（AgentSession.provider NOT NULL；群时间线会话自身
# 不派发 daemon，仅作载体标记——影子会话才落成员真实 provider，task-03）。
GROUP_SESSION_PROVIDER = "group"

# ── 群消息与 @触发管线常量（task-03，design §4.1-4.3）────────────────────────

# 载体 run 的 spec_strategy 标记（§2：纯载体，无执行语义——区分影子轮的
# 'interactive' 与批量派发策略）。
GROUP_CARRIER_SPEC_STRATEGY = "group_carrier"
# 影子会话 interactive lease 的 stage（§4.3：prepare_interactive_dispatch
# stage 形参 → lease metadata.stage → claim payload → daemon 谓词）。
GROUP_MEMBER_STAGE = "group_member"
# @路由广播保留词（与 task-02 RESERVED_DISPLAY_NAMES 同源；@全体/@all 触发
# 全部 agent 成员）。
BROADCAST_MENTION_WORDS = ("全体", "all")
# 提及候选正则（§4.1：全/半角 @，候选词到空白截断；标点边界见 _mention_match）。
_MENTION_TOKEN_RE = re.compile(r"[@＠](\S+)")
# 提及词边界字符集：候选 token 内昵称后继字符为标点/符号 → 提及在昵称处
# 截断（「@小码，帮我」命中「小码」；「@小码二号」的后继「二」非边界 → 不
# 误命中「小码」）。ASCII + CJK 常用标点/符号（显示名本身可为中英数与空格外
# 任意字符，昵称含空格不支持——display_name 侧建群时 strip，@词天然无空格）。
_MENTION_BOUNDARY_CHARS = frozenset(
    "，。！？；：、·…—～“”‘’（）《》〈〉【】〔〕「」『』,.!?;:()[]{}<>/'\"\\|@#%^&*+=~`$_"
)
# 群背景摘要单条截断 / 总长上限（design §4.2）。
GROUP_CONTEXT_ENTRY_MAX_CHARS = 500
GROUP_CONTEXT_TOTAL_MAX_CHARS = 6000
# 群列表最后消息摘要长度（task-03 接通 task-02 占位字段）。
GROUP_LAST_MESSAGE_PREVIEW_CHARS = 60
# 群列表「最近 @我」扫描行数（群聊体验 quick 2026-09-02：最近时间线内找最新 @）。
# quick 群 P2（2026-09-02）20 → 200：活跃群消息很快把 @ 挤出 20 行窗口（被 @ 后
# 群里聊几十条，列表侧「最近 @我」就丢了）——扩到 200 行覆盖日常活跃度；查询
# limit 与本常量同源联动（get_last_mention_previews 单处消费）。
GROUP_LAST_MENTION_SCAN_ROWS = 200
# 忙轮中途注入标注行（quick 2026-09-02 群聊 steering）：复用轮查到活跃 run 时
# 包在 _build_group_prompt 产物**头部**（外层包不动纯函数）——消息将以中途新
# 指令形式注入当前正在执行的轮，提示 agent 优先阅读并调整工作方式。
_MID_TURN_NOTICE = (
    "【注意】以下是用户/成员在你任务执行中途发来的新消息，"
    "请优先阅读并据此调整当前工作方式，无需中断任务除非明确要求。"
)

# quick 影子直聊（2026-09-02）：直聊注入 prompt 头（写在用户 content 前）。
# 不套 _build_group_prompt 群简报——直聊是影子会话内的独立对话，告知 agent
# 可见性语义 + [[GROUP]]...[[/GROUP]] 选择性转发标记用法（投影侧
# run_sync.extract_group_broadcast_segments 按同款标记抽段，标记文本保留在
# 影子会话原文、投影时剥离）。
# ql-20260903-002：可见性承诺对齐实际行为——「只在会话内可见」言过其实：
# 影子会话详情/日志对全体群成员开放（8dcc562f4 有测试锁定，群定位协作群、
# 跨成员可见性是需求）。如实表述为「不出现在群时间线 + 群成员可查会话」，
# 让 agent 据真实可见性把握表述分寸。
_SHADOW_DIRECT_HEADER = (
    "[用户正在群聊「{group_title}」成员「{member_name}」的独立会话中与你单独对话——"
    "此对话不会出现在群里（不投影到群时间线），但群成员可以在你的会话时间线中"
    "查看本对话内容，请据此把握表述分寸。如果你判断本轮内容对群内其他成员有价值，"
    "可在回复末尾用 [[GROUP]] 和 [[/GROUP]] 包裹要转发的段落，"
    "该段落会以你的群身份发到群里；无需转发则不要添加标记。]"
)

# quick 影子直聊（2026-09-02）：本轮 user_input metadata 的 source 标记——
# run_sync 投影判定锚（命中 → 整轮不投影，仅 [[GROUP]] 段例外）。
SHADOW_DIRECT_SOURCE = "shadow_direct"

# quick 投影统一标记制（2026-09-02）：群 @ 轮回应要求指示行——@轮投影与直聊
# 同款标记制（完整 assistant 文本仅 [[GROUP]] 段进群时间线），_build_group_prompt
# 在当前消息段后追加本行告知 agent 标记用法（run_sync.
# extract_group_broadcast_segments 按同款标记抽段，标记文本保留在影子会话
# 原文、投影时剥离；@轮整轮无标记时收口侧补兜底行防群里死寂）。
_GROUP_REPLY_MARKER_REQUIREMENT = (
    "回应要求：把给群内成员看的结论/回答放进 [[GROUP]] 与 [[/GROUP]] 标记段"
    "（会以你的身份发送到群里，简洁如聊天）；"
    "推理过程、工具使用细节写在标记段之外（只保留在你的内部会话中）。"
)

# ── 互@协作护栏常量（task-04，design §4.4——状态只存 Redis 带 TTL，不建表）──
# 协作链 Hash TTL（30min：链跨多轮互@，超时自清理不留死键）。
GROUP_CHAIN_TTL_SECONDS = 30 * 60
# 限频滑动窗口（60s）与窗口内被触发上限（design §9.3 首版保守值 6）。
GROUP_RATE_WINDOW_SECONDS = 60
GROUP_RATE_LIMIT_PER_MINUTE = 6
# 链 Hash 内深度计数字段名（其余 field=成员 id → 互@触发次数计数）。
GROUP_CHAIN_DEPTH_FIELD = "depth"
# 同链同成员互@触发上限（ql-20260902 讨论场景修复：直接触发占位计数 0 不占名额，
# 互@每触发一次 HINCRBY；达上限不再触发——防 A↔B 快速死循环的第一道兜底，
# 总跳数仍由 cross_mention_depth 与限频控制）。
GROUP_CROSS_MEMBER_TRIGGER_LIMIT = 2

# quick 群 P1 llm_provider 预检（2026-09-02）：agent 成员 ``llm_provider_id=None``
# 的非阻断提示文案——None=走机器本机默认 LLM 出口（可能可用），建群/加成员
# 不拦截，仅随响应 ``warnings`` 提示前端（向导/成员面板展示）。
_LLM_PROVIDER_MISSING_WARNING = (
    "成员「{member_name}」未指定模型，将使用机器本机默认 LLM 出口"
    "（若不可用请先在成员配置中切换模型）"
)


def _build_llm_provider_warnings(
    agent_members: Sequence[GroupMemberAgentConfig],
) -> list[str]:
    """agent 成员配置的模型缺失提示列表（llm_provider_id=None 逐成员一条）。"""
    return [
        _LLM_PROVIDER_MISSING_WARNING.format(member_name=cfg.display_name.strip())
        for cfg in agent_members
        if cfg.llm_provider_id is None
    ]


# ── quick 群 P2 常量（2026-09-02：置顶快照 / 触发失败原因摘要）────────────────

# 置顶消息内容快照截断长度（settings_json.pinned.content——完整原文仍在群时间
# 线行，快照供列表/详情横幅展示，超长截断）。
GROUP_PINNED_PREVIEW_CHARS = 200
# 触发失败原因摘要截断长度（triggered[].error + 群频道系统行共用——异常 message
# 可能很长，系统行保持一行可读）。
GROUP_TRIGGER_FAIL_REASON_MAX_CHARS = 120


def group_chain_key(carrier_run_id: uuid.UUID) -> str:
    """协作链 Redis key（``group_chain:{载体run_id}``，design §4.4）。

    链 id = 触发该协作链的用户消息载体 run id——互@触发沿用原链不新建。
    """
    return f"group_chain:{carrier_run_id}"


def group_rate_key(group_id: uuid.UUID, member_id: uuid.UUID) -> str:
    """成员限频 Redis key（``group_rate:{群id}:{成员id}``，INCR+EXPIRE 滑窗）。"""
    return f"group_rate:{group_id}:{member_id}"


def _group_guardrail_settings(group: AgentGroupChat) -> tuple[int, int, int]:
    """群级互@护栏参数（quick 群 P1，2026-09-02：settings_json 启用）。

    优先读 ``group.settings_json`` 的 ``guardrails`` 键（``rate_limit_per_minute``
    / ``member_trigger_limit`` / ``chain_ttl_seconds``），缺省字段回落模块常量
    （默认 6/2/1800，design §9.3 保守值）——存量群 settings_json NULL 与未
    覆盖字段全部走默认，**行为零变化**。写入侧（``_validate_guardrail_overrides``）
    已校验范围；此处对脏数据（手改库/迁移残留）再防御一层：非 int（含 bool）
    一律回退默认，不让护栏因脏配置失效或爆炸。
    """
    raw = (group.settings_json or {}).get("guardrails")
    if not isinstance(raw, dict):
        raw = {}

    def _pick(key: str, default: int) -> int:
        value = raw.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        return default

    return (
        _pick("rate_limit_per_minute", GROUP_RATE_LIMIT_PER_MINUTE),
        _pick("member_trigger_limit", GROUP_CROSS_MEMBER_TRIGGER_LIMIT),
        _pick("chain_ttl_seconds", GROUP_CHAIN_TTL_SECONDS),
    )


def _group_typing_preview_enabled(group: AgentGroupChat) -> bool:
    """typing 草稿预览群级开关（quick 群 P2，2026-09-02：默认关）。

    读 ``group.settings_json`` 的 ``typing_preview``（bool）——**默认 False**：
    只显示「正在输入」不发草稿（隐私从简）；显式 True 才随 typing 事件带
    preview。存量群 settings_json NULL / 无该键 / 脏值（非 bool）一律 False
    （与 ``_group_guardrail_settings`` 同款防御口径，脏配置不炸发布链路）。
    写入侧（PATCH ``_merge_group_settings_json``）已校验 bool。
    """
    return (group.settings_json or {}).get("typing_preview") is True


# ── 错误族（AppError 惯例：中文用户可见文案，UUID 进 details）────────────────


class GroupChatNotFound(AppError):
    """群不存在或无权访问（404 统一不泄露存在性，design §5.3 / constraints）。"""

    code = "HTTP_404_GROUP_CHAT_NOT_FOUND"
    http_status = 404


class GroupChatMemberNotFound(AppError):
    """群成员行不存在（或已移除/跨群，404 不泄露）。"""

    code = "HTTP_404_GROUP_MEMBER_NOT_FOUND"
    http_status = 404


class GroupChatForbidden(AppError):
    """群主专属操作越权（成员可见群但非群主且非 workspace admin → 403）。

    与 404 的分工：请求者已是群成员（群存在性对其已知），改设置/加删成员/
    解散的越权用 403 明确「看得到但动不了」；非成员一律 404。
    """

    code = "HTTP_403_GROUP_CHAT_FORBIDDEN"
    http_status = 403


class GroupChatInvalid(AppError):
    """群管理写操作校验失败（上限超出/昵称重复/引用不存在等，400）。"""

    code = "HTTP_400_GROUP_CHAT_INVALID"
    http_status = 400


class GroupMemberNoActiveRun(AppError):
    """打断目标成员当前无运行中任务（quick 群 P1，409 状态冲突语义）。"""

    code = "HTTP_409_GROUP_MEMBER_NO_ACTIVE_RUN"
    http_status = 409


class GroupMessageNotFound(AppError):
    """置顶目标消息不存在或不属于该群时间线（quick 群 P2，404 不泄露他群）。"""

    code = "HTTP_404_GROUP_MESSAGE_NOT_FOUND"
    http_status = 404


# ── @解析（design §4.1，task-03）────────────────────────────────────────────


def _mention_match(token: str, names: Sequence[str]) -> bool:
    """候选 token 是否命中任一提及词（精确命中，或前缀命中且后继为边界标点）。"""
    for name in names:
        if not name:
            continue
        if token == name:
            return True
        if (
            len(token) > len(name)
            and token.startswith(name)
            and token[len(name)] in _MENTION_BOUNDARY_CHARS
        ):
            return True
    return False


def _parse_group_mentions(
    content: str, members: Sequence[AgentGroupMember]
) -> list[AgentGroupMember]:
    """解析消息中的 @提及（design §4.1 步 4）。

    - 正则 ``[@＠]\\S+`` 提取候选词（到空白截断），再与 agent 成员
      ``display_name`` 精确匹配（边界：标点/符号截断——``@小码，`` 命中
      ``小码``，``@小码二号`` 不误命中 ``小码``）；
    - ``@全体`` / ``@all``（保留词，同边界规则）→ 全部**未移除** agent 成员；
    - 用户成员昵称不触发（仅 agent 成员有独立记忆可触发）；
    - 返回命中成员列表（按 id 去重，保首次命中序；SQLModel 实例不可哈希，
      集合语义以 list 承载）。
    """
    agent_members = [m for m in members if m.member_type == "agent" and m.removed_at is None]
    by_name = {m.display_name: m for m in agent_members}
    hits: dict[uuid.UUID, AgentGroupMember] = {}
    for match in _MENTION_TOKEN_RE.finditer(content):
        token = match.group(1)
        if _mention_match(token, BROADCAST_MENTION_WORDS):
            for member in agent_members:
                hits.setdefault(member.id, member)
            continue
        for name in by_name:
            if _mention_match(token, (name,)):
                member = by_name[name]
                hits.setdefault(member.id, member)
    return list(hits.values())


def _has_broadcast_mention(content: str) -> bool:
    """消息是否含 @全体/@all（响应体 mention_all 标记用）。"""
    return any(
        _mention_match(match.group(1), BROADCAST_MENTION_WORDS)
        for match in _MENTION_TOKEN_RE.finditer(content)
    )


# ── 互@协作检测与 Redis 护栏（task-04，design §4.4）──────────────────────────


def detect_cross_mentions(
    reply_text: str,
    members: Sequence[AgentGroupMember],
    *,
    source_member_id: uuid.UUID,
) -> list[AgentGroupMember]:
    """解析 agent 回复最终文本中的 @提及（纯函数，design §4.4）。

    复用用户消息同款 ``_parse_group_mentions``；差异仅两处——

    - **不自我触发**：命中来源成员自身（回复 @自己）一律忽略；
    - 用户成员昵称照旧不触发（与用户 @ 同口径，仅 agent 成员可被触发）。
    """
    return [m for m in _parse_group_mentions(reply_text, members) if m.id != source_member_id]


async def _load_run_reply_text(
    db: AsyncSession,
    *,
    carrier_run_id: uuid.UUID,
    member_id: uuid.UUID,
) -> str:
    """聚合载体 run 上**该成员**的投影行 = 其本轮在群内的最终回复文本。

    行源（design §5.2 投影范围）：task-05 桥接在影子 run 落库时同事务双写到
    载体 run 的 ``channel='stdout'`` 且带成员身份 metadata 的行——**只有真正
    进群时间线的 assistant 文本段**（thinking/tool/stderr 已被投影过滤），互@
    检测口径与用户看到的一致。partial 半截行按时间序拼接。

    按 ``metadata_.member_id`` 过滤：同一条用户消息 @ 多成员时多个成员的投影
    行落在同一载体 run 上——检测只解析**本轮收口成员**的回复，不混入他人。
    """
    rows = (
        await db.execute(
            select(AgentRunLog.content_redacted, AgentRunLog.metadata_)
            .where(
                AgentRunLog.run_id == carrier_run_id,
                AgentRunLog.channel == "stdout",
                AgentRunLog.metadata_.is_not(None),
            )
            .order_by(AgentRunLog.timestamp, AgentRunLog.id)
        )
    ).all()
    parts: list[str] = []
    for content, meta in rows:
        if not isinstance(meta, dict) or meta.get("member_id") != str(member_id):
            continue
        text = (content or "").strip()
        if text:
            parts.append(text)
    return "\n".join(parts)


async def _register_chain_members(
    redis: Redis,
    carrier_run_id: uuid.UUID,
    member_ids: Sequence[uuid.UUID],
    *,
    ttl_seconds: int = GROUP_CHAIN_TTL_SECONDS,
) -> None:
    """用户 @ 直接触发的成员入链登记（链去重集 + TTL，深度仍 0）。

    链语义（design §4.4）：链 id=触发该协作的用户消息载体 run id，用户 @ 触发
    的成员即链内首批成员（chain_depth=0 轮）；后续互@命中同链成员即跳过。
    ``ttl_seconds`` quick 群 P1（2026-09-02）群级可配（默认模块常量）——与
    互@侧 TTL 刷新同一取值源（``_group_guardrail_settings``），避免登记用默认
    30min、互@刷新才对齐群配置的窗口错位。best-effort：Redis 抖动仅 warning
    不阻断消息发送主链路。
    """
    try:
        key = group_chain_key(carrier_run_id)
        for member_id in member_ids:
            # redis-py 7.x stubs 对部分命令返回 Awaitable|T union（运行时恒为
            # coroutine），逐调用精确 ignore misc。
            # 直接触发仅占位计数 0（ql-20260902 讨论场景修复：用户 @ 的成员是
            # "链内首批"，不占互@去重名额——否则"你们俩讨论下"这类同时 @ 多人
            # 的消息会让后续互@全被去重、讨论一轮即断）。
            await redis.hsetnx(key, str(member_id), "0")  # type: ignore[misc]
        await redis.expire(key, ttl_seconds)
    except Exception:
        log.warning(
            "group_chain_register_failed",
            carrier_run_id=str(carrier_run_id),
            exc_info=True,
        )


async def _publish_rate_limit_notice(group: AgentGroupChat, member_name: str) -> None:
    """限频超限群内系统提示（design §4.4：群频道系统提示行）。

    复用群频道 ``log`` 事件形态（``channel='system'`` 与用户/投影行区分），
    publish 容错语义同 ``_publish_group_channel_event``（Redis 抖动仅 warning）。
    """
    await _publish_group_channel_event(
        group.session_id,
        {
            "event": "log",
            "session_id": str(group.session_id),
            "channel": "system",
            "content": f"「{member_name}」触发频率已达上限，请稍候再 @。",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )


async def _publish_member_interrupted_notice(
    group: AgentGroupChat, *, member_name: str, interrupter_name: str
) -> None:
    """成员任务被打断的群内系统提示行（quick 群 P1 member.interrupted）。

    形态照 ``_publish_rate_limit_notice`` 先例（``channel='system'`` ephemeral，
    不落库——时间线正文只承载对话内容，打断信号走频道实时流 + 响应 DTO）。
    """
    await _publish_group_channel_event(
        group.session_id,
        {
            "event": "log",
            "session_id": str(group.session_id),
            "channel": "system",
            "content": f"{member_name} 的当前任务已被 {interrupter_name} 打断",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )


def _trigger_failure_reason(exc: AppError) -> str:
    """触发失败异常 → 中文原因摘要（quick 群 P2：系统行 + ``triggered[].error``）。

    code 优先映射机器可判的失败族（会话闸满/队列满/机器离线——这类异常的
    message 面向 HTTP 错误响应，直接进系统行过长且带操作指引重复）；未命中
    映射的（如群错误族 GroupChatInvalid 的引擎门控/机器不可用）message 本就
    是中文用户文案，剥掉头部的「成员「X」的」身份前缀（系统行/DTO 已携带
    成员身份，重复啰嗦）后截 ``GROUP_TRIGGER_FAIL_REASON_MAX_CHARS`` 直用。
    """
    code = (exc.code or "").upper()
    if "SESSION_LIMIT" in code:
        return "机器会话数已达上限，请稍后再试"
    if code == "HTTP_409_DAEMON_SESSION_QUEUE_FULL":
        return "成员排队消息已满，请稍后再试"
    if code == "HTTP_504_DAEMON_RUNTIME_OFFLINE":
        return "执行机器当前不在线"
    message = (getattr(exc, "message", "") or "").strip()
    if message:
        message = re.sub(r"^成员「[^」]*」的?", "", message).strip()
    if message:
        return message[:GROUP_TRIGGER_FAIL_REASON_MAX_CHARS]
    return "触发失败，请稍后再试"


async def _publish_trigger_failed_notice(
    group_session_id: uuid.UUID, *, member_name: str, reason: str
) -> None:
    """成员触发失败的群内系统提示行（quick 群 P2）。

    只对「消息已落时间线但成员没跑起来」的用户可感沉默场景发（``send_group_
    message`` 逐成员触发捕获 AppError 的调用点）——形态照 ``_publish_rate_
    limit_notice`` 先例（``channel='system'`` ephemeral 不落库，实时流提示 +
    响应 DTO ``triggered[].error`` 双通道）。传**群会话 id 标量**而非群行：
    调用点处于触发失败子链 rollback 之后，群 ORM 行已 expire（过期属性 lazy
    IO 在 greenlet 外炸 MissingGreenlet——update_member「先取标量」先例）。
    """
    await _publish_group_channel_event(
        group_session_id,
        {
            "event": "log",
            "session_id": str(group_session_id),
            "channel": "system",
            "content": f"成员「{member_name}」触发失败：{reason}",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )


# ── 互@护栏参数群级可配（quick 群 P1，2026-09-02：settings_json 启用）────────


# guardrails 子键合法范围（int 边界含端点；范围沿用 design §9.3 保守界 +
# 模块常量默认值的合理调节带）。
_GUARDRAIL_FIELD_RANGES: dict[str, tuple[int, int]] = {
    "rate_limit_per_minute": (1, 60),
    "member_trigger_limit": (1, 10),
    "chain_ttl_seconds": (300, 7200),
}


def _validate_guardrail_overrides(raw: object) -> None:
    """PATCH ``settings_json.guardrails`` 校验（非法键/范围外值 → 400 中文）。

    fail-loud：未知键拒绝（防客户端拼写错误静默落库成死配置）；值必须为
    范围内整数（bool 是 int 子类，显式排除）。
    """
    if not isinstance(raw, dict):
        raise GroupChatInvalid("settings_json.guardrails 必须是对象。")
    for key, value in raw.items():
        if key not in _GUARDRAIL_FIELD_RANGES:
            raise GroupChatInvalid(
                f"未知的互@护栏参数「{key}」。",
                details={"field": key, "allowed": sorted(_GUARDRAIL_FIELD_RANGES)},
            )
        low, high = _GUARDRAIL_FIELD_RANGES[key]
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise GroupChatInvalid(
                f"互@护栏参数「{key}」取值需在 {low}-{high} 之间。",
                details={"field": key, "value": str(value), "min": low, "max": high},
            )


def _merge_group_settings_json(current: dict | None, incoming: dict) -> dict:
    """PATCH ``settings_json`` 合并落库（quick 群 P1；P2 增 ``typing_preview``）。

    顶层键白名单：``guardrails``（子键**字段级合并**——未传字段保留既有覆盖值，
    与 GroupChatUpdate「None=不改」局部更新语义同构）+ ``typing_preview``
    （bool，quick 群 P2 typing 草稿预览开关）。``pinned`` 是置顶端点的内部写
    键，不经 PATCH（fail-loud 拒绝防外部覆盖快照）。返回新 dict（不原地改
    ORM 属性，赋值才进 dirty——既有 ``pinned`` 原样保留）。清除覆盖 = 显式
    回传默认值。
    """
    merged = dict(current or {})
    rest = dict(incoming)
    guardrails = rest.pop("guardrails", None)
    typing_preview = rest.pop("typing_preview", None)
    if rest:
        key = next(iter(rest))
        raise GroupChatInvalid(
            f"未知的群设置键「{key}」。",
            details={"key": key, "allowed": ["guardrails", "typing_preview"]},
        )
    if guardrails is not None:
        _validate_guardrail_overrides(guardrails)
        merged["guardrails"] = {**(merged.get("guardrails") or {}), **guardrails}
    if typing_preview is not None:
        if not isinstance(typing_preview, bool):
            raise GroupChatInvalid(
                "settings_json.typing_preview 必须是布尔值。",
                details={"field": "typing_preview", "value": str(typing_preview)},
            )
        merged["typing_preview"] = typing_preview
    return merged


async def run_cross_mention_detection(
    db: AsyncSession,
    *,
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    member_name: str,
    run: AgentRun,
) -> list[GroupMemberTriggerRead]:
    """turn_completed 后的互@检测编排（design §4.4，task-04 挂接 run_sync 收口）。

    判定链（任一环不命中即零触发，@作纯文本）：

    1. 群开关 ``agent_cross_mention``（默认开；关闭=严格 openclaw 模式）+ 群未
       解散；
    2. 链上下文：本 run 最近一条 user_input 日志 metadata（task-03 注入 /
       task-04 排队透传写入的 ``source_carrier_run_id``/``chain_depth``）——
       缺失（非群链路轮）零触发；
    3. 回复文本 = 载体 run 投影行聚合（``_load_run_reply_text``）；
    4. ``detect_cross_mentions`` 纯解析（不自我 + 仅 agent 成员）；
    5. Redis 护栏（全带 TTL）：深度达 ``cross_mention_depth`` 跳过 → 同链同
       成员 HSETNX 去重跳过 → 限频 INCR 超限跳过 + 群内系统提示；
    6. 命中成员走 ``_trigger_group_member`` 同管线（注入 prompt 当前消息标注
       为来自 Agent 成员的协作请求；链沿用原链、深度 +1）。

    fail-open 边界：Redis 不可用时**跳过全部互@触发**（fail-closed 防环优先
    ——护栏状态只存 Redis，Redis 缺席时无从判深/去重，放行即可能无限互@）；
    单成员触发失败（机器离线 400 等）记 warning 继续其余成员，不阻断 run 收口。
    """
    group = await db.get(AgentGroupChat, group_id)
    if group is None or group.ended_at is not None or not group.agent_cross_mention:
        return []

    # ── 链上下文（与 run_sync._resolve_group_bridge_context 同源读取）─────────
    turn_meta = (
        (
            await db.execute(
                select(AgentRunLog.metadata_)
                .where(
                    AgentRunLog.run_id == run.id,
                    AgentRunLog.channel == "user_input",
                )
                .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if not isinstance(turn_meta, dict):
        return []
    # quick 影子直聊（2026-09-02）：直聊轮不参与互@协作——直聊内容默认不进群，
    # [[GROUP]] 转发段虽落群时间线，但独立会话不应自动触发其他成员（保持直聊
    # 私密 + 零自动化副作用）。
    if turn_meta.get("source") == SHADOW_DIRECT_SOURCE:
        return []
    carrier_raw = turn_meta.get("source_carrier_run_id")
    if not isinstance(carrier_raw, str) or not carrier_raw:
        return []
    try:
        carrier_run_id = uuid.UUID(carrier_raw)
    except ValueError:
        log.warning(
            "group_cross_mention_invalid_carrier",
            group_id=str(group_id),
            run_id=str(run.id),
        )
        return []

    reply_text = await _load_run_reply_text(db, carrier_run_id=carrier_run_id, member_id=member_id)
    if not reply_text:
        return []

    members = (
        (
            await db.execute(
                select(AgentGroupMember)
                .where(
                    AgentGroupMember.group_id == group.id,
                    AgentGroupMember.removed_at.is_(None),
                )
                .order_by(AgentGroupMember.joined_at, AgentGroupMember.id)
            )
        )
        .scalars()
        .all()
    )
    hits = detect_cross_mentions(reply_text, list(members), source_member_id=member_id)
    if not hits:
        return []

    try:
        redis = get_redis()
        await redis.ping()  # type: ignore[misc]  # redis-py stubs union 返回
    except Exception:
        # fail-closed：Redis 缺席不判护栏 → 全部跳过（防无限互@），仅记日志。
        log.warning(
            "group_cross_mention_redis_unavailable",
            group_id=str(group.id),
            run_id=str(run.id),
        )
        return []

    chain_key = group_chain_key(carrier_run_id)
    member_lines = [
        f"{m.display_name}({'用户' if m.member_type == 'user' else 'Agent'})" for m in members
    ]
    depth_limit = max(int(group.cross_mention_depth or 0), 0)
    # quick 群 P1（2026-09-02）护栏参数群级可配：settings_json.guardrails 覆盖，
    # 缺省回落模块常量（默认 6/2/1800——存量群零行为变化）。
    rate_limit_per_minute, member_trigger_limit, chain_ttl_seconds = _group_guardrail_settings(
        group
    )
    # 双轨一致（design §4.4）：DB run metadata 的 chain_depth 与 Redis depth 互为
    # 校验——取 max 为判定基线（链 TTL 30min 过期后 DB 侧深度仍是防环下限，
    # 不会因 Redis 清键而复活长链）。
    metadata_depth = turn_meta.get("chain_depth")
    try:
        metadata_depth_int = int(metadata_depth) if metadata_depth is not None else 0
    except (TypeError, ValueError):
        metadata_depth_int = 0
    triggered: list[GroupMemberTriggerRead] = []
    for target in hits:
        # ── 护栏 1：深度到顶（≥cross_mention_depth 不再触发，@作纯文本）─────
        depth_raw = await redis.hget(chain_key, GROUP_CHAIN_DEPTH_FIELD)  # type: ignore[misc]
        redis_depth = int(depth_raw) if depth_raw else 0
        base_depth = max(redis_depth, metadata_depth_int)
        if base_depth >= depth_limit:
            log.info(
                "group_cross_mention_depth_capped",
                group_id=str(group.id),
                carrier_run_id=str(carrier_run_id),
                depth=base_depth,
                target_member_id=str(target.id),
            )
            continue
        # ── 护栏 3（先于去重：超限跳过不烧链内名额）：限频滑窗 ─────────────────
        rate_key = group_rate_key(group.id, target.id)
        rate_count = int(await redis.incr(rate_key))
        # quick 群 P1（2026-09-02 限频原子化）：incr 后**无条件** expire——原先
        # 只在 count==1 时 expire，进程恰在 incr 与 expire 间崩溃会留下无 TTL
        # 的永久计数键（计数只增不清，该成员后续窗口全部误判超限）。代价是
        # 窗口锚点随每次触发后移（滑窗化）：持续互@风暴下锁止更保守，对
        # 防环护栏语义可接受；多一次 expire 调用换崩溃窗口闭合，最简可靠。
        await redis.expire(rate_key, GROUP_RATE_WINDOW_SECONDS)
        if rate_count > rate_limit_per_minute:
            await _publish_rate_limit_notice(group, target.display_name)
            log.info(
                "group_cross_mention_rate_limited",
                group_id=str(group.id),
                target_member_id=str(target.id),
                count=rate_count,
            )
            continue
        # ── 护栏 2：同链同成员互@次数上限（HINCRBY 计数，超上限跳过）────────
        # ql-20260902 讨论场景修复：直接触发占位 0 不占名额，互@每次 +1；
        # 同一成员最多被互@触发 member_trigger_limit 次（群级可配，默认
        # GROUP_CROSS_MEMBER_TRIGGER_LIMIT）。
        member_triggers = int(await redis.hincrby(chain_key, str(target.id), 1))  # type: ignore[misc]
        if member_triggers > member_trigger_limit:
            log.info(
                "group_cross_mention_member_capped",
                group_id=str(group.id),
                carrier_run_id=str(carrier_run_id),
                target_member_id=str(target.id),
                triggers=member_triggers,
            )
            continue
        # 深度 +1（本次互@跳数；DB 侧领先时先对齐再计数）并刷新链 TTL。
        if redis_depth < base_depth:
            await redis.hset(chain_key, GROUP_CHAIN_DEPTH_FIELD, str(base_depth))  # type: ignore[misc]
        new_depth = int(await redis.hincrby(chain_key, GROUP_CHAIN_DEPTH_FIELD, 1))  # type: ignore[misc]
        await redis.expire(chain_key, chain_ttl_seconds)

        # ── 与用户 @ 同管线触发（链沿用原链，链 id 不新建）────────────────────
        try:
            trigger = await GroupChatService(db)._trigger_group_member(
                group=group,
                member=target,
                members=list(members),
                member_lines=member_lines,
                sender_user_id=group.created_by,  # 服务身份=群主（§9.2 计量归属）
                sender_member_name=member_name,
                content=reply_text,
                carrier_run_id=carrier_run_id,
                exclude_log_id=None,
                source_member_name=member_name,
                chain_depth=new_depth,
            )
        except AppError as exc:
            log.warning(
                "group_cross_mention_trigger_failed",
                group_id=str(group.id),
                target_member_id=str(target.id),
                code=exc.code,
            )
            continue
        triggered.append(trigger)
        if not trigger.queued:
            # 运行态可见 quick（2026-09-02）：补 member_id；reply_to_log_id 不传
            # ——互@触发源是 agent 投影行（非 user_input 行），无「正在响应的用户
            # 消息」锚点（排队轮照旧不发 typing）。
            await _publish_agent_typing_event(
                group.id,
                target.display_name,
                member_id=str(target.id),
            )
    return triggered


# ── 群背景摘要（design §4.2，task-03）───────────────────────────────────────


async def _load_group_context_lines(
    db: AsyncSession,
    *,
    group_session_id: uuid.UUID,
    context_window: int,
    members: Sequence[AgentGroupMember],
    exclude_log_id: uuid.UUID | None = None,
) -> list[str]:
    """查群时间线最近 ``context_window`` 条并组装摘要行（时间正序返回）。

    行源（§4.2）：``user_input`` 行（用户消息）+ 投影行（``channel='stdout'``
    且 ``metadata`` 含成员身份——task-05 桥接投影双写，本查询先兼容）。

    - 身份标签：用户行 = 发送者昵称（``metadata_.sender_member_name`` 优先，
      回退 ``run.user_id`` 查成员表）+ ``(用户)``；投影行 =
      ``metadata_.member_name`` + ``(Agent)``；
    - 单条截断 500 字、总长上限 6000 字符（超限**丢最旧**保最新）；
    - ``exclude_log_id``：当前消息行排除（它进「当前消息」段，不重复出现在
      背景里）。
    """
    from sqlalchemy import and_

    stmt = (
        select(AgentRunLog, AgentRun.user_id)
        .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
        .where(
            AgentRun.agent_session_id == group_session_id,
            or_(
                AgentRunLog.channel == "user_input",
                and_(
                    AgentRunLog.channel == "stdout",
                    AgentRunLog.metadata_.is_not(None),
                ),
            ),
        )
        .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
        .limit(max(context_window, 1))
    )
    rows = (await db.execute(stmt)).all()

    user_members_by_user: dict[uuid.UUID, AgentGroupMember] = {
        m.user_id: m for m in members if m.member_type == "user" and m.user_id is not None
    }
    # 时间倒序逐条组装；总长超限即停（丢弃的是更旧的行），最后反转回正序。
    kept_newest_first: list[str] = []
    total = 0
    for log_row, run_user_id in rows:
        if exclude_log_id is not None and log_row.id == exclude_log_id:
            continue
        meta = log_row.metadata_ or {}
        if log_row.channel == "user_input":
            name = meta.get("sender_member_name")
            if not name and run_user_id is not None:
                member = user_members_by_user.get(run_user_id)
                name = member.display_name if member is not None else None
            label = f"{name or '成员'}(用户)"
        else:
            label = f"{meta.get('member_name') or '成员'}(Agent)"
        content = (log_row.content_redacted or "").strip()
        if not content:
            continue
        line = f"{label}: {content[:GROUP_CONTEXT_ENTRY_MAX_CHARS]}"
        if kept_newest_first and total + len(line) > GROUP_CONTEXT_TOTAL_MAX_CHARS:
            break
        kept_newest_first.append(line)
        total += len(line)
    kept_newest_first.reverse()
    return kept_newest_first


def _build_group_prompt(
    *,
    group: AgentGroupChat,
    member: AgentGroupMember,
    member_lines: Sequence[str],
    context_lines: Sequence[str],
    sender_member_name: str,
    content: str,
    source_member_name: str | None = None,
    attachment_lines: Sequence[str] | None = None,
) -> str:
    """影子会话注入 prompt 组装（design §4.3：简报 + 群背景摘要 + 当前消息）。

    ``source_member_name``（task-04 互@协作消费）：非 None 表示当前消息来自
    Agent 成员的协作请求——当前消息行身份标签用 ``{source}(Agent)`` 且段头
    标注「来自 Agent 成员的协作请求」（design §4.4），否则 ``{sender}(用户)``。

    ``attachment_lines``（FR-05 补遗）：用户随消息发送的附件提示行
    （``[附件] name (file_id)`` 逐附件一条）——附 prompt 末尾提示 agent 可读
    （实际下发走 SESSION_INJECT attachments 通道：多模态块内联 / 磁盘落盘，
    与单聊同管线）；互@轮不携带（agent 消息无附件）。

    quick 投影统一标记制（2026-09-02）：末尾追加回应要求指示行
    （``_GROUP_REPLY_MARKER_REQUIREMENT``）——@轮仅 [[GROUP]] 标记段进群
    时间线，prompt 告知 agent 标记用法。
    """
    briefing = (
        f"你是群聊「{group.title}」中的 Agent 成员「{member.display_name}」。"
        f"成员：{'、'.join(member_lines)}。"
        "仅当消息 @你 或 @全体 时回应；回应简洁如聊天；"
        f"你的发言会以「{member.display_name}」身份出现在群里。"
    )
    if member.team_enabled:
        # 团队能力段（quick 群成员团队能力）：工具名与 daemon 主控注入一致
        # （mcp-server.ts：dispatch_worker / list_workers / get_worker_result /
        # converge_mission / report_progress），措辞对照 mission_context
        # build_worker_briefing can_dispatch 段保持群聊口吻——大任务拆分身、
        # 结论由成员本人汇总转述回群。
        briefing += (
            "团队能力：你可调用 dispatch_worker 派分身并行执行子任务（各分身有"
            "独立工作区副本），list_workers 查看分身进度，get_worker_result 读取"
            "分身产出，converge_mission 收敛合并结果，report_progress 上报进度；"
            "大任务建议拆给分身干，你汇总结论回群。分身产出不会自动出现在群里，"
            "由你转述。"
        )
    # quick-6966fcee 注入分离展示：简报/群背景/回应要求合并为前导块（单聊
    # dispatch_prompt 同款形态——【群聊上下文】头 + "\n\n---\n\n" 分隔出真实
    # 用户消息），前端 extractPreambleText 剥离（对话视图只显示真实消息，
    # 注入上下文进「进度」视图 preamble 段默认收起）。
    parts = [f"【群聊上下文】\n{briefing}"]
    if context_lines:
        parts.append("[群聊记录 · 背景，仅供了解上下文]\n" + "\n".join(context_lines))
    sender_label = (
        f"{source_member_name}(Agent)"
        if source_member_name is not None
        else f"{sender_member_name}(用户)"
    )
    current_header = (
        "[当前消息 · 来自 Agent 成员的协作请求，需要你回应]"
        if source_member_name is not None
        else "[当前消息 · 需要你回应]"
    )
    if attachment_lines:
        parts.append(
            "[当前消息附件 · 用户随消息发送，可直接读取参考]\n" + "\n".join(attachment_lines)
        )
    # quick 投影统一标记制（2026-09-02）：回应要求指示行——@轮仅 [[GROUP]]
    # 标记段进群时间线（与直聊同款），告知 agent 标记用法。
    parts.append(_GROUP_REPLY_MARKER_REQUIREMENT)
    # 真实用户消息主体置于前导分隔符之后（extractPreambleText 按首个
    # "\n\n---\n\n" 切分——前导块在前，current_header+消息为干净主体）。
    return "\n\n".join(parts) + "\n\n---\n\n" + current_header + "\n" + f"{sender_label}: {content}"


def _attachment_summary_rows(rows: Sequence) -> list[dict[str, object]]:
    """附件行 → 时间线摘要（file_id/name/size/kind）。

    user_input 行 ``metadata_.attachments`` 与群频道 log 事件 payload 共用同一
    形态（前端 SSE 实时行与回放行消费同一结构）；kind 供前端区分图标。
    """
    return [{"file_id": str(r.id), "name": r.name, "size": r.bytes, "kind": r.kind} for r in rows]


def _attachment_prompt_lines(rows: Sequence) -> list[str]:
    """附件行 → agent prompt 提示行（``[附件] name (file_id)`` 逐附件一条）。"""
    return [f"[附件] {r.name} ({r.id})" for r in rows]


async def _publish_group_channel_event(session_id: uuid.UUID, payload: dict[str, object]) -> None:
    """publish 群频道 ``agent_session:{session_id}``（复用现有 SSE 频道，§5.4）。

    容错语义对齐 ``session/service._publish_session_event``：Redis 抖动仅
    warning，不阻断消息落库/触发主链路。
    """
    try:
        redis = get_redis()
        await redis.publish(f"agent_session:{session_id}", json.dumps(payload, default=str))
    except Exception:
        log.warning(
            "publish_group_channel_event_failed",
            session_id=str(session_id),
            redis_event=payload.get("event") if isinstance(payload, dict) else None,
        )


async def prepare_shadow_direct_turn(
    db: AsyncSession,
    *,
    shadow_session_id: uuid.UUID,
    sender_user_id: uuid.UUID,
) -> tuple[str, dict[str, object]] | None:
    """标准 inject 端点的影子直聊自动直通（quick 投影统一标记制 2026-09-02）。

    群主在 SessionPanel 对群成员影子会话发消息（标准 inject 端点，无群链路
    turn_metadata）时由 session/service 调用（函数内延迟 import 防循环）：
    解析直聊 prompt 头 + 直聊轮 metadata（``source=shadow_direct`` + 群/成员/
    直聊载体 run/发送者——投影过滤判定锚），并在**调用方事务内**落一个零日志
    的直聊载体 run（``[[GROUP]]`` 转发段投影行挂点，语义对齐
    send_direct_message 的载体：群时间线对直聊轮零可见 user_input 行）。
    返回 ``(直聊 prompt 头, 直聊轮 metadata)``。

    非群成员影子会话（成员行缺失）/ 群行缺失 → None（调用方零行为变化）。
    群 @ 触发 / 直聊端点 / 排队派发等服务路径自带 turn_metadata，不经本函数。
    """
    member = (
        (
            await db.execute(
                select(AgentGroupMember).where(
                    AgentGroupMember.shadow_session_id == shadow_session_id
                )
            )
        )
        .scalars()
        .one_or_none()
    )
    if member is None:
        return None
    group = await db.get(AgentGroupChat, member.group_id)
    if group is None:
        return None
    now = datetime.now(UTC)
    carrier = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider=GROUP_SESSION_PROVIDER,
        status="completed",
        started_at=now,
        finished_at=now,
        spec_strategy=GROUP_CARRIER_SPEC_STRATEGY,
        agent_session_id=group.session_id,
        user_id=sender_user_id,  # 直聊发起者归属（回放身份回退源）
    )
    db.add(carrier)
    header = _SHADOW_DIRECT_HEADER.format(group_title=group.title, member_name=member.display_name)
    return header, {
        "source": SHADOW_DIRECT_SOURCE,
        "source_group_id": str(group.id),
        "source_member_id": str(member.id),
        "source_carrier_run_id": str(carrier.id),
        "sender_user_id": str(sender_user_id),
    }


# ── typing / presence（task-06，design §5.4——纯 ephemeral，不落库）───────────

# typing 草稿预览截断长度（design §5.4：preview ≤400 字；服务端再裁一道防
# 超长 payload 进 pub/sub 帧）。
GROUP_TYPING_PREVIEW_MAX_CHARS = 400


def group_typing_channel(group_id: uuid.UUID) -> str:
    """群 typing pub/sub 频道名（``group_typing:{group_id}``，task-06 §5.4）。

    群 SSE 生成器双订阅本频道，typing 事件与日志事件合流进同一 SSE 流。
    """
    return f"group_typing:{group_id}"


def group_presence_key(group_id: uuid.UUID, user_id: uuid.UUID) -> str:
    """群在线 presence key（``group_presence:{group_id}:{user_id}``，§5.4）。

    命名单源：daemon/router.py 群 SSE 分支与测试都经本函数构造；TTL/续期间隔
    常量在 agent/service.py（touch 执行方）。
    """
    return f"group_presence:{group_id}:{user_id}"


async def _publish_group_typing_event(group_id: uuid.UUID, payload: dict[str, object]) -> None:
    """publish typing 频道 ``group_typing:{group_id}``（即发即忘，无存储）。

    容错语义同 ``_publish_group_channel_event``：Redis 抖动仅 warning——
    typing 是纯增益信号（前端 TTL 自动过期），不阻断调用方主链路。
    """
    try:
        redis = get_redis()
        await redis.publish(group_typing_channel(group_id), json.dumps(payload, default=str))
    except Exception:
        log.warning(
            "publish_group_typing_event_failed",
            group_id=str(group_id),
            redis_event=payload.get("event") if isinstance(payload, dict) else None,
        )


def _typing_payload(
    *,
    member_name: str,
    member_kind: str,
    typing: bool,
    preview: str | None,
    member_id: str | None = None,
    reply_to_log_id: str | None = None,
) -> dict[str, object]:
    """typing 事件 payload 组装（design §5.4 / §8 typing.ping，单一形态）。

    ``member_id``（群聊运行态可见 quick，2026-09-02）：成员行 id——前端 typing
    指示器按成员身份聚合/去重（agent 自动事件与终态止息恒携带）；用户手动
    typing 心跳不携带（payload 形态与历史一致，前端按 member_kind 区分）。
    ``reply_to_log_id``：触发消息的群时间线 ``user_input`` 行 id——即
    「agent 正在响应哪句话」的回复锚点（前端可高亮对应消息气泡）；仅 None
    缺省，两字段都按需附加（用户 typing 事件零形态漂移）。
    """
    payload: dict[str, object] = {
        "event": "typing",
        "member_name": member_name,
        "member_kind": member_kind,
        "typing": typing,
        "preview": preview[:GROUP_TYPING_PREVIEW_MAX_CHARS] if preview else None,
        "ts": datetime.now(UTC).isoformat(),
    }
    if member_id is not None:
        payload["member_id"] = member_id
    if reply_to_log_id is not None:
        payload["reply_to_log_id"] = reply_to_log_id
    return payload


async def _publish_agent_typing_event(
    group_id: uuid.UUID,
    member_name: str,
    *,
    member_id: str | None = None,
    reply_to_log_id: str | None = None,
) -> None:
    """agent 成员 typing 自动事件（「{member_name}」正在输入…，design §5.4）。

    影子 run 开始路径（``send_group_message`` 触发编排尾部 / 互@触发命中）调用
    ——成员昵称即面板/气泡展示名；preview 恒 None（后端不产草稿）。
    ``member_id``/``reply_to_log_id`` 见 ``_typing_payload``（触发消息行 id 即
    回复锚点；互@路径触发源是 agent 投影行而非 user_input 行，锚点传 None）。
    """
    await _publish_group_typing_event(
        group_id,
        _typing_payload(
            member_name=member_name,
            member_kind="agent",
            typing=True,
            preview=None,
            member_id=member_id,
            reply_to_log_id=reply_to_log_id,
        ),
    )


async def get_online_member_ids(group_id: uuid.UUID) -> list[uuid.UUID]:
    """读群在线用户成员 id 集（``group_presence:{group_id}:*`` keys，§5.4）。

    key 由群 SSE 生成器循环 touch（TTL 60s）——活跃 key 即在线成员。规模上界
    = 用户成员上限 50（design §9.3）。quick 群 P1 审计（2026-09-02）：原
    ``KEYS`` 前缀扫是 O(全库) 阻塞命令（单线程 Redis 上会卡住所有其它命令），
    换 ``SCAN`` 游标分批（每批 100）增量迭代——SCAN 期间键集可能变化（漏报/
    重报由下一轮 presence 刷新 + 60s TTL 心跳自愈，在线绿点容忍）。
    Redis 不可用返回空列表（在线绿点降级为全灰，不阻断列表/详情）。
    """
    prefix = f"group_presence:{group_id}:"
    pattern = f"{prefix}*"
    try:
        redis = get_redis()
        keys: list[str] = []
        cursor: int | str = 0
        while True:
            cursor, batch = await redis.scan(cursor=cursor, match=pattern, count=100)
            keys.extend(batch or [])
            if int(cursor) == 0:
                break
    except Exception:
        log.warning("group_presence_read_failed", group_id=str(group_id), exc_info=True)
        return []
    online: list[uuid.UUID] = []
    for key in keys:
        raw = key[len(prefix) :] if isinstance(key, str) else ""
        try:
            online.append(uuid.UUID(raw))
        except (ValueError, AttributeError):
            continue  # 脏 key（截断/残留）跳过，不炸列表
    return online


async def get_last_message_previews(
    db: AsyncSession, group_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, tuple[str | None, datetime | None]]:
    """群列表最后消息摘要 + 最新消息时间（task-02 占位字段接通，task-03）。

    每群查时间线最新一行（user_input / 投影行同 §4.2 行源），取内容前 60 字
    与行 ts（群 P2 第二波：``last_message_at`` 未读排序数据源，无消息 None）。
    群 id == 群会话 id（§3.2 不变式）。用户群列表规模小（成员上限 50），逐群
    LIMIT 1 查询可接受。ts 统一 UTC 感知（SQLite 方言往返丢 tz、PG 保留——
    归一后跨方言一致）。
    """
    from sqlalchemy import and_

    previews: dict[uuid.UUID, tuple[str | None, datetime | None]] = {}
    for group_id in group_ids:
        row = (
            await db.execute(
                select(AgentRunLog.content_redacted, AgentRunLog.timestamp)
                .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
                .where(
                    AgentRun.agent_session_id == group_id,
                    or_(
                        AgentRunLog.channel == "user_input",
                        and_(
                            AgentRunLog.channel == "stdout",
                            AgentRunLog.metadata_.is_not(None),
                        ),
                    ),
                )
                .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
                .limit(1)
            )
        ).first()
        if row is None:
            previews[group_id] = (None, None)
            continue
        content = (row[0] or "").strip()
        ts = row[1]
        if ts is not None and ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)
        previews[group_id] = (content[:GROUP_LAST_MESSAGE_PREVIEW_CHARS] or None, ts)
    return previews


# 未读数显示上限（群 P2 第二波：``unread_count`` cap 99，前端「99+」展示）。
GROUP_UNREAD_DISPLAY_CAP = 99


async def get_group_unread_counts(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    group_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, int]:
    """群未读数（请求成员视角，群 P2 第二波未读位点）。

    本成员 ``last_read_at`` 为 NULL（从未标记已读）→ 全部时间线行数；否则
    ``ts > last_read_at`` 的行数。行源同 ``get_last_message_previews``
    （user_input + 投影行，design §4.2）；发送即已读由 ``send_group_message``
    推进发送者位点保证（自己发的不计未读）。非成员群不出现在请求者列表，
    admin 兜底视角（无成员行）无位点语义 → 0。

    N+1 取舍：逐群两查（成员行 + count）——群列表规模 ≤50（design §9.3
    用户成员上限），与 ``get_last_message_previews`` 同取舍，可接受。计数
    cap ``GROUP_UNREAD_DISPLAY_CAP``（99+ 展示语义）。
    """
    from sqlalchemy import and_, func

    counts: dict[uuid.UUID, int] = {}
    for group_id in group_ids:
        membership = await get_active_user_membership(db, group_id=group_id, user_id=user_id)
        if membership is None:
            counts[group_id] = 0
            continue
        stmt = (
            select(func.count())
            .select_from(AgentRunLog)
            .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
            .where(
                AgentRun.agent_session_id == group_id,
                or_(
                    AgentRunLog.channel == "user_input",
                    and_(
                        AgentRunLog.channel == "stdout",
                        AgentRunLog.metadata_.is_not(None),
                    ),
                ),
            )
        )
        if membership.last_read_at is not None:
            last_read = membership.last_read_at
            if last_read.tzinfo is None:
                # SQLite 方言往返丢 tz（与读侧归一同款），补 UTC 后再比较。
                last_read = last_read.replace(tzinfo=UTC)
            stmt = stmt.where(AgentRunLog.timestamp > last_read)
        total = (await db.execute(stmt)).scalar() or 0
        counts[group_id] = min(int(total), GROUP_UNREAD_DISPLAY_CAP)
    return counts


async def get_last_mention_previews(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    group_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, dict[str, str] | None]:
    """群列表「最近 @我」摘要（群聊体验 quick，2026-09-02）。

    每群取时间线最近 ``GROUP_LAST_MENTION_SCAN_ROWS`` 条（行源同
    ``get_last_message_previews``：user_input + 投影行，design §4.2），按
    ``_parse_group_mentions`` 同口径（``_MENTION_TOKEN_RE`` 候选提取 +
    ``_mention_match`` 边界匹配——``@小码，`` 命中、``@小码二号`` 不误命中
    ``小码``）判定是否 @请求用户：匹配词 = 请求用户在该群成员表的
    ``display_name``（非成员/已移除跳过，返回 None）。取最新命中一条，返回
    ``{content(截 60 字), ts, member_name}``——member_name 为 @ 发起者身份
    标签（用户行 = ``metadata_.sender_member_name``，投影行 =
    ``metadata_.member_name``，缺失回退「成员」）。

    N+1 取舍：逐群两查（请求者成员昵称 + 时间线扫描）——群列表规模 ≤50
    （design §9.3 用户成员上限），与 ``get_last_message_previews`` 同取舍，
    可接受。
    """
    from sqlalchemy import and_

    previews: dict[uuid.UUID, dict[str, str] | None] = {}
    for group_id in group_ids:
        membership = await get_active_user_membership(db, group_id=group_id, user_id=user_id)
        if membership is None:
            previews[group_id] = None
            continue
        name = membership.display_name
        rows = (
            (
                await db.execute(
                    select(AgentRunLog)
                    .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
                    .where(
                        AgentRun.agent_session_id == group_id,
                        or_(
                            AgentRunLog.channel == "user_input",
                            and_(
                                AgentRunLog.channel == "stdout",
                                AgentRunLog.metadata_.is_not(None),
                            ),
                        ),
                    )
                    .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
                    .limit(GROUP_LAST_MENTION_SCAN_ROWS)
                )
            )
            .scalars()
            .all()
        )
        hit: AgentRunLog | None = None
        for log_row in rows:
            content = (log_row.content_redacted or "").strip()
            # 同口径 @判定：只认请求用户自己的昵称（广播词/agent 昵称与「@我」无关）。
            if content and any(
                _mention_match(m.group(1), (name,)) for m in _MENTION_TOKEN_RE.finditer(content)
            ):
                hit = log_row
                break
        if hit is None:
            previews[group_id] = None
            continue
        meta = hit.metadata_ or {}
        member_name = (
            meta.get("sender_member_name")
            if hit.channel == "user_input"
            else meta.get("member_name")
        )
        # ts 统一 UTC 感知格式（SQLite 方言往返丢 tz、PG 保留——归一后跨方言一致）。
        hit_ts = hit.timestamp
        if hit_ts.tzinfo is None:
            hit_ts = hit_ts.replace(tzinfo=UTC)
        previews[group_id] = {
            "content": (hit.content_redacted or "").strip()[:GROUP_LAST_MESSAGE_PREVIEW_CHARS],
            "ts": hit_ts.isoformat(),
            "member_name": member_name or "成员",
        }
    return previews


# ── 群消息 DTO（task-03；schema.py 不在本卡 allowed_paths，随服务落本模块——
#    路由层自带轻量 DTO 与 task-02 GroupChatListItemRead 同先例）────────────


class GroupMemberTriggerRead(BaseModel):
    """单成员触发结果（design §8 member.injected / member.mentioned）。

    quick 群 P2（2026-09-02）部分失败收集：触发失败的成员项带 ``error``
    （中文原因摘要，如「引擎不支持附件」「机器会话数已达上限」）——此时
    ``run_id`` 为 None、``shadow_session_id`` 可能为 None（影子未建即失败），
    前端按 ``error`` 非空判定失败并展示；成功项 ``error`` 恒 None。
    """

    member_id: uuid.UUID
    member_name: str
    shadow_session_id: uuid.UUID | None = None  # 失败且未建影子时为 None
    run_id: uuid.UUID | None = None  # 即时注入轮的 run；排队轮为 None
    queued: bool = False  # 忙轮排队（AgentSessionQueuedMessage）
    # quick（2026-09-02 群聊忙轮注入）：忙轮中途注入成功（消息已注入当前
    # 活跃轮 steering，run_id=该活跃 run）；queued=False 且 mid_turn=True。
    mid_turn: bool = False
    # quick 群 P2（2026-09-02）触发失败原因摘要（成功恒 None）。
    error: str | None = None


class GroupChatPinnedRead(BaseModel):
    """置顶消息快照读体（quick 群 P2，``settings_json.pinned`` 透出）。

    ``log_id``：群时间线 ``AgentRunLog`` 行 id（前端可定位原消息气泡）；
    ``pinned_by``/``pinned_at``：置顶操作者与时刻；``content``/``member_name``
    为置顶时的消息内容与发送者身份快照（发送者后续改名不影响已置顶快照）。
    """

    log_id: uuid.UUID
    pinned_by: uuid.UUID
    pinned_at: datetime
    content: str
    member_name: str


def _group_pinned_snapshot(group: AgentGroupChat) -> GroupChatPinnedRead | None:
    """``settings_json.pinned`` → 置顶快照读体（脏数据防御性回落 None）。

    pinned 由 ``pin_message`` 内部写入（键形态受控）；手改库/迁移残留的脏
    快照（缺字段/非 UUID）在读取侧兜底丢弃，不让列表/详情炸序列化——与
    ``_group_guardrail_settings`` 同款防御口径。
    """
    raw = (group.settings_json or {}).get("pinned")
    if not isinstance(raw, dict):
        return None
    try:
        return GroupChatPinnedRead.model_validate(raw)
    except ValidationError:
        log.warning("group_pinned_snapshot_invalid", group_id=str(group.id))
        return None


class GroupMessageSendRead(BaseModel):
    """``POST /group-chats/{id}/messages`` 响应（design §8 group.message.sent）。"""

    carrier_run_id: uuid.UUID
    log_id: uuid.UUID
    mentioned_member_ids: list[uuid.UUID] = Field(default_factory=list)
    mention_all: bool = False
    triggered: list[GroupMemberTriggerRead] = Field(default_factory=list)


class GroupDirectMessageRead(BaseModel):
    """``POST /group-chats/{gid}/members/{mid}/direct-message`` 响应（影子直聊）。

    ``run_id``：即时注入/忙轮中途注入的 run；排队轮为 None（``queued=True``）。
    ``carrier_run_id``：直聊载体 run——群时间线上**零日志行**（直聊内容不进群），
    仅 assistant 回复中的 ``[[GROUP]]`` 转发段投影行挂本 run（run_sync 桥接段）。
    """

    shadow_session_id: uuid.UUID
    run_id: uuid.UUID | None = None
    queued: bool = False
    mid_turn: bool = False
    carrier_run_id: uuid.UUID


class GroupMemberInterruptRead(BaseModel):
    """``POST /group-chats/{gid}/members/{mid}/interrupt`` 响应（quick 群 P1）。

    ``run_id``：被打断的活跃 run（=响应前查到的影子活跃轮）；``interrupted_by_name``
    为打断者群内昵称（admin 兜底放行时回落用户显示名）。
    """

    member_id: uuid.UUID
    display_name: str
    run_id: uuid.UUID | None = None
    interrupted_by_name: str


class GroupChatCreateRead(GroupChatRead):
    """建群响应体（quick 群 P1 llm_provider 预检）。

    ``warnings``：非阻断提示列表（agent 成员未指定模型走本机默认 LLM 出口）；
    其余读取路径（列表/详情）不带本字段。
    """

    warnings: list[str] = Field(default_factory=list)


class GroupMemberAddRead(GroupMemberRead):
    """加成员响应体（quick 群 P1 llm_provider 预检）：``warnings`` 同建群体。"""

    warnings: list[str] = Field(default_factory=list)


# ── 跨模块共享的参与者判定 helper（session/file_artifacts/router 懒加载复用）──


async def get_group_chat_by_session(
    db: AsyncSession,
    session_id: uuid.UUID,
) -> AgentGroupChat | None:
    """按群会话 id 取未软删的群聚合根（id==session_id 不变式下按权威 FK 列查）。"""
    stmt = select(AgentGroupChat).where(
        AgentGroupChat.session_id == session_id,
        AgentGroupChat.deleted_at.is_(None),
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_active_user_membership(
    db: AsyncSession,
    *,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AgentGroupMember | None:
    """取用户在该群的**未移除**用户成员行（design §5.3 成员表命中判定）。"""
    stmt = select(AgentGroupMember).where(
        AgentGroupMember.group_id == group_id,
        AgentGroupMember.member_type == "user",
        AgentGroupMember.user_id == user_id,
        AgentGroupMember.removed_at.is_(None),
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def resolve_shadow_member(
    db: AsyncSession,
    *,
    shadow_session_id: uuid.UUID,
) -> AgentGroupMember | None:
    """按影子会话反向指针定位成员行（§5.1：群↔影子唯一关联通道）。"""
    stmt = select(AgentGroupMember).where(AgentGroupMember.shadow_session_id == shadow_session_id)
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_group_accessible_session(
    db: AsyncSession,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    for_update: bool = False,
    allow_shadow_member_read: bool = False,
) -> AgentSession | None:
    """群会话（kind='group'）/ 影子会话（kind='group_member'）参与者判定。

    非群形态（kind='chat'）返回 None——调用方保持原属主校验路径**零改动**
    （design §5.3「单聊零改动铁律」的实现口径：本 helper 只在首查未命中时
    被调用，chat 热路径单查询不变）。

    判定（§5.3）：

    - ``group``：群成员表命中（user 成员未移除）→ 放行；否则 workspace
      admin（``has_permission`` 现有惯例，含 platform admin 短路）→ 放行；
      否则拒（调用方统一 404 不泄露存在性）。
    - ``group_member``（影子，§5.3「影子会话 API 不对外暴露——仅群桥接内部
      +admin debug」）：属主（群主，影子 user_id 同源）→ 放行；否则 workspace
      admin → 放行；否则拒。用户成员默认**不**经本判定触达影子会话。

    ``allow_shadow_member_read``（群聊体验 quick，2026-09-02）：影子日志
    **只读**放行开关——开启时影子分支额外放行「影子所属群的未移除用户成员」
    （经 ``shadow_session_id`` 反查成员行定位群，再查请求者用户成员行命中），
    供群成员独立时间线视图读 logs。仅读路径调用方显式开启
    （``get_agent_session_logs``）；写路径（``for_update=True``，
    ``_get_owned_session_for_update`` → inject/end 等）即使误传本开关也
    **不放行**普通成员（下方 ``not for_update`` 双保险）。
    """
    kind = (
        await db.execute(select(AgentSession.session_kind).where(AgentSession.id == session_id))
    ).scalar_one_or_none()
    if kind not in ("group", "group_member"):
        return None
    stmt = select(AgentSession).where(AgentSession.id == session_id)
    if for_update:
        stmt = stmt.with_for_update()
    agent_session = (await db.execute(stmt)).scalar_one_or_none()
    if agent_session is None:
        return None

    if kind == "group":
        group = await get_group_chat_by_session(db, session_id)
        if group is None:
            return None
        if await get_active_user_membership(db, group_id=group.id, user_id=user_id) is not None:
            return agent_session
        user = await db.get(User, user_id)
        if user is not None and await has_permission(
            db,
            user=user,
            permission=Permission.WORKSPACE_ADMIN,
            workspace_id=group.workspace_id,
        ):
            return agent_session
        return None

    # 影子会话：属主（群主）或 workspace admin（admin debug）。
    if agent_session.user_id == user_id:
        return agent_session
    shadow_member = await resolve_shadow_member(db, shadow_session_id=session_id)
    if shadow_member is None:
        return None
    shadow_group = await db.get(AgentGroupChat, shadow_member.group_id)
    if shadow_group is None:
        return None
    # 群聊体验 quick（2026-09-02）：影子日志只读放行——反查命中的群里，请求者
    # 是未移除用户成员即放行（成员独立时间线视图读 logs）。仅 allow 开关 +
    # 非 for_update（写路径）双条件下生效，见 docstring。
    if (
        allow_shadow_member_read
        and not for_update
        and await get_active_user_membership(db, group_id=shadow_group.id, user_id=user_id)
    ):
        return agent_session
    user = await db.get(User, user_id)
    if user is not None and await has_permission(
        db,
        user=user,
        permission=Permission.WORKSPACE_ADMIN,
        workspace_id=shadow_group.workspace_id,
    ):
        return agent_session
    return None


def _user_display_name(user: User) -> str:
    """用户成员默认昵称：display_name → username → 用户{id 前缀} 兜底。"""
    return (user.display_name or user.username or f"用户{user.id.hex[:8]}").strip()[:40]


def _validate_display_name(name: str) -> str:
    """昵称规范化 + 保留词校验（@路由无歧义，design §4.1）。"""
    normalized = name.strip()
    if not normalized:
        raise GroupChatInvalid("成员昵称不能为空。")
    if normalized in RESERVED_DISPLAY_NAMES:
        raise GroupChatInvalid(
            f"昵称「{normalized}」是群内保留词（@全体/@all 广播触发词），请换一个昵称。",
        )
    return normalized


def _ensure_display_name_available(
    name: str,
    *,
    active_names: set[str],
    removed_names: set[str],
) -> None:
    """昵称查重（P1 修复：查重口径对齐 DB 唯一约束的全量行语义）。

    ``uq_agent_group_members_group_display_name`` 按 (group_id, display_name)
    对**含已移除行**全量生效——只查 active 会让「移除「小码」后新建同名成员」
    INSERT 直撞约束变 500。占用来源分文案：在群成员占用（老语义）与已移除
    历史行占用（约束同样拦，但语义不同）。
    """
    if name in active_names:
        raise GroupChatInvalid(
            f"群内昵称「{name}」已被使用（用户与 agent 成员共用同一命名空间）。",
            details={"display_name": name},
        )
    if name in removed_names:
        raise GroupChatInvalid(
            f"群内昵称「{name}」与已移除成员昵称冲突，请更换昵称后再试。",
            details={"display_name": name},
        )


class GroupChatService:
    """群管理面业务逻辑（router 薄壳，全部逻辑与权限在此）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 权限（design §5.3）───────────────────────────────────────────────────

    async def _require_group_member(
        self, group: AgentGroupChat, user: User
    ) -> AgentGroupMember | None:
        """两段式参与者判定：成员表命中 → workspace admin → 404（不泄露存在性）。

        返回成员行；admin 兜底放行时无成员行，返回 None（仅表达「有权」）。
        """
        membership = await get_active_user_membership(
            self._session, group_id=group.id, user_id=user.id
        )
        if membership is not None:
            return membership
        if await has_permission(
            self._session,
            user=user,
            permission=Permission.WORKSPACE_ADMIN,
            workspace_id=group.workspace_id,
        ):
            return None
        raise GroupChatNotFound(
            "群不存在或无权访问。",
            details={"group_id": str(group.id)},
        )

    async def _require_group_owner(self, group: AgentGroupChat, user: User) -> None:
        """群主专属操作门（§6.1：改设置/加删成员/解散=群主+workspace admin）。

        前置：调用方已过 ``_require_group_member``（非成员 404 先行）。
        """
        if group.created_by == user.id:
            return
        if await has_permission(
            self._session,
            user=user,
            permission=Permission.WORKSPACE_ADMIN,
            workspace_id=group.workspace_id,
        ):
            return
        raise GroupChatForbidden(
            "只有群主或工作区管理员可以执行该操作。",
            details={"group_id": str(group.id)},
        )

    async def _get_group(self, group_id: uuid.UUID) -> AgentGroupChat:
        """取未软删的群聚合根（含已解散——解散群对成员仍可读，end 幂等）。"""
        group = (
            await self._session.execute(
                select(AgentGroupChat).where(
                    AgentGroupChat.id == group_id,
                    AgentGroupChat.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if group is None:
            raise GroupChatNotFound(
                "群不存在或无权访问。",
                details={"group_id": str(group_id)},
            )
        return group

    # ── 查询 helper ──────────────────────────────────────────────────────────

    async def _list_members(self, group_id: uuid.UUID) -> list[AgentGroupMember]:
        """群成员全量（含已移除行——详情展示移除态；排序：在群优先，joined_at 升序）。"""
        stmt = (
            select(AgentGroupMember)
            .where(AgentGroupMember.group_id == group_id)
            .order_by(
                AgentGroupMember.removed_at.is_not(None),
                AgentGroupMember.joined_at,
                AgentGroupMember.id,
            )
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def _list_active_member_rows(self, group_id: uuid.UUID) -> list[AgentGroupMember]:
        stmt = (
            select(AgentGroupMember)
            .where(
                AgentGroupMember.group_id == group_id,
                AgentGroupMember.removed_at.is_(None),
            )
            .order_by(AgentGroupMember.joined_at, AgentGroupMember.id)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def _member_name_occupancy(
        self,
        group_id: uuid.UUID,
        *,
        exclude_member_id: uuid.UUID | None = None,
    ) -> tuple[set[str], set[str]]:
        """昵称占用快照（active / removed 两组，P1 修复口径）。

        唯一约束 ``uq_agent_group_members_group_display_name`` 全量含已移除行，
        查重必须同口径（否则同名新增直撞约束 500）。``exclude_member_id``
        排除改名成员/复活行自身——成员改回或沿用自己原昵称合法（UPDATE 不
        撞自身行）。
        """
        rows = await self._list_members(group_id)
        active_names: set[str] = set()
        removed_names: set[str] = set()
        for row in rows:
            if exclude_member_id is not None and row.id == exclude_member_id:
                continue
            if row.removed_at is None:
                active_names.add(row.display_name)
            else:
                removed_names.add(row.display_name)
        return active_names, removed_names

    async def _get_member(self, group_id: uuid.UUID, member_id: uuid.UUID) -> AgentGroupMember:
        member = (
            await self._session.execute(
                select(AgentGroupMember).where(
                    AgentGroupMember.id == member_id,
                    AgentGroupMember.group_id == group_id,
                )
            )
        ).scalar_one_or_none()
        if member is None or member.removed_at is not None:
            raise GroupChatMemberNotFound(
                "群成员不存在或已移除。",
                details={"group_id": str(group_id), "member_id": str(member_id)},
            )
        return member

    def _to_read(self, group: AgentGroupChat, members: list[AgentGroupMember]) -> GroupChatRead:
        read = GroupChatRead.model_validate(group)
        read.members = [GroupMemberRead.model_validate(m) for m in members]
        # quick 群 P2：置顶快照透出（GroupChatRead.pinned 为 dict 形态，router
        # 层子类读体再收窄为 typed GroupChatPinnedRead）。
        pinned = _group_pinned_snapshot(group)
        read.pinned = pinned.model_dump(mode="json") if pinned is not None else None
        return read

    # ── 项目口径 helper（quick 群 PPM 项目化）────────────────────────────────

    async def _project_linked_workspace_ids(self, project_id: uuid.UUID) -> set[uuid.UUID]:
        """项目关联工作区 id 集（link_service.list_by_project，过滤软删工作区）。"""
        from app.modules.workspace import link_service

        linked = await link_service.list_by_project(self._session, ppm_project_id=project_id)
        return {w.workspace_id for w in linked}

    async def _project_member_user_ids(self, project_id: uuid.UUID) -> set[uuid.UUID]:
        """项目成员 user_id 集（PpmProjectMember.pm_project_id → user_id）。"""
        from app.modules.ppm.project.model import PpmProjectMember

        rows = (
            (
                await self._session.execute(
                    select(PpmProjectMember.user_id).where(
                        PpmProjectMember.pm_project_id == project_id
                    )
                )
            )
            .scalars()
            .all()
        )
        return set(rows)

    async def _require_user_in_member_scope(self, group: AgentGroupChat, target: User) -> None:
        """邀请人员范围校验：项目群=项目成员；存量群（project_id NULL）回退 workspace 范围。

        建群口径（create_group）：project_id 必填、建群者本人须为项目成员——
        本 helper 只服务加成员（add_member）与建群邀请（调用方自持集合）；
        存量群回退口径=目标用户在群工作区有任意 workspace 角色（含 platform
        admin 短路兜底）。
        """
        if group.project_id is not None:
            if target.id not in await self._project_member_user_ids(group.project_id):
                raise GroupChatInvalid(
                    "邀请的用户不是项目成员，无法加入群聊。",
                    details={
                        "user_id": str(target.id),
                        "project_id": str(group.project_id),
                    },
                )
            return
        # 存量群回退 workspace 成员范围（quick 前口径的宽松版：有角色即视为成员）。
        from app.modules.auth.model import UserWorkspaceRole

        row = await self._session.execute(
            select(UserWorkspaceRole.user_id).where(
                UserWorkspaceRole.workspace_id == group.workspace_id,
                UserWorkspaceRole.user_id == target.id,
            )
        )
        if row.first() is not None:
            return
        if target.is_platform_admin:
            return
        raise GroupChatInvalid(
            "邀请的用户不是该工作区成员，无法加入群聊。",
            details={"user_id": str(target.id), "workspace_id": str(group.workspace_id)},
        )

    async def _ensure_member_workspace_in_project(
        self, group: AgentGroupChat, workspace_id: uuid.UUID
    ) -> None:
        """agent 成员 cwd 工作区校验：项目群须在项目关联工作区集内。

        存量群（project_id NULL）回退原逻辑——不校验（quick 前口径即直存）。
        """
        if group.project_id is None:
            return
        if workspace_id not in await self._project_linked_workspace_ids(group.project_id):
            raise GroupChatInvalid(
                "agent 成员的工作区不在项目关联范围内。",
                details={
                    "workspace_id": str(workspace_id),
                    "project_id": str(group.project_id),
                },
            )

    # ── 影子会话 end 子链（解散/移除 agent 成员/reset-memory 共用）────────────

    async def _end_member_shadow(
        self,
        member: AgentGroupMember,
        *,
        owner_user_id: uuid.UUID,
        reason: str,
    ) -> None:
        """end 成员影子会话 + 清理影子队列 pending 行（design §8）。

        本卡（task-02）影子会话尚未存在（task-03 懒建）：``shadow_session_id``
        为空直接跳过（幂等）；非空则先删影子队列 pending 行（design §8
        group.member.removed「防终态后静默丢弃」——先删保证 end 链异常时队列
        也不残留），再走既有 ``end_session`` 链（user_id=群主，影子 user_id
        同源——服务身份路径先例）。end 失败 best-effort 降级（warning +
        继续，解散/移除不被单个影子的不变式异常阻断）。
        """
        if member.shadow_session_id is None:
            return
        shadow_session_id = member.shadow_session_id
        await self._session.execute(
            delete(AgentSessionQueuedMessage).where(
                AgentSessionQueuedMessage.agent_session_id == shadow_session_id,
                AgentSessionQueuedMessage.status == "pending",
            )
        )
        await self._session.commit()
        try:
            await SessionService(self._session).end_session(
                shadow_session_id,
                owner_user_id,
                reason=reason,
            )
        except AppError as exc:
            log.warning(
                "group_member_shadow_end_failed",
                group_id=str(member.group_id),
                member_id=str(member.id),
                shadow_session_id=str(shadow_session_id),
                code=exc.code,
            )

    # ── 建群 / 列表 / 详情 / 改设置 / 解散 ────────────────────────────────────

    async def create_group(self, user: User, payload: GroupChatCreate) -> GroupChatCreateRead:
        """建群（design §8 group.created）：群会话 + 群行 + 初始成员（单事务）。

        校验（全部前置，无半成品落库）：项目存在且有关联工作区（群 workspace
        由项目关联集推导——显式传入须在集内，未传取首个）；建群者为项目成员；
        上限（用户 50 含建群者 / agent 8）；用户成员存在且为项目成员；agent
        成员六要素引用存在且 cwd 工作区在项目关联集内；昵称唯一（用户与 agent
        共用命名空间）+ 保留词。

        quick 群 PPM 项目化口径：``project_id`` 必填落群行；项目删除后存量群
        project_id 被 SET NULL，成员邀请范围回退 workspace 口径（add_member）。
        quick 群 P1 llm_provider 预检：agent 成员未指定模型不阻断（本机默认
        可能可用），随响应 ``warnings`` 提示。
        """
        from app.modules.agent.profile.model import AgentProfile
        from app.modules.llm_provider.model import LlmProvider
        from app.modules.ppm.project.model import PpmProjectMaintenance
        from app.modules.workspace import link_service
        from app.modules.workspace.model import Workspace
        from app.modules.workspace.service import WorkspaceService

        # ── 项目口径：存在 → 关联工作区 → workspace 推导 ─────────────────────
        project = await self._session.get(PpmProjectMaintenance, payload.project_id)
        if project is None:
            raise GroupChatInvalid(
                "目标项目不存在，无法在该项目下建群。",
                details={"project_id": str(payload.project_id)},
            )
        linked = await link_service.list_by_project(self._session, ppm_project_id=project.id)
        if not linked:
            raise GroupChatInvalid(
                "该项目未关联工作区，请先在项目中关联。",
                details={"project_id": str(project.id)},
            )
        linked_ids = {w.workspace_id for w in linked}
        if payload.workspace_id is not None:
            if payload.workspace_id not in linked_ids:
                raise GroupChatInvalid(
                    "指定的工作区不在项目关联范围内。",
                    details={
                        "workspace_id": str(payload.workspace_id),
                        "project_id": str(project.id),
                    },
                )
            workspace_id = payload.workspace_id
        else:
            workspace_id = linked[0].workspace_id
        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None:
            # link_service 已过滤软删工作区，这里防御 FK 竞态（软删发生在两查之间）。
            raise GroupChatInvalid(
                "目标工作区不存在，无法在该工作区下建群。",
                details={"workspace_id": str(workspace_id)},
            )
        WorkspaceService.ensure_writable(workspace)

        # 建群者本人须为项目成员（群主是群的锚点人，不适用邀请豁免）。
        project_member_ids = await self._project_member_user_ids(project.id)
        if user.id not in project_member_ids:
            raise GroupChatInvalid(
                "建群者需为项目成员。",
                details={"project_id": str(project.id), "user_id": str(user.id)},
            )

        # ── 上限（design §9.3）───────────────────────────────────────────────
        if len(payload.user_members) + 1 > GROUP_USER_MEMBER_LIMIT:
            raise GroupChatInvalid(
                f"群用户成员上限为 {GROUP_USER_MEMBER_LIMIT}（含建群者），当前邀请数已超出。",
                details={"user_members": len(payload.user_members)},
            )
        if len(payload.agent_members) > GROUP_AGENT_MEMBER_LIMIT:
            raise GroupChatInvalid(
                f"群 agent 成员上限为 {GROUP_AGENT_MEMBER_LIMIT}，当前配置数已超出。",
                details={"agent_members": len(payload.agent_members)},
            )

        # ── 引用存在性（批量 IN 查，免逐个 N+1）──────────────────────────────
        invited_ids = [m.user_id for m in payload.user_members]
        invited_users: dict[uuid.UUID, User] = {}
        if invited_ids:
            # P1 修复：入参一致性前置 400——重复 user_id 落库会撞
            # (group_id, user_id) 部分唯一索引；建群者下方自动落成员行，
            # 邀请自己 = 同一 user_id 双 INSERT，同样撞索引变 500。
            if user.id in invited_ids:
                raise GroupChatInvalid(
                    "建群者自动加入群聊，无需邀请自己。",
                    details={"user_id": str(user.id)},
                )
            duplicate_ids = {str(uid) for uid, cnt in Counter(invited_ids).items() if cnt > 1}
            if duplicate_ids:
                raise GroupChatInvalid(
                    "重复邀请同一用户，无法建群。",
                    details={"duplicate_user_ids": sorted(duplicate_ids)},
                )
            rows = (
                (await self._session.execute(select(User).where(User.id.in_(invited_ids))))
                .scalars()
                .all()
            )
            invited_users = {row.id: row for row in rows}
            missing = [str(uid) for uid in invited_ids if uid not in invited_users]
            if missing:
                raise GroupChatInvalid(
                    "邀请的用户不存在，无法加入群聊。",
                    details={"missing_user_ids": missing},
                )
            # quick 群 PPM 项目化：邀请人员范围=项目成员（建群者已在上方单查）。
            outside = [str(uid) for uid in invited_ids if uid not in project_member_ids]
            if outside:
                raise GroupChatInvalid(
                    "邀请的用户不是项目成员，无法加入群聊。",
                    details={"user_ids": outside, "project_id": str(project.id)},
                )

        runtime_ids = [m.runtime_id for m in payload.agent_members]
        runtimes: dict[uuid.UUID, tuple[DaemonRuntime, DaemonInstance | None]] = {}
        if runtime_ids:
            rt_rows = (
                await self._session.execute(
                    select(DaemonRuntime, DaemonInstance)
                    .join(
                        DaemonInstance,
                        DaemonRuntime.daemon_instance_id == DaemonInstance.id,
                        isouter=True,
                    )
                    .where(DaemonRuntime.id.in_(runtime_ids))
                )
            ).all()
            runtimes = {rt.id: (rt, inst) for rt, inst in rt_rows}
            missing_rt = [str(rid) for rid in runtime_ids if rid not in runtimes]
            if missing_rt:
                raise GroupChatInvalid(
                    "agent 成员绑定的机器不存在，请检查六要素配置。",
                    details={"missing_runtime_ids": missing_rt},
                )

        # agent 成员 cwd 工作区（六要素②）须在项目关联工作区集内（quick 口径）；
        # 团队能力引擎门控（quick 群成员团队能力）：daemon 主控 5 工具仅对
        # provider=claude 注入（isMainAgentSession 谓词），非 Claude 开启 → 400。
        for cfg in payload.agent_members:
            if cfg.workspace_id is not None and cfg.workspace_id not in linked_ids:
                raise GroupChatInvalid(
                    "agent 成员的工作区不在项目关联范围内。",
                    details={
                        "workspace_id": str(cfg.workspace_id),
                        "project_id": str(project.id),
                    },
                )
            if cfg.team_enabled and cfg.provider != "claude":
                raise GroupChatInvalid(
                    f"agent 成员「{cfg.display_name}」的团队能力仅支持 Claude 引擎。",
                    details={
                        "display_name": cfg.display_name,
                        "provider": cfg.provider,
                    },
                )

        profile_ids = [m.agent_profile_id for m in payload.agent_members if m.agent_profile_id]
        profiles: dict[uuid.UUID, AgentProfile] = {}
        if profile_ids:
            profile_rows = (
                (
                    await self._session.execute(
                        select(AgentProfile).where(AgentProfile.id.in_(profile_ids))
                    )
                )
                .scalars()
                .all()
            )
            profiles = {p.id: p for p in profile_rows}
            missing_p = [str(pid) for pid in profile_ids if pid not in profiles]
            if missing_p:
                raise GroupChatInvalid(
                    "agent 成员绑定的智能体方案不存在。",
                    details={"missing_agent_profile_ids": missing_p},
                )

        llm_ids = [m.llm_provider_id for m in payload.agent_members if m.llm_provider_id]
        llms: dict[uuid.UUID, LlmProvider] = {}
        if llm_ids:
            llm_rows = (
                (
                    await self._session.execute(
                        select(LlmProvider).where(LlmProvider.id.in_(llm_ids))
                    )
                )
                .scalars()
                .all()
            )
            llms = {row.id: row for row in llm_rows}
            missing_l = [str(lid) for lid in llm_ids if lid not in llms]
            if missing_l:
                raise GroupChatInvalid(
                    "agent 成员绑定的模型（LLM 供应商）不存在。",
                    details={"missing_llm_provider_ids": missing_l},
                )

        # ── 昵称解析 + 唯一性（用户与 agent 共用命名空间，design §3.3）────────
        names: dict[str, str] = {}
        resolved_user_members: list[tuple[User, str, GroupMemberUserCreate]] = []
        owner_name = _validate_display_name(_user_display_name(user))
        names[owner_name] = str(user.id)
        for invite in payload.user_members:
            target = invited_users[invite.user_id]
            name = _validate_display_name(invite.display_name or _user_display_name(target))
            if name in names:
                raise GroupChatInvalid(
                    f"群内昵称「{name}」已被使用（用户与 agent 成员共用同一命名空间）。",
                    details={"display_name": name},
                )
            names[name] = str(target.id)
            resolved_user_members.append((target, name, invite))
        for cfg in payload.agent_members:
            name = _validate_display_name(cfg.display_name)
            if name in names:
                raise GroupChatInvalid(
                    f"群内昵称「{name}」已被使用（用户与 agent 成员共用同一命名空间）。",
                    details={"display_name": name},
                )
            names[name] = cfg.runtime_id.hex

        # ── 落库：群会话（kind='group'，无 lease）+ 群行 + 成员行 ─────────────
        now = datetime.now(UTC)
        group_session = AgentSession(
            id=uuid.uuid4(),
            user_id=user.id,  # 计量归属=群主（design §9.2）
            runtime_id=None,
            lease_id=None,
            provider=GROUP_SESSION_PROVIDER,
            status="active",  # design §8 group.created：无 daemon 握手，直接活跃
            title=payload.title,
            workspace_id=workspace.id,
            turn_count=0,
            created_at=now,
            session_kind="group",
        )
        self._session.add(group_session)
        await self._session.flush()

        group = AgentGroupChat(
            id=group_session.id,  # id==session_id 不变式（design §3.2）
            session_id=group_session.id,
            workspace_id=workspace.id,
            project_id=project.id,  # quick 群 PPM 项目化
            title=payload.title,
            created_by=user.id,
            agent_cross_mention=payload.agent_cross_mention,
            cross_mention_depth=payload.cross_mention_depth,
            context_window=payload.context_window,
            created_at=now,
        )
        self._session.add(group)
        await self._session.flush()

        members: list[AgentGroupMember] = [
            # 建群者自身落用户成员行（§5.3 参与者制：群主=成员）。
            AgentGroupMember(
                group_id=group.id,
                member_type="user",
                display_name=owner_name,
                user_id=user.id,
                invited_by=user.id,
                joined_at=now,
            )
        ]
        for target, name, invite in resolved_user_members:
            members.append(
                AgentGroupMember(
                    group_id=group.id,
                    member_type="user",
                    display_name=name,
                    avatar=invite.avatar,  # quick 成员头像（None=未自定义）
                    user_id=target.id,
                    invited_by=user.id,
                    joined_at=now,
                )
            )
        for cfg in payload.agent_members:
            rt, inst = runtimes[cfg.runtime_id]
            profile = profiles.get(cfg.agent_profile_id) if cfg.agent_profile_id else None
            llm = llms.get(cfg.llm_provider_id) if cfg.llm_provider_id else None
            members.append(
                AgentGroupMember(
                    group_id=group.id,
                    member_type="agent",
                    display_name=cfg.display_name.strip(),
                    avatar=cfg.avatar,  # quick 成员头像（None=未自定义）
                    runtime_id=cfg.runtime_id,
                    workspace_id=cfg.workspace_id or workspace.id,
                    provider=cfg.provider,
                    llm_provider_id=cfg.llm_provider_id,
                    agent_profile_id=cfg.agent_profile_id,
                    team_enabled=cfg.team_enabled,  # quick 群成员团队能力
                    shadow_status="none",  # design §8 group.member.added
                    invited_by=user.id,
                    joined_at=now,
                    config_snapshot=_build_config_snapshot(
                        runtime=rt,
                        instance=inst,
                        provider=cfg.provider,
                        profile=profile,
                        llm=llm,
                    ),
                )
            )
        for m in members:
            self._session.add(m)

        await self._session.commit()
        await self._session.refresh(group)
        refreshed = await self._list_members(group.id)
        # task-06（§5.3 audience）：建群信号带全部用户成员 id（邀请者即时收到
        # 列表刷新——群会话不进其 /sessions 列表，刷新信号是唯一入口）。
        await self._publish_group_sessions_changed(group, "created")
        return GroupChatCreateRead.model_validate(
            {
                **self._to_read(group, refreshed).model_dump(mode="json"),
                # quick 群 P1 llm_provider 预检：非阻断提示（不拦截建群）。
                "warnings": _build_llm_provider_warnings(payload.agent_members),
            }
        )

    async def list_groups(self, user: User) -> list[GroupChatRead]:
        """当前用户=群成员（未移除用户成员行）的群列表（design §6.1）。

        成员摘要经成员行 + ``config_snapshot`` 冗余直出（免 N+1：按群 IN
        批量取成员）。``online_member_ids``/最后消息摘要由 router 层占位
        （task-06 填充）。
        """
        stmt = (
            select(AgentGroupChat)
            .join(
                AgentGroupMember,
                (AgentGroupMember.group_id == AgentGroupChat.id)
                & (AgentGroupMember.member_type == "user")
                & (AgentGroupMember.user_id == user.id)
                & AgentGroupMember.removed_at.is_(None),
            )
            .where(AgentGroupChat.deleted_at.is_(None))
            .order_by(AgentGroupChat.created_at.desc(), AgentGroupChat.id.desc())
        )
        groups = list((await self._session.execute(stmt)).scalars().all())
        if not groups:
            return []
        group_ids = [g.id for g in groups]
        member_rows = (
            (
                await self._session.execute(
                    select(AgentGroupMember)
                    .where(
                        AgentGroupMember.group_id.in_(group_ids),
                        AgentGroupMember.removed_at.is_(None),
                    )
                    .order_by(AgentGroupMember.joined_at, AgentGroupMember.id)
                )
            )
            .scalars()
            .all()
        )
        by_group: dict[uuid.UUID, list[AgentGroupMember]] = {}
        for row in member_rows:
            by_group.setdefault(row.group_id, []).append(row)
        return [self._to_read(g, by_group.get(g.id, [])) for g in groups]

    async def get_group(self, group_id: uuid.UUID, user: User) -> GroupChatRead:
        """群详情（成员完整列表含六要素 + shadow_status，design §6.1）。"""
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        members = await self._list_members(group.id)
        return self._to_read(group, members)

    async def get_member_shadow_running(self, group_id: uuid.UUID) -> dict[uuid.UUID, bool]:
        """群详情成员运行态兜底（群聊运行态可见 quick，2026-09-02）。

        agent 成员查影子会话活跃 run（谓词同 ``_get_shadow_active_run``：
        ACTIVE_RUN_STATUSES 单一词表）——True=该成员影子正在跑轮，是前端
        typing 事件丢失/SSE 迟连时的兜底可见信号；影子未建/已终态/用户成员
        恒 False。逐成员 LIMIT 1 查询（成员上限 50，可接受）。
        """
        rows = await self._list_active_member_rows(group_id)
        running: dict[uuid.UUID, bool] = {}
        for member in rows:
            running[member.id] = (
                member.member_type == "agent"
                and member.shadow_session_id is not None
                and await self._get_shadow_active_run(member.shadow_session_id) is not None
            )
        return running

    async def update_group(
        self,
        group_id: uuid.UUID,
        user: User,
        payload: GroupChatUpdate,
    ) -> GroupChatRead:
        """改群设置（群主/workspace admin；None=不改，design §6.1）。"""
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法修改设置。",
                details={"group_id": str(group.id)},
            )
        if payload.title is not None:
            group.title = payload.title
        if payload.agent_cross_mention is not None:
            group.agent_cross_mention = payload.agent_cross_mention
        if payload.cross_mention_depth is not None:
            group.cross_mention_depth = payload.cross_mention_depth
        if payload.context_window is not None:
            group.context_window = payload.context_window
        if payload.settings_json is not None:
            # quick 群 P1（2026-09-02）互@护栏群级可配：settings_json.guardrails
            # 子键写入（字段级合并；非法键/范围外值 400 中文）。
            group.settings_json = _merge_group_settings_json(
                group.settings_json, payload.settings_json
            )
        self._session.add(group)
        await self._session.commit()
        await self._session.refresh(group)
        members = await self._list_members(group.id)
        # task-06（§5.3 audience）：设置变更信号（群列表标题/开关投影刷新）。
        await self._publish_group_sessions_changed(group, "status_changed")
        return self._to_read(group, members)

    async def end_group(self, group_id: uuid.UUID, user: User) -> GroupChatRead:
        """解散群（design §8 group.ended，幂等）。

        收口链：全部有影子的成员 end 影子（既有 end_session 链 + 影子队列
        pending 行删除）→ 群会话置 ended（无 lease，直接 ORM 收口）→ 群行
        ended_at + agent 成员 shadow_status='ended' → 群频道广播
        ``session_ended``（群 SSE 只认该事件收流，P1 修复）。
        """
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            # 幂等：重复解散直接回读。
            members = await self._list_members(group.id)
            return self._to_read(group, members)

        active_members = await self._list_active_member_rows(group.id)
        for member in active_members:
            if member.member_type == "agent":
                await self._end_member_shadow(
                    member, owner_user_id=group.created_by, reason="group_ended"
                )

        now = datetime.now(UTC)
        group_session = await self._session.get(AgentSession, group.session_id)
        if group_session is not None and group_session.status not in ("ended", "failed"):
            group_session.status = "ended"
            group_session.ended_at = now
            group_session.last_active_at = now
            self._session.add(group_session)
        group.ended_at = now
        self._session.add(group)
        for member in active_members:
            if member.member_type == "agent" and member.shadow_session_id is not None:
                member.shadow_status = "ended"  # design §8 group.ended
                self._session.add(member)
        await self._session.commit()
        await self._session.refresh(group)
        members = await self._list_members(group.id)
        # P1 修复（照 lease_service/sweep 的 session_ended 先例 + SSE 生成器
        # 消费字段）：群会话终态落库后向群频道广播 session_ended——群 SSE
        # 生成器只认该事件收流，不发则已连客户端永远 keepalive（前端解散
        # 收口死路径 + presence 死群恒在线）。幂等早退路径不重发（首末已发）。
        await _publish_group_channel_event(
            group.session_id,
            {
                "event": "session_ended",
                "session_id": str(group.session_id),
                "status": "ended",
                "reason": "group_ended",
            },
        )
        # task-06（§5.3 audience / §8 group.ended）：解散信号全员可见（列表把
        # 已解散群折叠/移出）。
        await self._publish_group_sessions_changed(group, "status_changed")
        return self._to_read(group, members)

    # ── 成员管理（design §6.1 / §8）─────────────────────────────────────────

    async def add_member(
        self,
        group_id: uuid.UUID,
        user: User,
        payload: GroupMemberCreate,
    ) -> GroupMemberAddRead:
        """加成员（群主/workspace admin）：用户邀请或 agent 成员六要素配置。

        quick 群 P1 llm_provider 预检：agent 成员未指定模型不阻断，随响应
        ``warnings`` 提示（同建群体）。
        """
        from app.modules.agent.profile.model import AgentProfile
        from app.modules.llm_provider.model import LlmProvider

        if (payload.user is None) == (payload.agent is None):
            raise GroupChatInvalid(
                "成员写体二选一：user（邀请用户）或 agent（六要素配置）。",
            )
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法添加成员。",
                details={"group_id": str(group.id)},
            )
        active_members = await self._list_active_member_rows(group.id)
        active_user_count = sum(1 for m in active_members if m.member_type == "user")
        active_agent_count = sum(1 for m in active_members if m.member_type == "agent")

        now = datetime.now(UTC)
        if payload.user is not None:
            if active_user_count + 1 > GROUP_USER_MEMBER_LIMIT:
                raise GroupChatInvalid(
                    f"群用户成员上限为 {GROUP_USER_MEMBER_LIMIT}，无法继续添加。",
                )
            target = await self._session.get(User, payload.user.user_id)
            if target is None:
                raise GroupChatInvalid(
                    "邀请的用户不存在，无法加入群聊。",
                    details={"user_id": str(payload.user.user_id)},
                )
            # quick 群 PPM 项目化：邀请范围=项目成员（存量群 project_id NULL
            # 回退 workspace 成员范围，见 helper）。
            await self._require_user_in_member_scope(group, target)
            # 复活语义先行（部分唯一索引 uq_agent_group_members_group_user 按
            # (group_id, user_id) 恒占位）：已移除用户再次邀请走原行复活，不撞
            # 索引（design §3.3 UNIQUE(group_id, user_id)）；在群用户重复邀请
            # 的 400 语义先于昵称冲突判定（昵称常与本人现名相同，先查成员行
            # 才能给出准确文案）。
            revived = (
                await self._session.execute(
                    select(AgentGroupMember).where(
                        AgentGroupMember.group_id == group.id,
                        AgentGroupMember.user_id == target.id,
                    )
                )
            ).scalar_one_or_none()
            if revived is not None and revived.removed_at is None:
                raise GroupChatInvalid(
                    "该用户已是群成员，无法重复邀请。",
                    details={"user_id": str(target.id)},
                )
            # P1 修复：查重含已移除行（DB 唯一约束全量生效）；复活行自身
            # 占位除外——被复活用户沿用/改回原昵称合法（UPDATE 不撞自身行）。
            active_names, removed_names = await self._member_name_occupancy(
                group.id, exclude_member_id=revived.id if revived is not None else None
            )
            name = _validate_display_name(payload.user.display_name or _user_display_name(target))
            _ensure_display_name_available(
                name, active_names=active_names, removed_names=removed_names
            )
            if revived is not None:
                revived.removed_at = None
                revived.display_name = name
                if payload.user.avatar is not None:
                    revived.avatar = payload.user.avatar  # quick 成员头像（None=不改）
                revived.invited_by = user.id
                revived.joined_at = now
                self._session.add(revived)
                await self._session.commit()
                await self._session.refresh(revived)
                # task-06（§5.3 audience / §8 group.member.added）。
                await self._publish_group_sessions_changed(group, "status_changed")
                return GroupMemberAddRead.model_validate(revived)
            member = AgentGroupMember(
                group_id=group.id,
                member_type="user",
                display_name=name,
                avatar=payload.user.avatar,  # quick 成员头像（None=未自定义）
                user_id=target.id,
                invited_by=user.id,
                joined_at=now,
            )
            self._session.add(member)
            await self._session.commit()
            await self._session.refresh(member)
            # task-06（§5.3 audience / §8 group.member.added）：新成员即时进
            # 自己的刷新受众（否则要等下一次任意群事件才看到群）。
            await self._publish_group_sessions_changed(group, "status_changed")
            return GroupMemberAddRead.model_validate(member)

        assert payload.agent is not None
        cfg = payload.agent
        if active_agent_count + 1 > GROUP_AGENT_MEMBER_LIMIT:
            raise GroupChatInvalid(
                f"群 agent 成员上限为 {GROUP_AGENT_MEMBER_LIMIT}，无法继续添加。",
            )
        rt_row = (
            await self._session.execute(
                select(DaemonRuntime, DaemonInstance)
                .join(
                    DaemonInstance,
                    DaemonRuntime.daemon_instance_id == DaemonInstance.id,
                    isouter=True,
                )
                .where(DaemonRuntime.id == cfg.runtime_id)
            )
        ).first()
        if rt_row is None:
            raise GroupChatInvalid(
                "agent 成员绑定的机器不存在，请检查六要素配置。",
                details={"runtime_id": str(cfg.runtime_id)},
            )
        runtime, instance = rt_row[0], rt_row[1]
        # agent 成员 cwd 工作区须在项目关联工作区集内（存量群回退原逻辑不校验）；
        # 团队能力引擎门控（建群同口径）：仅 Claude 可开。
        if cfg.workspace_id is not None:
            await self._ensure_member_workspace_in_project(group, cfg.workspace_id)
        if cfg.team_enabled and cfg.provider != "claude":
            raise GroupChatInvalid(
                f"agent 成员「{cfg.display_name}」的团队能力仅支持 Claude 引擎。",
                details={"provider": cfg.provider},
            )
        profile: AgentProfile | None = None
        if cfg.agent_profile_id is not None:
            profile = await self._session.get(AgentProfile, cfg.agent_profile_id)
            if profile is None:
                raise GroupChatInvalid(
                    "agent 成员绑定的智能体方案不存在。",
                    details={"agent_profile_id": str(cfg.agent_profile_id)},
                )
        llm: LlmProvider | None = None
        if cfg.llm_provider_id is not None:
            llm = await self._session.get(LlmProvider, cfg.llm_provider_id)
            if llm is None:
                raise GroupChatInvalid(
                    "agent 成员绑定的模型（LLM 供应商）不存在。",
                    details={"llm_provider_id": str(cfg.llm_provider_id)},
                )
        # P1 修复：同上——agent 成员昵称查重含已移除行（防撞全量唯一约束）。
        active_names, removed_names = await self._member_name_occupancy(group.id)
        name = _validate_display_name(cfg.display_name)
        _ensure_display_name_available(name, active_names=active_names, removed_names=removed_names)
        member = AgentGroupMember(
            group_id=group.id,
            member_type="agent",
            display_name=name,
            avatar=cfg.avatar,  # quick 成员头像（None=未自定义）
            runtime_id=cfg.runtime_id,
            workspace_id=cfg.workspace_id or group.workspace_id,
            provider=cfg.provider,
            llm_provider_id=cfg.llm_provider_id,
            agent_profile_id=cfg.agent_profile_id,
            team_enabled=cfg.team_enabled,  # quick 群成员团队能力
            shadow_status="none",
            invited_by=user.id,
            joined_at=now,
            config_snapshot=_build_config_snapshot(
                runtime=runtime,
                instance=instance,
                provider=cfg.provider,
                profile=profile,
                llm=llm,
            ),
        )
        self._session.add(member)
        await self._session.commit()
        await self._session.refresh(member)
        # task-06（§5.3 audience）：agent 成员变更同样广播（成员 chips 刷新）。
        await self._publish_group_sessions_changed(group, "status_changed")
        # quick 群 P1 llm_provider 预检：未指定模型非阻断提示（同建群体）。
        added = GroupMemberAddRead.model_validate(member)
        added.warnings = _build_llm_provider_warnings([cfg])
        return added

    async def update_member(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
        payload: GroupMemberUpdate,
    ) -> GroupMemberRead:
        """改成员（群主/workspace admin）：改昵称 / agent 成员六要素。

        六要素热切换（task-04，design §4.5）：模型组（provider/llm_provider/
        agent_profile）变更且影子存在 → 影子三列同步 + SESSION_SWITCH_CONFIG
        服务身份下发（下轮边界生效）；机器组（runtime/workspace）变更且影子
        存在 → end 影子 + ``shadow_status='pending'``（下次触发懒重建，记忆
        重置）。config_snapshot 同步更新（§3.3 冗余）。
        """
        from app.modules.agent.profile.model import AgentProfile
        from app.modules.llm_provider.model import LlmProvider

        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法修改成员。",
                details={"group_id": str(group.id)},
            )
        member = await self._get_member(group.id, member_id)

        if member.member_type != "agent" and (
            payload.runtime_id is not None
            or payload.workspace_id is not None
            or payload.provider is not None
            or payload.llm_provider_id is not None
            or payload.agent_profile_id is not None
            or payload.team_enabled is not None
        ):
            raise GroupChatInvalid(
                "用户成员不支持修改六要素配置（仅 agent 成员可配置）。",
                details={"member_id": str(member.id)},
            )

        # quick 成员头像：用户与 agent 成员共用（None=不改，非六要素维度）。
        if payload.avatar is not None:
            member.avatar = payload.avatar

        # task-04（design §4.5）：六要素 diff 基线——变更前的三组维度值
        # （模型组 provider/llm_provider_id/agent_profile_id 走热切换；机器组
        # runtime_id/workspace_id 走影子重建；team_enabled 归机器组——stage 随
        # lease 建时定，复用轮改不掉）。
        old_config = {
            "runtime_id": member.runtime_id,
            "workspace_id": member.workspace_id,
            "provider": member.provider,
            "llm_provider_id": member.llm_provider_id,
            "agent_profile_id": member.agent_profile_id,
            "team_enabled": member.team_enabled,
        }

        # quick-6966fcee 存量自愈：早期影子建行带 config.manual_approval=False
        # （审批不进群旧设计）——影子已挂完整 SessionPanel 可作答，此处幂等
        # 修正为 None（复用任何成员 PATCH 路径触达；不重建影子、记忆无损）。
        if (
            member.shadow_session_id is not None
            and isinstance(
                member_config := (await self._session.get(AgentSession, member.shadow_session_id)),
                AgentSession,
            )
            and isinstance(member_config.config, dict)
            and member_config.config.get("manual_approval") is False
        ):
            healed = dict(member_config.config)
            healed.pop("manual_approval", None)
            member_config.config = healed or None
            self._session.add(member_config)
            log.info(
                "group_shadow_manual_approval_healed",
                group_id=str(group_id),
                member_id=str(member_id),
                session_id=str(member.shadow_session_id),
            )

        if payload.display_name is not None:
            name = _validate_display_name(payload.display_name)
            if name != member.display_name:
                # P1 修复：查重含已移除行（DB 唯一约束全量生效，UPDATE 同样
                # 撞约束）；排除改名成员自身行（其余 active/removed 行全算占用）。
                active_names, removed_names = await self._member_name_occupancy(
                    group.id, exclude_member_id=member.id
                )
                _ensure_display_name_available(
                    name, active_names=active_names, removed_names=removed_names
                )
                member.display_name = name

        snapshot_dirty = False
        if member.member_type == "agent":
            if payload.runtime_id is not None and payload.runtime_id != member.runtime_id:
                if await self._session.get(DaemonRuntime, payload.runtime_id) is None:
                    raise GroupChatInvalid(
                        "agent 成员绑定的机器不存在，请检查六要素配置。",
                        details={"runtime_id": str(payload.runtime_id)},
                    )
                member.runtime_id = payload.runtime_id
                snapshot_dirty = True
            if payload.workspace_id is not None and payload.workspace_id != member.workspace_id:
                # quick 群 PPM 项目化：cwd 工作区切换须落在项目关联工作区集内
                # （存量群 project_id NULL 回退原逻辑不校验）。
                await self._ensure_member_workspace_in_project(group, payload.workspace_id)
                member.workspace_id = payload.workspace_id
                snapshot_dirty = True
            if payload.provider is not None and payload.provider != member.provider:
                member.provider = payload.provider
                snapshot_dirty = True
            if (
                payload.llm_provider_id is not None
                and payload.llm_provider_id != member.llm_provider_id
            ):
                if await self._session.get(LlmProvider, payload.llm_provider_id) is None:
                    raise GroupChatInvalid(
                        "agent 成员绑定的模型（LLM 供应商）不存在。",
                        details={"llm_provider_id": str(payload.llm_provider_id)},
                    )
                member.llm_provider_id = payload.llm_provider_id
                snapshot_dirty = True
            if (
                payload.agent_profile_id is not None
                and payload.agent_profile_id != member.agent_profile_id
            ):
                if await self._session.get(AgentProfile, payload.agent_profile_id) is None:
                    raise GroupChatInvalid(
                        "agent 成员绑定的智能体方案不存在。",
                        details={"agent_profile_id": str(payload.agent_profile_id)},
                    )
                member.agent_profile_id = payload.agent_profile_id
                snapshot_dirty = True
            # 团队能力开关（quick 群成员团队能力）：None=不改。最终态引擎门控
            # （daemon 主控 5 工具仅 provider=claude 注入，建群/加成员同口径；
            # 覆盖「开 team + 同 PATCH 切 codex」与「已开 team 只切引擎」组合）。
            if payload.team_enabled is not None and payload.team_enabled != member.team_enabled:
                member.team_enabled = payload.team_enabled
            if member.team_enabled and (member.provider or "claude") != "claude":
                raise GroupChatInvalid(
                    f"成员「{member.display_name}」的团队能力仅支持 Claude 引擎，"
                    "请改用 Claude 引擎或先关闭团队能力。",
                    details={
                        "member_id": str(member.id),
                        "provider": member.provider,
                    },
                )
            if snapshot_dirty:
                member.config_snapshot = await _rebuild_config_snapshot(self._session, member)

        self._session.add(member)
        await self._session.commit()
        await self._session.refresh(member)

        # ── task-04（design §4.5 / §8 member.config.switched）：六要素热切换──
        # 成员表已提交（六要素真相源）；影子存在时按 diff 分组执行 daemon 侧。
        # 子链内部的 rollback 会 expire 会话对象——先取标量，分支后重取行。
        group_id_val = group.id
        if member.member_type == "agent" and member.shadow_session_id is not None:
            machine_changed = (
                old_config["runtime_id"] != member.runtime_id
                or old_config["workspace_id"] != member.workspace_id
                # 团队能力开关变更归机器组重建分支（quick 群成员团队能力）：
                # stage 随 lease 建时定，复用轮改不掉——必须 end 影子 + pending
                # 下次触发按新开关重懒建（UI 已有重建重置记忆确认语义）。
                or old_config["team_enabled"] != member.team_enabled
            )
            model_changed = (
                old_config["provider"] != member.provider
                or old_config["llm_provider_id"] != member.llm_provider_id
                or old_config["agent_profile_id"] != member.agent_profile_id
            )
            if machine_changed:
                # 机器/工作区切换：end 旧影子 + pending + 指针置空——下次被 @ 按
                # 新六要素懒重建（记忆重置，接口层已提示确认）。
                await self._end_member_shadow(
                    member,
                    owner_user_id=group.created_by,
                    reason="member_reconfigured",
                )
                member = await self._get_member(group_id_val, member_id)
                member.shadow_status = "pending"
                member.shadow_session_id = None
                self._session.add(member)
                await self._session.commit()
                await self._session.refresh(member)
            elif model_changed:
                await self._hot_switch_shadow_config(member, old_config=old_config)

        # 热切换子链（rollback）可能 expire 群/成员行——重取后再收口（防
        # expired 属性 lazy IO 炸 MissingGreenlet）。
        member = await self._get_member(group_id_val, member_id)
        group = await self._get_group(group_id_val)
        # task-06（§5.3 audience）：昵称/六要素变更 → 成员 chips 快照刷新。
        await self._publish_group_sessions_changed(group, "status_changed")
        return GroupMemberRead.model_validate(member)

    async def _hot_switch_shadow_config(
        self,
        member: AgentGroupMember,
        *,
        old_config: dict,
    ) -> bool:
        """模型组六要素热切换（design §4.5：下轮边界生效，独立记忆延续）。

        步骤与顺序（顺序敏感——切换轮靠新旧值 diff 判定，先同步列会让 diff
        消失变成空 prompt 拒绝）：

        1. 经 ``inject_session_as_service`` 服务身份下发**静默切换轮**（空
           prompt + 实际变更维度）：``_inject_into_session`` 的 config_switch
           分支刷新影子 ``agent_profile_id``/``llm_provider_id`` 两列 + 快照 +
           SESSION_SWITCH_CONFIG（daemon 当前轮结束边界 reload，下一轮生效；
           忙轮则排队条目携带切换参数，turn 终态派发时同样走切换分支）。SDK
           resume id 不变，独立记忆延续；
        2. 引擎列（``provider``）inject 分支不覆盖——切换轮后手动补同步；
        3. 纯引擎 diff（profile/llm 未变）无原生切换维度可注入：仅同步三列
           （daemon driver 无法会话中热换引擎，效果落在下次影子重建/快照）。

        失败语义：切换轮失败（供应商归属/引擎不匹配/daemon 离线）记 warning
        后**兜底同步三列**——成员表是六要素真相源，下次触发按新列快照执行，
        PATCH 不因 daemon 侧失败回滚。子链内部 rollback 会 expire 会话对象
        （工厂 expire_on_commit=False，仅 rollback 过期）——所需标量先取局部。
        """
        shadow_id = member.shadow_session_id
        target_provider = member.provider
        target_llm_id = member.llm_provider_id
        target_profile_id = member.agent_profile_id
        shadow = await self._session.get(AgentSession, shadow_id)
        if shadow is None or shadow.status in ("ended", "failed"):
            return False

        # 仅把**实际变更**的维度传给切换分支（等值传入=不构成切换，空 prompt
        # 会被守卫拒；None→"" 语义=清空回本机默认/无人格）。
        switch_profile: str | None = None
        if old_config["agent_profile_id"] != target_profile_id:
            switch_profile = str(target_profile_id) if target_profile_id is not None else ""
        switch_llm: str | None = None
        if old_config["llm_provider_id"] != target_llm_id:
            switch_llm = str(target_llm_id) if target_llm_id is not None else ""

        if switch_profile is None and switch_llm is None:
            shadow.provider = target_provider or shadow.provider
            shadow.llm_provider_id = target_llm_id
            shadow.agent_profile_id = target_profile_id
            self._session.add(shadow)
            await self._session.commit()
            log.info(
                "group_member_switch_engine_only_columns_synced",
                member_id=str(member.id),
                shadow_session_id=str(shadow_id),
                provider=shadow.provider,
            )
            return True

        try:
            await SessionService(self._session).inject_session_as_service(
                shadow.id,
                prompt="",
                agent_profile_id=switch_profile,
                llm_provider_id=switch_llm,
                queue_when_busy=True,
            )
        except AppError as exc:
            log.warning(
                "group_member_switch_dispatch_failed",
                member_id=str(member.id),
                shadow_session_id=str(shadow_id),
                code=exc.code,
            )
            switched = False
        else:
            switched = True

        # 切换轮（成功与否）后补齐三列：成功路径 profile/llm 已由切换分支刷新，
        # 引擎列恒需手动；失败路径全列兜底同步（真相源跟随，rollforward）。
        fresh_shadow = await self._session.get(AgentSession, shadow_id)
        if fresh_shadow is not None and fresh_shadow.status not in ("ended", "failed"):
            fresh_shadow.provider = target_provider or fresh_shadow.provider
            fresh_shadow.llm_provider_id = target_llm_id
            fresh_shadow.agent_profile_id = target_profile_id
            self._session.add(fresh_shadow)
            await self._session.commit()
        return switched

    async def remove_member(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
    ) -> None:
        """移除成员（群主/workspace admin，design §8 group.member.removed）。

        用户成员：removed_at 置位（群主本人不可移除——解散才是退出路径）；
        agent 成员：额外 end 影子会话 + 影子队列 pending 行删除 +
        shadow_status='none'。群内系统提示行由 task-03 消息管线补（本卡无
        群消息端点）。
        """
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无需移除成员。",
                details={"group_id": str(group.id)},
            )
        member = await self._get_member(group.id, member_id)
        if member.member_type == "user" and member.user_id == group.created_by:
            raise GroupChatInvalid(
                "群主不能被移除；如需结束群聊请使用解散操作。",
                details={"group_id": str(group.id)},
            )
        if member.member_type == "agent":
            await self._end_member_shadow(
                member, owner_user_id=group.created_by, reason="member_removed"
            )
            # _end_member_shadow 已 commit；重新取行防 expire 后丢状态。
            member = await self._get_member(group.id, member_id)
            member.shadow_status = "none"  # design §8 group.member.removed
        member.removed_at = datetime.now(UTC)
        self._session.add(member)
        await self._session.commit()
        # task-06（§5.3 audience）：移除后广播（受众=剩余成员；被移除者不再
        # 命中 audience，其列表刷新信号自然停发）。
        await self._publish_group_sessions_changed(group, "status_changed")

    async def reset_member_memory(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
    ) -> GroupMemberRead:
        """重置 agent 成员记忆（design §6.1：end 影子置 pending，下次触发懒重建）。

        本卡影子会话尚不存在：实现为幂等置位（shadow_status='pending' +
        shadow_session_id 置 NULL）；已有影子时先走 end 影子链再置位
        （task-03 懒建消费本语义）。
        """
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        member = await self._get_member(group.id, member_id)
        if member.member_type != "agent":
            raise GroupChatInvalid(
                "仅 agent 成员支持重置记忆。",
                details={"member_id": str(member.id)},
            )
        await self._end_member_shadow(member, owner_user_id=group.created_by, reason="memory_reset")
        member = await self._get_member(group.id, member_id)
        member.shadow_status = "pending"
        member.shadow_session_id = None
        self._session.add(member)
        await self._session.commit()
        await self._session.refresh(member)
        return GroupMemberRead.model_validate(member)

    # ── 群消息与 @触发管线（task-03，design §4.1-4.3 / §8）──────────────────

    async def send_group_message(
        self,
        group_id: uuid.UUID,
        user: User,
        content: str,
        attachment_ids: list[uuid.UUID] | None = None,
        reply_to_log_id: uuid.UUID | None = None,
    ) -> GroupMessageSendRead:
        """发群消息（design §4.1 步 1-6 / §8 group.message.sent；FR-05 补遗附件）。

        成员校验 → 附件校验（发送者归属 + 数量，照单聊管线口径）→ 载体 run +
        user_input 原文落库（metadata 带附件摘要；附件行绑定群会话防 48h 草稿
        清理）→ 群频道 log 事件（sender 身份 + 附件摘要）→ @解析 → 逐命中
        agent 成员触发（懒建/注入/排队见 ``_trigger_group_member``）。未 @ 消息
        仅落时间线（进后续群背景摘要），不触发任何成员；附件随触发成员注入
        下发（D-7 看图说话：附件非空豁免空 content）。

        引用回复（群 P2 第二波）：``reply_to_log_id`` 校验属本群时间线
        （``_get_timeline_row``，跨群/不存在 404）后落 ``reply_to`` 快照进
        user_input metadata 与群频道 log 事件 payload（同结构：
        ``{log_id, member_name, content_head}``）——回放侧走 logs DTO metadata
        透出，前端据此高亮「回复的是哪句话」。

        失败语义（quick 群 P2 部分失败收集）：载体 run 与触发是两个事务——消息
        先落时间线；**逐成员触发失败（机器未授权 / 队列满 / 会话闸满 / 成员引擎
        不支持附件等 AppError）不再整条抛**：该成员 ``triggered`` 项带 ``error``
        中文摘要 + 群频道系统行「成员「X」触发失败：{原因}」，其余成员照常触发
        （响应恒 200，前端按 ``error`` 非空提示「消息已发送，部分成员触发失败」）。
        """
        group = await self._get_group(group_id)
        membership = await self._require_group_member(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法发送消息。",
                details={"group_id": str(group.id)},
            )
        if not (content or "").strip() and not attachment_ids:
            raise GroupChatInvalid("消息内容不能为空。", details={"reason": "empty_prompt"})
        # admin 兜底放行无成员行——昵称回落用户显示名。
        sender_member_name = (
            membership.display_name if membership is not None else _user_display_name(user)
        )

        # ── 引用回复校验（先于落库：跨群/不存在的 log 整条 404，不产生半截消息）。
        reply_to_snapshot: dict[str, str] | None = None
        if reply_to_log_id is not None:
            reply_row, reply_member_name = await self._get_timeline_row(group, reply_to_log_id)
            reply_to_snapshot = {
                "log_id": str(reply_row.id),
                "member_name": reply_member_name,
                "content_head": (reply_row.content_redacted or "").strip()[
                    :GROUP_LAST_MESSAGE_PREVIEW_CHARS
                ],
            }

        # ── 附件校验（发送侧：归属按发送者 + 数量；引擎门控下沉到逐成员触发）
        #    口径照单聊 _validate_inject_attachment_rows 的归属/数量段，错误族
        #    用群 GroupChatInvalid（400，中文文案）。
        attachment_rows: list = []
        if attachment_ids:
            attachment_rows = await self._validate_group_attachments(user.id, attachment_ids)

        members = await self._list_active_member_rows(group.id)

        # ── 载体 run + user_input 原文（§4.1 步 2；design §2「纯载体无执行
        #    语义」——status='completed' 满足 AgentRunLog.run_id NOT NULL FK 的
        #    承载，started_at 落值供时间线排序/审计）。
        now = datetime.now(UTC)
        carrier = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider=GROUP_SESSION_PROVIDER,
            status="completed",
            started_at=now,
            finished_at=now,
            spec_strategy=GROUP_CARRIER_SPEC_STRATEGY,
            agent_session_id=group.session_id,
            user_id=user.id,  # 发送者归属（回放身份回退源）
        )
        self._session.add(carrier)
        await self._session.flush()
        # 发送者身份（§5.2）+ 附件摘要（FR-05 补遗：回放行/前端附件条数据源）。
        user_input_metadata: dict[str, object] = {
            "sender_user_id": str(user.id),
            "sender_member_name": sender_member_name,
        }
        if reply_to_snapshot is not None:
            user_input_metadata["reply_to"] = reply_to_snapshot
        attachment_summary: list[dict[str, object]] = []
        if attachment_rows:
            # 物化：附件行绑定群载体会话（draft→bound）——群附件被多成员/时间线
            # 共享不绑单一影子；session_id 非 NULL 即免 48h 草稿清理（cleanup.py
            # 只删 session_id IS NULL 行），与单聊 inject 回填同一前进方向。
            for att_row in attachment_rows:
                if att_row.session_id is None:
                    att_row.session_id = group.session_id
                    self._session.add(att_row)
            attachment_summary = _attachment_summary_rows(attachment_rows)
            user_input_metadata["attachments"] = attachment_summary
        log_row = AgentRunLog(
            id=uuid.uuid4(),
            run_id=carrier.id,
            channel="user_input",
            content_redacted=content[:5000],  # 沿用 user_input 既有截断口径
            timestamp=now,
            metadata_=user_input_metadata,
        )
        self._session.add(log_row)
        # 未读位点（群 P2 第二波）：发送即已读——发送者位点推进到本条消息时间戳
        # （ts > 位点判定下自己这条不计未读；admin 兜底无成员行则无位点可置）。
        if membership is not None:
            membership.last_read_at = now
            self._session.add(membership)
        await self._session.commit()

        # ── 群频道 log 事件（§4.1 步 3；payload 形态照 run_sync session channel
        #    log 事件扩展 sender 字段，前端 SessionStreamEnvelope 消费；附件
        #    摘要与 metadata 同形态（FR-05 补遗）。
        log_payload: dict[str, object] = {
            "event": "log",
            "session_id": str(group.session_id),
            "run_id": str(carrier.id),
            "log_id": str(log_row.id),
            "channel": "user_input",
            "content": content,
            "timestamp": now.isoformat(),
            "sender_user_id": str(user.id),
            "sender_member_name": sender_member_name,
        }
        if attachment_summary:
            log_payload["attachments"] = attachment_summary
        if reply_to_snapshot is not None:
            log_payload["reply_to"] = reply_to_snapshot
        await _publish_group_channel_event(group.session_id, log_payload)

        # ── @解析 + 触发编排（§4.1 步 4-6）。
        mentioned = _parse_group_mentions(content, members)
        mentioned_ids = [m.id for m in mentioned]
        # 返回体用标量（PK 不过期；并行触发子链 rollback 已隔离在各自独立
        # session，不再触碰请求 session 的对象状态——防御性口径保留）。
        carrier_run_id_val = carrier.id
        log_row_id_val = log_row.id
        triggered: list[GroupMemberTriggerRead] = []
        if mentioned:
            member_lines = [
                f"{m.display_name}({'用户' if m.member_type == 'user' else 'Agent'})"
                for m in members
            ]
            # task-04（design §4.4）：用户 @ 直接触发的成员入协作链（链 id=本
            # 载体 run；深度 0；后续互@沿用原链去重/判深）——best-effort，Redis
            # 抖动不阻断发送（互@侧 fail-closed 自兜底）。链 TTL quick 群 P1
            # 群级可配（与互@侧刷新同源，默认模块常量）。
            _, _, chain_ttl_seconds = _group_guardrail_settings(group)
            try:
                redis = get_redis()
                await redis.ping()  # type: ignore[misc]  # redis-py stubs union 返回
                await _register_chain_members(
                    redis,
                    carrier.id,
                    [m.id for m in mentioned],
                    ttl_seconds=chain_ttl_seconds,
                )
            except Exception:
                log.warning(
                    "group_chain_register_unavailable",
                    carrier_run_id=str(carrier.id),
                    exc_info=True,
                )
            # ── 并行触发（群 P2 第二波，模块 docstring「@全体并行触发」段）：每
            #    成员一协程，协程内经 ``get_session_factory()`` 开**独立短
            #    session**（单请求 AsyncSession 不可并发使用，照
            #    ``dispatch_next_queued_message`` 的独立 session 工厂模式）重取
            #    group/member/members/附件行后调同一 ``_trigger_group_member``
            #    （单成员触发路径零变化）。懒建 + readiness wait 在各协程内并行
            #    等待（总耗时 = max 而非 sum）；触发子链的 rollback 发生在各自
            #    独立 session——不再 expire 请求 session 内对象（原预取标量/失败
            #    后重取行的刷新链随之移除，仅保留返回体标量预取的防御口径）。
            group_id_val = group.id
            group_session_id_val = group.session_id
            sender_user_id_val = user.id
            attachment_ids_val = [r.id for r in attachment_rows] if attachment_rows else None
            targets = sorted(mentioned, key=lambda m: (m.joined_at, m.id))
            results = await asyncio.gather(
                *(
                    self._trigger_member_isolated(
                        group_id=group_id_val,
                        member_id=member.id,
                        member_lines=member_lines,
                        sender_user_id=sender_user_id_val,
                        sender_member_name=sender_member_name,
                        content=content,
                        carrier_run_id=carrier_run_id_val,
                        exclude_log_id=log_row_id_val,
                        attachment_ids=attachment_ids_val,
                    )
                    for member in targets
                ),
                return_exceptions=True,
            )
            # gather 保序：results 与 targets 按成员序（joined_at）一一对应。
            for member, result in zip(targets, results, strict=True):
                if isinstance(result, BaseException):
                    # quick 群 P2 部分失败收集：单成员触发失败（引擎门控 400 /
                    # 机器不可用 / 队列满 / 会话闸满等 AppError）不整条抛——该
                    # 成员 triggered 项带 error 摘要 + 群频道系统行（用户可感
                    # 沉默场景：消息已落时间线但成员没跑起来）；非 AppError 的
                    # 意外异常照旧 fail-loud 整条抛（含 CancelledError）。
                    if not isinstance(result, AppError):
                        raise result
                    reason = _trigger_failure_reason(result)
                    log.warning(
                        "group_member_trigger_failed",
                        group_id=str(group_id_val),
                        member_id=str(member.id),
                        code=result.code,
                        reason=reason,
                    )
                    await _publish_trigger_failed_notice(
                        group_session_id_val, member_name=member.display_name, reason=reason
                    )
                    triggered.append(
                        GroupMemberTriggerRead(
                            member_id=member.id,
                            member_name=member.display_name,
                            shadow_session_id=member.shadow_session_id,
                            error=reason,
                        )
                    )
                    continue
                triggered.append(result)
                # task-06（design §5.4）：影子 run 开始（即时注入/懒建首轮，非
                # 排队）→ 自动发一条 agent typing（「昵称」正在输入…）。排队轮
                # run 尚未开始不发（typing 指示器语义=正在生成回复）。
                # 运行态可见 quick（2026-09-02）：payload 补 member_id + 回复
                # 锚点 reply_to_log_id=本轮触发消息的群时间线 user_input 行 id
                # （载体 run 下的 log_row，前端据此高亮「正在响应哪句话」）。
                # 并行化后按成员序在 gather 收口统一补发（成员间触发已并行，
                # typing 事件相对 run 开始最多延迟到最慢成员返回，纯增益信号
                # 容忍）。
                if not result.queued:
                    await _publish_agent_typing_event(
                        group_id_val,
                        member.display_name,
                        member_id=str(member.id),
                        reply_to_log_id=str(log_row_id_val),
                    )
        return GroupMessageSendRead(
            carrier_run_id=carrier_run_id_val,
            log_id=log_row_id_val,
            mentioned_member_ids=mentioned_ids,
            mention_all=_has_broadcast_mention(content),
            triggered=triggered,
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
        """单成员触发的独立 session 协程体（群 P2 第二波并行编排）。

        ``send_group_message`` 的 gather 每成员调一次本方法：协程内经
        ``get_session_factory()`` 开独立短 session（对齐 ``dispatch_next_
        queued_message`` 后台派发模式——请求级 AsyncSession 不可并发使用），
        在本 session 内**重取** group / member / members / 附件行（跨 session
        共享 ORM 实例不安全：``_ensure_shadow_session`` 要 ``add(member)``
        回填指针，实例必须归属本 session）后调 ``_trigger_group_member``。

        附件行按 id 重走 ``_validate_group_attachments``（归属=发送者，发送侧
        已过同一校验——幂等重查，只多两条 SELECT/成员）。session 随 async with
        收口归还连接池；``_trigger_group_member`` 内部各事务边界（懒建 commit /
        注入 commit / 失败 rollback）自持。
        """
        from app.core.db import get_session_factory

        async with get_session_factory()() as db:
            svc = GroupChatService(db)
            group = await svc._get_group(group_id)
            member = await svc._get_member(group_id, member_id)
            members = await svc._list_active_member_rows(group_id)
            attachment_rows = None
            if attachment_ids:
                attachment_rows = await svc._validate_group_attachments(
                    sender_user_id, attachment_ids
                )
            return await svc._trigger_group_member(
                group=group,
                member=member,
                members=members,
                member_lines=member_lines,
                sender_user_id=sender_user_id,
                sender_member_name=sender_member_name,
                content=content,
                carrier_run_id=carrier_run_id,
                exclude_log_id=exclude_log_id,
                attachment_rows=attachment_rows,
            )

    async def _validate_group_attachments(
        self, sender_user_id: uuid.UUID, attachment_ids: list[uuid.UUID]
    ) -> list:
        """群消息附件校验（归属/数量，口径照单聊 ``_validate_inject_attachment_rows``）。

        与单聊差异：①引擎门控不在发送侧——群成员引擎各异，门控下沉到逐成员
        触发时判定（``_trigger_group_member``，非 Claude 成员 → 400 群错误族）；
        ②缺失/跨用户归一 400 GroupChatInvalid（群链路错误族语义；单聊是 404
        资源隐藏——群侧消息整体拒绝即可，无逐会话资源语义）。保序同单聊。
        """
        from app.modules.session_attachment.model import SessionAttachment
        from app.modules.session_attachment.service import (
            MAX_FILES_PER_MESSAGE,
            MAX_IMAGES_PER_MESSAGE,
        )

        rows = (
            (
                await self._session.execute(
                    select(SessionAttachment).where(
                        SessionAttachment.id.in_(attachment_ids),
                        SessionAttachment.user_id == sender_user_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        if len(rows) != len(set(attachment_ids)):
            raise GroupChatInvalid(
                "部分附件不存在或无权访问。",
                details={"reason": "attachment_not_found"},
            )
        image_n = sum(1 for r in rows if r.kind == "image")
        file_n = sum(1 for r in rows if r.kind == "file")
        if (
            image_n > MAX_IMAGES_PER_MESSAGE
            or file_n > MAX_FILES_PER_MESSAGE
            or (image_n + file_n) != len(rows)
        ):
            raise GroupChatInvalid(
                f"附件数量超限（图片≤{MAX_IMAGES_PER_MESSAGE}、"
                f"文件≤{MAX_FILES_PER_MESSAGE}）或类型非法。",
                details={"image_count": image_n, "file_count": file_n},
            )
        # 保留入参顺序（摘要行/注入 payload 按用户勾选顺序稳定）。
        by_id = {r.id: r for r in rows}
        return [by_id[i] for i in dict.fromkeys(attachment_ids) if i in by_id]

    async def send_direct_message(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
        content: str,
        attachment_ids: list[uuid.UUID] | None = None,
    ) -> GroupDirectMessageRead:
        """群主对成员影子会话直聊（quick 2026-09-02 影子直聊+选择性回群投影）。

        语义：对影子会话的一次**纯会话注入**（非群消息）——不走群 @ 触发链：
        零群频道 log 事件、零 @ 解析、零群背景简报（``_build_group_prompt``
        不适用），直聊内容只落影子会话时间线；agent 回复中的 ``[[GROUP]]``
        段经 run_sync 桥接投影层选择性发群（本方法只负责标记说明进 prompt）。

        - 权限：``_require_group_member``（非成员 404 不泄露存在性）→
          ``_require_group_owner``（成员可见但**写=群主/workspace admin**，
          照 management 端点 owner 门）；
        - 影子未建 → 400（先在群内 @ 成员触发懒建；直聊不承担建会话职责）；
        - 载体 run：照群消息同款空载体（spec_strategy='group_carrier'）但
          **零日志行**——群时间线/背景摘要对直聊轮零可见；轮 metadata
          ``source="shadow_direct"`` + ``source_carrier_run_id``=本载体
          （投影过滤判定锚 + [[GROUP]] 段投影行挂点）；
        - 注入：复用 inject 通道同群消息忙轮策略——``busy_strategy="inject"``
          中途注入活跃轮（直聊也应尽快可见），409 竞态降级排队兜底；
        - 附件：同群消息口径（发送者归属 + Claude 引擎门控 + D-7 空内容豁免）。
        """
        group = await self._get_group(group_id)
        membership = await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法发送直聊消息。",
                details={"group_id": str(group.id)},
            )
        member = await self._get_member(group.id, member_id)
        if member.member_type != "agent":
            raise GroupChatInvalid(
                "仅 agent 成员支持独立会话直聊。",
                details={"member_id": str(member.id)},
            )
        if not (content or "").strip() and not attachment_ids:
            raise GroupChatInvalid("消息内容不能为空。", details={"reason": "empty_prompt"})
        if member.shadow_session_id is None:
            raise GroupChatInvalid(
                f"成员「{member.display_name}」的独立会话尚未创建，"
                "请先在群内 @ 该成员完成一次触发后再直聊。",
                details={"member_id": str(member.id)},
            )
        shadow = await self._session.get(AgentSession, member.shadow_session_id)
        if shadow is None or shadow.status in ("ended", "failed"):
            raise GroupChatInvalid(
                f"成员「{member.display_name}」的独立会话当前不可用，请先在群内重新 @ 该成员触发。",
                details={"member_id": str(member.id)},
            )

        attachment_rows: list = []
        if attachment_ids:
            attachment_rows = await self._validate_group_attachments(user.id, attachment_ids)
            # 引擎门控（同 _trigger_group_member 口径：仅 Claude 支持附件）。
            if (member.provider or "claude") != "claude":
                raise GroupChatInvalid(
                    f"成员「{member.display_name}」的引擎不支持附件"
                    "（仅 Claude 支持多模态与文件注入）。",
                    details={"member_id": str(member.id), "provider": member.provider},
                )

        # admin 兜底放行无成员行——昵称回落用户显示名（同 send_group_message）。
        sender_member_name = (
            membership.display_name if membership is not None else _user_display_name(user)
        )

        # ── 直聊载体 run（空载体：不落 user_input 行——直聊内容不进群时间线；
        #    [[GROUP]] 转发段投影行在 run_sync 桥接层挂本 run）。
        now = datetime.now(UTC)
        carrier = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider=GROUP_SESSION_PROVIDER,
            status="completed",
            started_at=now,
            finished_at=now,
            spec_strategy=GROUP_CARRIER_SPEC_STRATEGY,
            agent_session_id=group.session_id,
            user_id=user.id,  # 直聊发起者归属（回放身份回退源）
        )
        self._session.add(carrier)
        await self._session.commit()

        # prompt：直聊头（可见性语义 + [[GROUP]] 标记说明）+ 用户内容（+附件行）。
        prompt = _SHADOW_DIRECT_HEADER.format(
            group_title=group.title, member_name=member.display_name
        )
        if (content or "").strip():
            prompt = f"{prompt}\n{content}"
        if attachment_rows:
            prompt += "\n\n[当前消息附件 · 用户随消息发送，可直接读取参考]\n" + "\n".join(
                _attachment_prompt_lines(attachment_rows)
            )

        # 本轮 user_input metadata（投影过滤判定锚）：source="shadow_direct" +
        # 直聊载体 run + 发送者。排队兜底轮经 _prepend_group_chain_marker 的
        # source 段透传（session/service.py），派发后判定不回退成全投影。
        turn_metadata: dict[str, object] = {
            "source": SHADOW_DIRECT_SOURCE,
            "source_group_id": str(group.id),
            "source_member_id": str(member.id),
            "source_carrier_run_id": str(carrier.id),
            "sender_user_id": str(user.id),
            "sender_member_name": sender_member_name,
            # quick-6966fcee 注入分离展示（同群 @ 轮语义）。
            "user_message": content,
        }

        # 忙轮中途注入同群消息（busy_strategy="inject"：直聊也应尽快可见；
        # 409 竞态降级回排队，消息不丢）。
        active_run = await self._get_shadow_active_run(shadow.id)
        inject_prompt = prompt
        if active_run is not None:
            inject_prompt = f"{_MID_TURN_NOTICE}\n{prompt}"
        try:
            result = await SessionService(self._session).inject_session_as_service(
                shadow.id,
                prompt=inject_prompt,
                busy_strategy="inject",
                queue_when_busy=True,
                queue_sender_user_id=user.id,
                turn_metadata=turn_metadata,
                attachment_ids=[r.id for r in attachment_rows] if attachment_rows else None,
                attachment_owner_user_id=user.id if attachment_rows else None,
            )
        except DaemonSessionTurnConflict:
            result = await SessionService(self._session).inject_session_as_service(
                shadow.id,
                prompt=inject_prompt,
                queue_when_busy=True,
                queue_sender_user_id=user.id,
                turn_metadata=turn_metadata,
                attachment_ids=[r.id for r in attachment_rows] if attachment_rows else None,
                attachment_owner_user_id=user.id if attachment_rows else None,
            )
        return GroupDirectMessageRead(
            shadow_session_id=shadow.id,
            run_id=result.agent_run.id if result.agent_run is not None else None,
            queued=result.queued,
            mid_turn=result.mid_turn,
            carrier_run_id=carrier.id,
        )

    async def interrupt_member(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
    ) -> GroupMemberInterruptRead:
        """群内打断成员当前运行任务（quick 群 P1，design §8 member.interrupted）。

        失控 agent 人人可停——权限刻意宽于群主专属操作：**任意群成员**可打断
        （``_require_group_member`` 即可，无 owner 门；群主/workspace admin 天然
        含在成员判定内），这是打断功能的存在意义。

        - 目标仅 agent 成员（用户成员无运行任务，400）；影子未建 / 无活跃
          run → 409「该成员当前没有运行中的任务」；
        - 打断执行**零改动复用**单聊 interrupt 服务路径
          （``SessionService.interrupt_session``）——服务身份传群主 user_id
          （影子属主恒为群主，§9.2；照 ``_end_member_shadow`` 传 owner 先例，
          普通成员无需是影子会话属主）；run 状态不预置，daemon 侧打断结果
          驱动收口（单聊 FR-04 语义原样）；
        - 成功后群频道发 ``channel='system'`` 系统行（照限频提示
          ``_publish_rate_limit_notice`` 先例，ephemeral 不落库）。
        """
        group = await self._get_group(group_id)
        membership = await self._require_group_member(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法打断成员任务。",
                details={"group_id": str(group.id)},
            )
        member = await self._get_member(group.id, member_id)
        if member.member_type != "agent":
            raise GroupChatInvalid(
                "仅 agent 成员支持打断任务。",
                details={"member_id": str(member.id)},
            )
        if member.shadow_session_id is None:
            raise GroupMemberNoActiveRun(
                "该成员当前没有运行中的任务。",
                details={"group_id": str(group.id), "member_id": str(member.id)},
            )
        active_run = await self._get_shadow_active_run(member.shadow_session_id)
        if active_run is None:
            raise GroupMemberNoActiveRun(
                "该成员当前没有运行中的任务。",
                details={"group_id": str(group.id), "member_id": str(member.id)},
            )

        # 打断者昵称（admin 兜底放行无成员行 → 回落用户显示名，同 send_direct_message）。
        interrupter_name = (
            membership.display_name if membership is not None else _user_display_name(user)
        )

        # 单聊 interrupt 服务路径零改动（user_id=群主=影子属主，服务身份先例）。
        result = await SessionService(self._session).interrupt_session(
            member.shadow_session_id,
            group.created_by,
        )

        await _publish_member_interrupted_notice(
            group, member_name=member.display_name, interrupter_name=interrupter_name
        )
        return GroupMemberInterruptRead(
            member_id=member.id,
            display_name=member.display_name,
            run_id=result.current_run_id or active_run.id,
            interrupted_by_name=interrupter_name,
        )

    # ── 置顶消息（quick 群 P2，2026-09-02：settings_json.pinned）──────────────

    async def _get_timeline_row(
        self, group: AgentGroupChat, log_id: uuid.UUID
    ) -> tuple[AgentRunLog, str]:
        """查群时间线消息行（须属本群时间线）+ 身份快照标签（置顶/引用回复共用）。

        行源同 ``_load_group_context_lines``：``user_input`` 行（用户消息）与
        投影行（``channel='stdout'`` 且带成员身份 metadata）都命中；身份标签
        从 metadata 取（用户行 ``sender_member_name`` / 投影行 ``member_name``），
        缺失回退 run.user_id 查成员表 display_name →「成员」（与背景摘要同款
        兜底链）。跨群 log / 不存在 → 404 ``GroupMessageNotFound``。

        群 P2 第二波起两个消费方：``pin_message``（置顶快照）与
        ``send_group_message``（``reply_to_log_id`` 引用回复快照）——校验口径
        单源，勿在调用方另查。
        """
        row = (
            await self._session.execute(
                select(AgentRunLog, AgentRun.user_id)
                .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
                .where(
                    AgentRunLog.id == log_id,
                    AgentRun.agent_session_id == group.session_id,
                )
            )
        ).first()
        if row is None:
            raise GroupMessageNotFound(
                "消息不存在或不属于该群。",
                details={"group_id": str(group.id), "log_id": str(log_id)},
            )
        log_row, run_user_id = row[0], row[1]
        meta = log_row.metadata_ or {}
        member_name = (
            meta.get("sender_member_name")
            if log_row.channel == "user_input"
            else meta.get("member_name")
        )
        if not member_name and run_user_id is not None:
            members = await self._list_members(group.id)
            member_name = next(
                (
                    m.display_name
                    for m in members
                    if m.member_type == "user" and m.user_id == run_user_id
                ),
                None,
            )
        return log_row, member_name or "成员"

    async def pin_message(
        self,
        group_id: uuid.UUID,
        user: User,
        log_id: uuid.UUID,
    ) -> GroupChatPinnedRead:
        """置顶一条群消息（quick 群 P2：群主/admin；一次一条，新置顶覆盖旧的）。

        快照落 ``settings_json.pinned``（复用 settings_json 零迁移）——内容截
        ``GROUP_PINNED_PREVIEW_CHARS``、身份快照取置顶时点值（发送者后续改名
        不影响）；置顶成功群频道发系统行（ephemeral，照打断提示先例）。
        """
        group = await self._get_group(group_id)
        membership = await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法置顶消息。",
                details={"group_id": str(group.id)},
            )
        log_row, member_name = await self._get_timeline_row(group, log_id)
        pinned = GroupChatPinnedRead(
            log_id=log_row.id,
            pinned_by=user.id,
            pinned_at=datetime.now(UTC),
            content=(log_row.content_redacted or "").strip()[:GROUP_PINNED_PREVIEW_CHARS],
            member_name=member_name,
        )
        settings = dict(group.settings_json or {})
        settings["pinned"] = pinned.model_dump(mode="json")
        group.settings_json = settings
        self._session.add(group)
        await self._session.commit()
        await self._session.refresh(group)

        operator_name = (
            membership.display_name if membership is not None else _user_display_name(user)
        )
        await _publish_group_channel_event(
            group.session_id,
            {
                "event": "log",
                "session_id": str(group.session_id),
                "channel": "system",
                "content": f"{operator_name} 置顶了一条消息",
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )
        return pinned

    async def unpin_message(self, group_id: uuid.UUID, user: User) -> None:
        """取消置顶（quick 群 P2：群主/admin；无置顶时幂等 204）。

        系统行仅在确有置顶被取消时发（幂等重放不重复提示）。
        """
        group = await self._get_group(group_id)
        membership = await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法操作置顶消息。",
                details={"group_id": str(group.id)},
            )
        if (group.settings_json or {}).get("pinned") is None:
            return  # 幂等：无置顶直接收口（不发系统行）。
        settings = dict(group.settings_json or {})
        settings.pop("pinned", None)
        group.settings_json = settings
        self._session.add(group)
        await self._session.commit()

        operator_name = (
            membership.display_name if membership is not None else _user_display_name(user)
        )
        await _publish_group_channel_event(
            group.session_id,
            {
                "event": "log",
                "session_id": str(group.session_id),
                "channel": "system",
                "content": f"{operator_name} 取消了置顶消息",
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

    async def mark_group_read(self, group_id: uuid.UUID, user: User) -> None:
        """标记群已读至此（群 P2 第二波未读位点；``PUT /{group_id}/read``）。

        成员校验（非成员 404 不泄露存在性）后服务端直接置 ``now()``——无 body
        无客户端时间戳（时钟信任单一源=服务端）。已解散群照常可标记（成员仍
        可读历史，位点语义不变）。admin 兜底放行无成员行 → 幂等收口（无位点
        可置，未读视角恒 0 不受影响）。幂等：重复 PUT 只是位点前移，无系统行
        无群频道事件（纯位点写，无副作用广播）。
        """
        group = await self._get_group(group_id)
        membership = await self._require_group_member(group, user)
        if membership is None:
            return
        membership.last_read_at = datetime.now(UTC)
        self._session.add(membership)
        await self._session.commit()

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
        """触发单个 agent 成员（design §4.1 步 6 / §8 member.injected）。

        prompt 先组装（即时注入与忙轮注入/排队共用同一文本——排队快照按入队
        时刻冻结，design §9.7）；随后影子懒建（首次）或复用注入（quick
        2026-09-02 忙轮策略翻转：查到活跃 run → prompt 头部包中途标注行 +
        ``inject_session_as_service`` busy_strategy="inject" 直接注入当前
        活跃轮；409 竞态降级回既有 ``queue_when_busy`` 排队分支，满 5 → 409
        DaemonSessionQueueFull）。

        ``sender_user_id``：触发方用户 id——用户 @ 路径=实际发送者，互@路径
        （task-04）=群主（服务身份，§9.2 计量归属）；``source_member_name``/
        ``chain_depth`` 为互@协作参数（链沿用原载体 run、深度 +1）。

        ``attachment_rows``（FR-05 补遗）：用户随消息发送的已校验附件行——
        prompt 末尾附提示行 + SESSION_INJECT attachments 通道下发（多模态块
        内联/磁盘落盘，与单聊同管线）；互@路径不携带（agent 消息无附件）。
        非 Claude 成员引擎 → 400（单聊引擎门控 D-6 同口径，群错误族）。
        """
        # 引擎门控（单聊 D-6 同口径：仅 Claude 支持附件）——发送侧已过归属/
        # 数量校验并落时间线，此处 fail-loud 拒绝触发（消息保留可重发仅触发）。
        attachment_lines: list[str] = []
        if attachment_rows:
            if (member.provider or "claude") != "claude":
                raise GroupChatInvalid(
                    f"成员「{member.display_name}」的引擎不支持附件"
                    "（仅 Claude 支持多模态与文件注入）。",
                    details={"member_id": str(member.id), "provider": member.provider},
                )
            attachment_lines = _attachment_prompt_lines(attachment_rows)

        context_lines = await _load_group_context_lines(
            self._session,
            group_session_id=group.session_id,
            context_window=group.context_window,
            members=members,
            exclude_log_id=exclude_log_id,
        )
        prompt = _build_group_prompt(
            group=group,
            member=member,
            member_lines=member_lines,
            context_lines=context_lines,
            sender_member_name=sender_member_name,
            content=content,
            source_member_name=source_member_name,
            attachment_lines=attachment_lines,
        )
        # 群链路 metadata（§4.3 注入 / §4.4 链 id 透传）：写本轮 user_input 日志
        # metadata_ 列——task-04 turn_completed 互@检测读取（排队派发的透传
        # 见 dispatch_next_queued_message 侧 task-04 接线）。
        turn_metadata = {
            "source_group_id": str(group.id),
            "source_member_id": str(member.id),
            "source_carrier_run_id": str(carrier_run_id),
            "chain_depth": chain_depth,
            "sender_user_id": str(sender_user_id),
            # quick-6966fcee 注入分离展示：真实用户消息原文（不含成员简报/群
            # 背景/回应要求等注入上下文）——影子会话与群时间线的用户气泡优先
            # 显示本字段，完整注入文本折叠为「已注入上下文」可展开。
            "user_message": content,
        }
        if source_member_name is not None:
            # 互@轮：来源是 Agent 成员（无 user 行）——记成员身份供审计/展示。
            turn_metadata["sender_member_name"] = source_member_name
            turn_metadata["sender_member_kind"] = "agent"

        shadow, first_run_id = await self._ensure_shadow_session(
            group,
            member,
            first_prompt=prompt,
            first_turn_metadata=turn_metadata,
            attachment_rows=attachment_rows,
        )
        if first_run_id is not None:
            # 首次触发：懒建事务内已落首轮 run + SESSION_INJECT（附件 payload 在
            # _ensure_shadow_session 内组装下发——见 _send_shadow_first_inject）。
            return GroupMemberTriggerRead(
                member_id=member.id,
                member_name=member.display_name,
                shadow_session_id=shadow.id,
                run_id=first_run_id,
                queued=False,
            )

        # quick（2026-09-02 群聊忙轮注入 steering）：复用轮忙轮策略翻转——
        # 查活跃 run：命中 → prompt 头部插一行中途标注（在 _build_group_prompt
        # 产物外层包，不动其纯函数），消息经 busy_strategy="inject" 直接注入
        # 当前活跃轮（不再等轮终态派发排队条目——实测排队延迟=轮时长，用户
        # 中途指令轮结束才被看到）；409 竞态（注入瞬间轮刚好终态）由调用点
        # 捕获 DaemonSessionTurnConflict 降级回既有排队兜底。
        active_run = await self._get_shadow_active_run(shadow.id)
        inject_prompt = prompt
        if active_run is not None:
            inject_prompt = f"{_MID_TURN_NOTICE}\n{prompt}"

        # 复用轮：注入共享核心（run user_id=影子属主=群主，§9.2；忙轮 → 中途
        # 注入活跃 run，竞态 409 → 排队兜底，entry.sender_user_id=实际发送者）。
        # 附件透传：attachment_ids + 归属基准覆盖=发送者（影子属主是群主，附件
        # 上传者是发送者——按属主校验会误拒；排队派发侧从链标记 sender_user_id
        # 同口径推导）。
        try:
            result = await SessionService(self._session).inject_session_as_service(
                shadow.id,
                prompt=inject_prompt,
                busy_strategy="inject",
                queue_when_busy=True,
                queue_sender_user_id=sender_user_id,
                turn_metadata=turn_metadata,
                attachment_ids=[r.id for r in attachment_rows] if attachment_rows else None,
                attachment_owner_user_id=sender_user_id if attachment_rows else None,
            )
        except DaemonSessionTurnConflict:
            # 409 竞态兜底：注入瞬间轮刚好终态（或降级排队场景）→ 走既有落队
            # 分支（满 5 → 409 DaemonSessionQueueFull），消息不丢。
            result = await SessionService(self._session).inject_session_as_service(
                shadow.id,
                prompt=inject_prompt,
                queue_when_busy=True,
                queue_sender_user_id=sender_user_id,
                turn_metadata=turn_metadata,
                attachment_ids=[r.id for r in attachment_rows] if attachment_rows else None,
                attachment_owner_user_id=sender_user_id if attachment_rows else None,
            )
        return GroupMemberTriggerRead(
            member_id=member.id,
            member_name=member.display_name,
            shadow_session_id=shadow.id,
            run_id=result.agent_run.id if result.agent_run is not None else None,
            queued=result.queued,
            mid_turn=result.mid_turn,
        )

    async def _get_shadow_active_run(self, shadow_session_id: uuid.UUID) -> AgentRun | None:
        """查影子会话当前活跃轮（quick 2026-09-02 忙轮注入判定）。

        谓词与 SessionService._get_current_run 同源（ACTIVE_RUN_STATUSES 单一
        词表 import，勿内联状态元组）；锁外查询仅作中途标注的判定基准——
        真正的忙轮判定在 inject 行锁内（竞态最坏=标注有无与实际路径错位一行
        文案，消息不丢）。
        """
        stmt = select(AgentRun).where(
            AgentRun.agent_session_id == shadow_session_id,
            AgentRun.status.in_(list(ACTIVE_RUN_STATUSES)),
        )
        return (await self._session.execute(stmt)).scalars().first()

    async def _ensure_shadow_session(
        self,
        group: AgentGroupChat,
        member: AgentGroupMember,
        *,
        first_prompt: str,
        first_turn_metadata: dict,
        attachment_rows: list | None = None,
    ) -> tuple[AgentSession, uuid.UUID | None]:
        """影子会话懒建（design §4.3 / §8 shadow.created，照 worker 三件套）。

        返回 ``(影子会话, 首轮 run id)``——**首轮 run id 非 None 表示本次为
        懒建**（首轮 run + lease + SESSION_INJECT 已在事务内完成）；None 表示
        复用既有影子（调用方走 inject 排队/注入路径）。

        三件套（``_dispatch_worker_core`` mcp_tools.py 先例）：

        1. 直接 ORM 建行（不走 create_session——审批开关生效位在
           ``AgentSession.config`` 列，permission_service 按其门控；影子
           ``manual_approval=False``，§9.1 审批不进群）；
        2. ``prepare_interactive_dispatch``（flush-only）：pinned_runtime_id=
           成员机器、cwd=成员工作区根、stage='group_member'（``team_enabled``
           成员用 'orchestrator'——daemon 主控谓词据此注入团队 5 工具，见下方
           派发段注释）；**机器授权走
           grants 分支**（``skip_owner_check=False`` + ``workspace_id=群工作区``
           ——属主命中或 workspace grant 授权才放行；**不照抄 worker 的
           ``skip_owner_check=True``**，D-010：群成员机器是群主任意选择的，
           无授权 → 400 fail-loud 零残留）；
        3. 回填成员表 ``shadow_session_id`` / ``shadow_status='active'``。

        首轮下发照 ``create_session`` 尾段：lease metadata prompt 作 daemon 建
        会话兜底 + readiness 后 SESSION_INJECT 控制指令发完整组装 prompt
        （daemon inject() 清 pendingFirstPrompt，无双重轮次——create_session
        P0 修复注释口径）。``parent_session_id`` 恒 NULL（D-007/§5.1）。
        """
        # 幂等复用：指针非空且影子非终态 → 直接复用（懒建只在首次触发发生）。
        # quick 群 P1（2026-09-02 并发双建修复）：幂等判定前先以行锁重读成员行
        # （SELECT ... FOR UPDATE，照 auth/service.py refresh-token 并发先例；
        # SQLite 忽略锁提示、语义不变）——并发触发同一成员时，第二个事务在
        # 成员行上等锁，首个事务 commit（回填指针）后读到已回填指针直接复用，
        # 不再双建影子。populate_existing 强制刷新 identity map 内既有对象——
        # 不带则查询命中缓存旧快照，调用方传入的 member 指针仍是 NULL。锁在
        # 调用方事务内持有至 commit，不新增 commit。
        locked_member = (
            await self._session.execute(
                select(AgentGroupMember)
                .where(AgentGroupMember.id == member.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if locked_member is not None:
            member = locked_member
        if member.shadow_session_id is not None:
            existing = await self._session.get(AgentSession, member.shadow_session_id)
            if existing is not None and existing.status not in ("ended", "failed"):
                return existing, None
            # 指针悬挂（reset-memory 后重建 / 派发失败残留）→ 走下方新建，
            # 旧行留史，成员指针更新到新影子。

        from app.modules.agent.placement import (
            NoOnlineDaemonError,
            RunPlacementService,
        )

        if member.runtime_id is None:
            raise GroupChatInvalid(
                f"成员「{member.display_name}」缺少机器配置，无法触发。",
                details={"member_id": str(member.id)},
            )
        provider = member.provider or "claude"

        # cwd = 成员工作区根（六要素②；缺省建群时已落群工作区）。
        cwd: str | None = None
        if member.workspace_id is not None:
            from app.modules.workspace.model import Workspace
            from app.modules.workspace.service import resolve_root_path_for_daemon

            member_ws = await self._session.get(Workspace, member.workspace_id)
            if member_ws is not None and member_ws.root_path:
                cwd = resolve_root_path_for_daemon(member_ws.root_path)

        # 档案行（快照 + lease 提示词维度下推用；缺省 None 零分支）。
        profile = None
        if member.agent_profile_id is not None:
            from app.modules.agent.profile.model import AgentProfile

            profile = await self._session.get(AgentProfile, member.agent_profile_id)

        now = datetime.now(UTC)
        # ① 影子会话行（parent 恒 NULL——群↔影子唯一关联通道是成员表反向指针）。
        shadow = AgentSession(
            id=uuid.uuid4(),
            user_id=group.created_by,  # 计量归属=群主（§9.2；影子 user_id 同源）
            runtime_id=None,  # 派发后回填（dispatch.runtime_id==钉定机器）
            lease_id=None,  # 同上
            provider=provider,
            status="pending",  # 事务内随 lease 回填激活为 active
            # quick-6966fcee：不再设 manual_approval=False——影子会话已挂完整
            # SessionPanel（群主可作答 AskUserQuestion/权限请求），放开后 agent
            # 遇需拍板问题可正常弹对话框（此前 False 会把 ask 类工具调用拒掉，
            # agent 卡住干等）。群 @ 触发轮的请求出现在影子面板，群主点开作答。
            turn_count=0,
            created_at=now,
            workspace_id=member.workspace_id,
            title=f"群「{group.title}」·{member.display_name}",
            session_kind="group_member",
            parent_session_id=None,  # D-007：恒 NULL（§5.1 硬约束）
            agent_profile_id=member.agent_profile_id,
            llm_provider_id=member.llm_provider_id,
        )
        self._session.add(shadow)
        await self._session.flush()

        # 首轮 run（interactive 驱动；挂影子会话、user_id=群主）——lease
        # metadata.run_id 必须指向真实 run（daemon claim/上报按 run 对账，
        # 假 id 会让 daemon 上报打到不存在的 run 上）。
        from app.modules.agent.service import _build_agent_profile_snapshot

        first_run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider=provider,
            status="pending",
            spec_strategy="interactive",
            agent_session_id=shadow.id,
            user_id=group.created_by,
            agent_profile_id=member.agent_profile_id,
            agent_profile_snapshot=(
                _build_agent_profile_snapshot(profile) if profile is not None else None
            ),
            llm_provider_id=member.llm_provider_id,
        )
        self._session.add(first_run)
        await self._session.flush()
        # 首轮 user_input 日志：完整组装 prompt（与排队快照同口径）+ 群链路
        # metadata（含发送者——run.user_id 是群主，真实发送者只在此处）。
        self._session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=first_run.id,
                channel="user_input",
                content_redacted=first_prompt[:5000],
                timestamp=now,
                metadata_=dict(first_turn_metadata),
            )
        )

        # ② interactive lease（flush-only；grants 授权分支见 docstring）。
        # 失败分支的 message/details 值先取局部（rollback 会 expire 会话内全部
        # 对象，过期属性访问在 greenlet 外炸 MissingGreenlet——worker 预检先例）。
        member_name = member.display_name
        member_id_str = str(member.id)
        runtime_id_str = str(member.runtime_id)
        placement = RunPlacementService(self._session)
        try:
            dispatch = await placement.prepare_interactive_dispatch(
                agent_session_id=shadow.id,
                agent_run_id=first_run.id,
                user_id=group.created_by,
                provider=provider,
                prompt=first_prompt,
                model=None,  # 模型走 llm_provider_id → lease metadata（下方）
                workspace_id=group.workspace_id,  # grants 授权作用域=群工作区
                cwd=cwd,
                pinned_runtime_id=member.runtime_id,
                pinned_skip_owner_check=False,  # D-010：不照抄 worker 豁免
                # 团队能力（quick 群成员团队能力）：开启时 stage='orchestrator'
                # 命中 daemon isMainAgentSession 谓词（cli.ts：stage==''||
                # 'orchestrator' 且 provider=claude）→ 注入 dispatch_worker 等
                # 5 主控工具；配置侧（建群/加成员/PATCH）已校验仅 Claude 可开。
                # stage 随 lease 建时定——热切换开关走 update_member 机器组
                # 重建分支（复用轮改不掉 stage）。
                stage="orchestrator" if member.team_enabled else GROUP_MEMBER_STAGE,
            )
        except NoOnlineDaemonError as exc:
            # 无授权/离线/掉线 → 400 fail-loud，事务回滚零残留（不建孤儿影子）。
            await self._session.rollback()
            raise GroupChatInvalid(
                f"成员「{member_name}」的机器当前不可用或未授权，无法触发。",
                details={
                    "member_id": member_id_str,
                    "runtime_id": runtime_id_str,
                    "reason": str(exc),
                },
            ) from exc

        # 档案提示词维度 / 会话级供应商下推（照 create_session :1867-1914）。
        if profile is not None:
            from app.modules.agent.service import AgentService

            await AgentService(self._session).apply_session_profile_to_lease(
                dispatch.lease_id, profile
            )
        if member.llm_provider_id is not None:
            from app.modules.daemon.session.service import _merge_lease_metadata

            await _merge_lease_metadata(
                self._session,
                dispatch.lease_id,
                {"session_llm_provider_id": str(member.llm_provider_id)},
            )

        # ③ 回填 + 激活 + 成员表指针（单 commit 收口三元组）。
        shadow.runtime_id = dispatch.runtime_id
        shadow.lease_id = dispatch.lease_id
        shadow.status = "active"
        self._session.add(shadow)
        member.shadow_session_id = shadow.id
        member.shadow_status = "active"
        self._session.add(member)
        await self._session.commit()

        # 唤醒 daemon（lease pending 等 daemon 轮询自领取；不可达仅告警——
        # worker 路径同口径，lease 不作废）。
        delivered = await placement.notify_interactive_dispatch(dispatch)
        shadow_id = shadow.id
        if not delivered:
            # WS 完全不可达：收口影子终态（照 create_session 失败收敛语义），
            # 成员置 failed——下次触发按重建路径重试（上方幂等分支放行重建）。
            log.warning(
                "group_shadow_dispatch_wake_failed",
                group_id=str(group.id),
                member_id=str(member.id),
                shadow_session_id=str(shadow_id),
            )
            try:
                fresh_shadow = await self._session.get(AgentSession, shadow_id)
                fresh_run = await self._session.get(AgentRun, first_run.id)
                fresh_member = await self._session.get(AgentGroupMember, member.id)
                if fresh_shadow is not None:
                    fresh_shadow.status = "failed"
                    fresh_shadow.ended_at = datetime.now(UTC)
                    self._session.add(fresh_shadow)
                if fresh_run is not None:
                    fresh_run.status = "failed"
                    fresh_run.finished_at = datetime.now(UTC)
                    fresh_run.error_code = "no_online_daemon"
                    self._session.add(fresh_run)
                if fresh_member is not None:
                    fresh_member.shadow_status = "failed"
                    self._session.add(fresh_member)
                await self._session.commit()
            except Exception:
                await self._session.rollback()
                log.warning(
                    "group_shadow_failed_convergence_error", shadow_session_id=str(shadow_id)
                )
            from app.modules.daemon.session.service import DaemonRuntimeOffline

            raise DaemonRuntimeOffline(
                f"成员「{member.display_name}」的执行机器当前不在线，本轮未能触发；"
                "消息已进群时间线，请稍后重试。",
                details={
                    "runtime_id": str(dispatch.runtime_id),
                    "session_id": str(shadow_id),
                    "member_id": str(member.id),
                },
            )

        # 首轮 SESSION_INJECT（照 create_session :2080-2127）：readiness 等待后
        # 控制指令三段式下发（WS 失败落库 pending 待补拉；lease metadata prompt
        # 为 daemon 侧兜底，不失败）。FR-05 补遗：附件 payload 组装（MinIO 读）
        # 在 commit 后进行——不进写事务（单聊 P1 预组装同理由）。
        first_inject_attachments: list[dict] = []
        if attachment_rows:
            first_inject_attachments = await self._assemble_group_inject_attachments(
                attachment_rows, member=member, owner_user_id=group.created_by
            )
        await self._send_shadow_first_inject(
            shadow_id=shadow_id,
            lease_id=dispatch.lease_id,
            run_id=first_run.id,
            prompt=first_prompt,
            claim_token=dispatch.claim_token,
            runtime_id=dispatch.runtime_id,
            inject_attachments=first_inject_attachments,
        )
        await _publish_group_channel_event(
            shadow_id,
            {"event": "turn_injected", "session_id": str(shadow_id), "run_id": str(first_run.id)},
        )
        return shadow, first_run.id

    async def _assemble_group_inject_attachments(
        self,
        rows: list,
        *,
        member: AgentGroupMember,
        owner_user_id: uuid.UUID,
    ) -> list[dict]:
        """群链路附件 → SESSION_INJECT payload attachments 列表（FR-05 补遗）。

        口径照单聊 ``_assemble_inject_attachment_payload`` + ``_resolve_inject_gate``
        （复用 session_attachment 组装/门控函数，单一实现不复制粘贴）：gate 基准
        = 影子会话维度——属主=群主（``owner_user_id``，成员供应商行的归属者）、
        会话级供应商=成员六要素 ``llm_provider_id``、引擎=成员 ``provider``。
        组装产物（deliver=block 内联/回拉、disk 落盘）与单聊 SESSION_INJECT
        attachments 同形态，daemon 侧零改动。
        """
        from app.modules.session_attachment.capability import resolve_session_gate
        from app.modules.session_attachment.service import assemble_inject_attachments
        from app.modules.session_attachment.storage import SessionAttachmentStorage
        from app.modules.storage.factory import get_storage_backend

        provider = member.provider or "claude"
        gate = await resolve_session_gate(
            self._session,
            user_id=owner_user_id,
            session_llm_provider_id=member.llm_provider_id,
            agent_kind=provider,
        )
        return await assemble_inject_attachments(
            rows,
            supports_multimodal=gate.supports_multimodal,
            storage=SessionAttachmentStorage(get_storage_backend()),
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
        """首轮 SESSION_INJECT 控制指令下发（照 ``create_session`` 尾段）。

        readiness 等待（daemon 建会话完成再注入，防 ``session_not_found`` 丢
        指令；超时 fallback 仍发——兼容不上报 ready 的旧 daemon）→ 控制指令
        三段式（落库 pending + WS 推送 + delivered 标记）：WS 失败保留 pending
        待 daemon 补拉，**不让首轮触发整体失败**（lease metadata prompt 是
        daemon 侧兜底）。函数级 import 保持 patch 面与 session/service 一致
        （测试 mock ``get_session_readiness`` 于源模块生效）。

        ``inject_attachments``（FR-05 补遗）：组装好的附件 payload 列表——
        仅非空时附加（单聊 task-06 同口径：旧 daemon 忽略未知键，协议向后
        兼容）。
        """
        from app.modules.daemon.control_commands import (
            KIND_SESSION_INJECT,
            ControlCommandService,
        )
        from app.modules.daemon.session.service import (
            _resolve_daemon_id_for_runtime,
            get_session_readiness,
        )

        ready = await get_session_readiness().wait(shadow_id, timeout=8)
        if not ready:
            log.warning("group_shadow_ready_timeout", shadow_session_id=str(shadow_id))
        daemon_id = await _resolve_daemon_id_for_runtime(self._session, runtime_id)
        if daemon_id is None:
            log.warning(
                "group_shadow_inject_no_daemon",
                shadow_session_id=str(shadow_id),
                runtime_id=str(runtime_id),
            )
            return
        inject_payload: dict[str, object] = {
            "session_id": str(shadow_id),
            "lease_id": str(lease_id),
            "run_id": str(run_id),
            "prompt": prompt,
            "claim_token": claim_token,
            "runtime_id": str(runtime_id),  # design §5.3 provider discriminator
        }
        if inject_attachments:
            inject_payload["attachments"] = inject_attachments
        _row, control_ok = await ControlCommandService(self._session).enqueue_and_push(
            daemon_id=daemon_id,
            runtime_id=runtime_id,
            kind=KIND_SESSION_INJECT,
            payload=inject_payload,
        )
        if not control_ok:
            log.warning(
                "group_shadow_inject_control_pending",
                shadow_session_id=str(shadow_id),
                run_id=str(run_id),
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
        """typing 心跳（``POST /group-chats/{id}/typing``，design §5.4 typing.ping）。

        成员校验后直接 publish（节流由前端做——250ms 间隔 + 前端 TTL 2.5s
        自动过期）；**不落库、不进 AI 上下文、不进群背景摘要**（纯 ephemeral，
        Redis pub/sub 即发即忘，无 key 无 TTL 无存储）。preview 服务端再裁
        400 字（DTO 侧已限长，双保险防超长帧）。

        quick 群 P2（2026-09-02）草稿预览默认关：群级 ``settings_json.
        typing_preview``（默认 False）关闭时入参 ``preview`` 强制丢弃（payload
        preview=None——只显示「正在输入」不发草稿，隐私从简）；显式 True 才
        透传（仍走 400 字裁剪）。
        """
        group = await self._get_group(group_id)
        membership = await self._require_group_member(group, user)
        sender_member_name = (
            membership.display_name if membership is not None else _user_display_name(user)
        )
        if not _group_typing_preview_enabled(group):
            preview = None  # 群级默认关：入参草稿丢弃（只显示「正在输入」）。
        await _publish_group_typing_event(
            group.id,
            _typing_payload(
                member_name=sender_member_name,
                member_kind="user",
                typing=typing,
                preview=preview,
            ),
        )

    async def _publish_group_sessions_changed(
        self, group: AgentGroupChat, event: SessionChangeEvent
    ) -> None:
        """群事件广播（task-06，design §5.3 audience 投影）。

        payload 内嵌全部**未移除**用户成员 id（``audience_user_ids``，订阅侧
        ``_stream_sessions_events`` 过滤「user_id 命中或 in audience」免查库）；
        ``user_id`` 位填群主（群会话属主，群事件对其恒可见）。发布失败由
        ``publish_sessions_changed`` 自吞（warning 不抛）。
        """
        rows = await self._list_active_member_rows(group.id)
        audience = [m.user_id for m in rows if m.member_type == "user" and m.user_id is not None]
        await publish_sessions_changed(
            event, group.session_id, group.created_by, audience_user_ids=audience
        )


# ── config_snapshot 组装（成员列表 chips 免 N+1，design §3.3）─────────────────


def _build_config_snapshot(
    *,
    runtime: DaemonRuntime,
    instance: DaemonInstance | None,
    provider: str,
    profile: object | None,
    llm: object | None,
) -> dict:
    """agent 成员六要素冗余快照（machine_name/engine/model/profile_name 等）。

    ``profile`` / ``llm`` 参数化 object 防循环 import（调用方就近 import 的
    AgentProfile/LlmProvider 行）；仅取 name 展示字段。
    """
    machine_name = None
    if instance is not None:
        machine_name = instance.display_alias or instance.hostname
    if machine_name is None:
        machine_name = runtime.name or None
    snapshot: dict = {
        "machine_name": machine_name,
        "engine": provider,
        "runtime_id": str(runtime.id),
    }
    if profile is not None:
        snapshot["profile_name"] = getattr(profile, "name", None)
    if llm is not None:
        snapshot["model"] = getattr(llm, "name", None)
    return snapshot


async def _rebuild_config_snapshot(db: AsyncSession, member: AgentGroupMember) -> dict:
    """六要素变更后按成员行当前值重建快照（update_member 消费）。"""
    from app.modules.agent.profile.model import AgentProfile
    from app.modules.llm_provider.model import LlmProvider

    runtime: DaemonRuntime | None = None
    instance: DaemonInstance | None = None
    if member.runtime_id is not None:
        row = (
            await db.execute(
                select(DaemonRuntime, DaemonInstance)
                .join(
                    DaemonInstance,
                    DaemonRuntime.daemon_instance_id == DaemonInstance.id,
                    isouter=True,
                )
                .where(DaemonRuntime.id == member.runtime_id)
            )
        ).first()
        if row is not None:
            runtime, instance = row[0], row[1]
    profile = (
        await db.get(AgentProfile, member.agent_profile_id)
        if member.agent_profile_id is not None
        else None
    )
    llm = (
        await db.get(LlmProvider, member.llm_provider_id)
        if member.llm_provider_id is not None
        else None
    )
    base = (member.config_snapshot or {}).copy()
    if runtime is None:
        base.pop("machine_name", None)
        base.pop("runtime_id", None)
        base["engine"] = member.provider
        return base
    fresh = _build_config_snapshot(
        runtime=runtime,
        instance=instance,
        provider=member.provider or (member.config_snapshot or {}).get("engine") or "",
        profile=profile,
        llm=llm,
    )
    # workspace 锚变更同步进快照（chips 展示「工作区」维度时免查库）。
    if member.workspace_id is not None:
        fresh["workspace_id"] = str(member.workspace_id)
    return fresh
