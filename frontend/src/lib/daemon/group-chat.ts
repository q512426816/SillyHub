/**
 * Daemon API client —— 群聊 CRUD/消息/typing 域（群流 SSE 在 ./session-sse）。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 按资源域原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

/* ---------- Group chats（2026-09-01-session-group-chat task-07 / design §6.1） ----------
 *
 * 群聊（多用户多 Agent 同会话协作）API 客户端。路由挂载偏差：design §6.1 表写
 * /api/group-chats，后端实际落地复用 daemon prefix → /api/daemon/group-chats
 * 系列（backend/app/modules/daemon/group/router.py 头注释 + openapi.json 如实
 * 记录，前端经 gen:types 消费实际路径）。错误统一由 apiFetch 抛 ApiError
 * （401 refresh + 403/404/409 业务码透传），本 client 不本地处理。
 */

/** 群读体（GET /api/daemon/group-chats/{id}；api-types 生成版，禁止手写）。 */
export type GroupChatRead = components["schemas"]["GroupChatRead"];
/**
 * 群详情读体（GET /api/daemon/group-chats/{id} 实际响应，api-types 生成版）：
 * GroupChatRead + online_member_ids + 详情版成员（GroupMemberDetailRead，多
 * ``shadow_running`` 运行态兜底字段，群聊运行态可见 quick 2026-09-02）。
 */
export type GroupChatDetailRead =
  components["schemas"]["GroupChatDetailRead"];
/** 群详情成员读体（GroupMemberRead + shadow_running 影子运行态兜底）。 */
export type GroupMemberDetailRead =
  components["schemas"]["GroupMemberDetailRead"];
/** 群列表项（GroupChatRead + online_member_ids/last_message 摘要扩展）。 */
export type GroupChatListItemRead =
  components["schemas"]["GroupChatListItemRead"];
/** POST /api/daemon/group-chats 建群体（title+workspace_id+初始成员）。 */
export type GroupChatCreate = components["schemas"]["GroupChatCreate"];
/** PATCH 改群体（群名/开关/护栏参数，逐字段局部更新）。 */
export type GroupChatUpdate = components["schemas"]["GroupChatUpdate"];
/** 成员读体（agent 成员六要素全量 + shadow_status；用户成员对应列为 null）。 */
export type GroupMemberRead = components["schemas"]["GroupMemberRead"];
/** POST 加成员体（user/agent 二选一）。 */
export type GroupMemberCreate = components["schemas"]["GroupMemberCreate"];
/** PATCH 改成员体（六要素热切换 / 改昵称，逐字段局部更新）。 */
export type GroupMemberUpdate = components["schemas"]["GroupMemberUpdate"];
/** agent 成员六要素写体（建群 / 加成员 / 改配置共用）。 */
export type GroupMemberAgentConfig =
  components["schemas"]["GroupMemberAgentConfig"];
/** 用户成员邀请写体（display_name 缺省=沿用用户显示名）。 */
export type GroupMemberUserCreate =
  components["schemas"]["GroupMemberUserCreate"];
/**
 * 建群响应体（api-types 生成版，禁止手写；quick 群 P1 llm_provider 预检）：
 * GroupChatRead + ``warnings`` 非阻断提示列表（agent 成员未指定模型走本机默认
 * LLM 出口）——仅建群/加成员响应携带，列表/详情读取路径不带。
 */
export type GroupChatCreateRead =
  components["schemas"]["GroupChatCreateRead"];
/**
 * 加成员响应体（api-types 生成版，禁止手写；quick 群 P1 llm_provider 预检）：
 * GroupMemberRead + ``warnings``（同建群体口径）。
 */
export type GroupMemberAddRead =
  components["schemas"]["GroupMemberAddRead"];
/**
 * 打断 agent 成员响应体（api-types 生成版，禁止手写；quick 群 P1）：
 * ``run_id``=被打断的活跃 run；``interrupted_by_name``=打断者群内昵称。
 */
export type GroupMemberInterruptRead =
  components["schemas"]["GroupMemberInterruptRead"];
/**
 * 置顶消息写体（api-types 生成版；quick 群 P2）：``log_id``=群时间线消息行 id
 * （user_input / 投影行均可置顶；一次一条，重复置顶覆盖旧的）。
 */
export type GroupPinnedRequest = components["schemas"]["GroupPinnedRequest"];
/**
 * 置顶消息快照读体（api-types 生成版；quick 群 P2）：群读体 ``pinned`` 字段
 * 同形（``log_id``/``pinned_by``/``pinned_at`` + 内容与发送者身份快照）。
 */
export type GroupChatPinnedRead =
  components["schemas"]["GroupChatPinnedRead"];

/** 群聊端点 base（design §6.1 前缀偏差见本节头注释）。 */
const GROUP_CHATS_BASE = "/api/daemon/group-chats";

/**
 * GET /api/daemon/group-chats — 群列表（当前用户=群成员，design §5.3：群列表
 * 走本端点而非 list_agent_sessions——后者按 user_id=请求者过滤，非群主成员
 * 不可见）。返回成员摘要 chips（members 裁剪版）+ online_member_ids +
 * last_message（workspace 过滤由调用方客户端筛选）。
 *
 * 2026-09-03-group-chat-archive-delete task-05 / design §4：archived 三态过滤参
 * ——true=仅已归档（归档视图，task-06 消费）；false=仅未归档（与 HTTP 默认
 * 同义的显式形态）；undefined=不拼参走 HTTP 默认 False（后端 Query(default=
 * False) 安全默认，桌面/移动端群分区等三个无参消费点零改动零回归）。序列化
 * 照会话侧 archived 先例（本文件 listAgentSessions：布尔→"true"/"false"）。
 *
 * **null 暂无法显式命中后端 None（不过滤全量）口径**：FastAPI 0.136.3 +
 * pydantic 2.13.4 实测 ``bool | None`` Query 无任何 query 字面量可解析为 None
 * （archived=null/none/空串均 422 bool_parsing；apiFetch query 序列化对 null
 * 值亦直接跳过不拼参——api.ts「v === null continue」），design §6.2b presence
 * 显式 null 的「id 查找不过滤」意图待后端补显式全量入口后在此改拼对应字面量；
 * 签名先按三态定型（null 与 undefined 暂同走 HTTP 默认 False，调用点届时零
 * 改动）。
 */
export async function listGroupChats(
  opts?: { archived?: boolean | null },
): Promise<GroupChatListItemRead[]> {
  if (opts?.archived !== true && opts?.archived !== false) {
    return apiFetch<GroupChatListItemRead[]>(GROUP_CHATS_BASE);
  }
  return apiFetch<GroupChatListItemRead[]>(GROUP_CHATS_BASE, {
    query: { archived: opts.archived ? "true" : "false" },
  });
}

/**
 * GET /api/daemon/group-chats/{id} — 群详情（成员完整列表含六要素 + 详情版
 * ``shadow_running`` 运行态兜底字段，群聊运行态可见 quick 2026-09-02）。
 */
export async function getGroupChat(
  groupId: string,
): Promise<GroupChatDetailRead> {
  return apiFetch<GroupChatDetailRead>(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}`,
  );
}

/**
 * POST /api/daemon/group-chats — 建群（群会话 + 群行 + 初始成员）。响应为
 * GroupChatCreateRead（quick 群 P1：多 ``warnings`` 非阻断提示——agent 成员
 * 未指定模型走本机默认 LLM 出口，调用方逐条 warning 透传展示）。
 */
export async function createGroupChat(
  payload: GroupChatCreate,
): Promise<GroupChatCreateRead> {
  return apiFetch<GroupChatCreateRead>(GROUP_CHATS_BASE, {
    method: "POST",
    json: payload,
  });
}

/** PATCH /api/daemon/group-chats/{id} — 改群名/agent 互@开关/护栏参数。 */
export async function updateGroupChat(
  groupId: string,
  payload: GroupChatUpdate,
): Promise<GroupChatRead> {
  return apiFetch<GroupChatRead>(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}`,
    { method: "PATCH", json: payload },
  );
}

/** POST /api/daemon/group-chats/{id}/end — 解散群（end 群会话+全部影子会话）。 */
export async function endGroupChat(groupId: string): Promise<GroupChatRead> {
  return apiFetch<GroupChatRead>(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/end`,
    { method: "POST" },
  );
}

/*
 * 2026-09-03-group-chat-archive-delete task-05 / design §4：群收纳三件套——
 * 归档/取消归档/删除（端点 task-03 落地，权限/幂等全在 service 层）。三端点
 * 均 204 空响应（Promise<void>，照 removeGroupMember 先例）；URL 编码与
 * { method } 形态照 endGroupChat 上方先例。
 */

/**
 * POST /api/daemon/group-chats/{id}/archive — 归档群（群主/workspace admin；
 * 幂等——已归档重复归档无操作；默认群列表隐藏、归档视图可查）。
 */
export async function archiveGroupChat(groupId: string): Promise<void> {
  await apiFetch(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/archive`,
    { method: "POST" },
  );
}

/**
 * POST /api/daemon/group-chats/{id}/unarchive — 取消归档群（群主/workspace
 * admin；幂等——未归档重复取消无操作；群回默认列表）。
 */
export async function unarchiveGroupChat(groupId: string): Promise<void> {
  await apiFetch(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/unarchive`,
    { method: "POST" },
  );
}

/**
 * DELETE /api/daemon/group-chats/{id} — 删除群=软删（群主/workspace admin；
 * 未解散群后端先 end 收口再双置位 deleted_at，行/审计保留不可再访问）。
 */
export async function deleteGroupChat(groupId: string): Promise<void> {
  await apiFetch(`${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}`, {
    method: "DELETE",
  });
}

/**
 * POST /api/daemon/group-chats/{id}/members — 加用户成员 / 配置 agent 成员。
 * 响应为 GroupMemberAddRead（quick 群 P1：agent 体多 ``warnings`` 非阻断提示，
 * 同建群体口径）。
 */
export async function addGroupMember(
  groupId: string,
  payload: GroupMemberCreate,
): Promise<GroupMemberAddRead> {
  return apiFetch<GroupMemberAddRead>(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/members`,
    { method: "POST", json: payload },
  );
}

/** PATCH /api/daemon/group-chats/{id}/members/{mid} — agent 六要素热切换/改昵称。 */
export async function updateGroupMember(
  groupId: string,
  memberId: string,
  payload: GroupMemberUpdate,
): Promise<GroupMemberRead> {
  return apiFetch<GroupMemberRead>(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
    { method: "PATCH", json: payload },
  );
}

/** DELETE /api/daemon/group-chats/{id}/members/{mid} — 移除成员（agent→end 影子会话）。 */
export async function removeGroupMember(
  groupId: string,
  memberId: string,
): Promise<void> {
  await apiFetch(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
    { method: "DELETE" },
  );
}

/** POST /api/daemon/group-chats/{id}/members/{mid}/reset-memory — 重置成员独立记忆。 */
export async function resetGroupMemberMemory(
  groupId: string,
  memberId: string,
): Promise<GroupMemberRead> {
  return apiFetch<GroupMemberRead>(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}/reset-memory`,
    { method: "POST" },
  );
}

/**
 * POST /api/daemon/group-chats/{id}/members/{mid}/interrupt — 打断 agent 成员
 * 当前运行中的任务（quick 群 P1）：**任意群成员可打断**（后端放行，前端按钮
 * 全员可见）；该成员无活跃 run 时 409（后端中文文案「该成员当前没有运行中的
 * 任务」透传 warning，不打断成功提示流）。
 */
export async function interruptGroupMember(
  groupId: string,
  memberId: string,
): Promise<GroupMemberInterruptRead> {
  return apiFetch<GroupMemberInterruptRead>(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}/interrupt`,
    { method: "POST" },
  );
}

/* ---------- 群消息置顶（quick 群 P2，2026-09-02） ----------
 *
 * PUT/DELETE /api/daemon/group-chats/{gid}/pinned：群主权限（后端强校验）。
 * 快照（内容/发送者身份/置顶者/时刻）落 ``settings_json.pinned``，群读体以
 * typed ``pinned`` 字段透出——前端置顶/取消后 invalidate 群详情 + 群列表即可。
 */

/**
 * PUT /api/daemon/group-chats/{id}/pinned — 置顶群消息（群主；一次一条，
 * 重复置顶覆盖旧的）。目标 log 须属本群时间线（跨群/不存在 404 → ApiError）。
 */
export async function pinGroupMessage(
  groupId: string,
  payload: GroupPinnedRequest,
): Promise<GroupChatPinnedRead> {
  return apiFetch<GroupChatPinnedRead>(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/pinned`,
    { method: "PUT", json: payload },
  );
}

/** DELETE /api/daemon/group-chats/{id}/pinned — 取消置顶（群主；204 无响应体）。 */
export async function unpinGroupMessage(groupId: string): Promise<void> {
  await apiFetch(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/pinned`,
    { method: "DELETE" },
  );
}

/* ---------- 群已读位点（群 P2 第二波，2026-09-02） ----------
 *
 * PUT /api/daemon/group-chats/{gid}/read（204）：推进**本成员**服务端已读位点
 * （成员表 last_read_at=now；发送消息时后端已自动顺带已读）。群列表 unread_count
 * 据此清零——前端进入群聊（面板挂载）即调本端点，随后本地乐观清零 + invalidate
 * 群列表前缀（徽标即时消失，不等重拉）。
 */

/** PUT /api/daemon/group-chats/{id}/read — 标记本成员已读（204 无响应体）。 */
export async function markGroupRead(groupId: string): Promise<void> {
  await apiFetch(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/read`,
    { method: "PUT" },
  );
}

/* ---------- 群消息发送 + typing 上报 + 群流 SSE（task-08 / FR-05 / FR-09 / FR-12 / FR-13） ----------
 *
 * design §4.1（发送→载体 run user_input 落库→@解析触发）、§5.4（typing 心跳：
 * 前端 250ms 节流 + preview ≤400 字 + TTL 2.5s，纯 ephemeral 不落库）、§5.2
 * （群频道事件经现有 /sessions/{id}/stream SSE 生成器合流 typing 帧下发）。
 */

/** POST /api/daemon/group-chats/{id}/messages 响应（task-03 已入 openapi）。 */
export type GroupMessageSendRead = components["schemas"]["GroupMessageSendRead"];
/** 消息写体（content=消息原文含 @提及；schema.py 长度 1..8000）。 */
export type GroupMessageSendRequest =
  components["schemas"]["GroupMessageSendRequest"];

/**
 * 群消息附件摘要（FR-05 补遗）：user_input 行 ``metadata.attachments`` 与群频道
 * log 事件 payload 的共用形态（backend ``_attachment_summary_rows`` 单一源）——
 * file_id/name/size/kind，供气泡下方附件条渲染（AttachmentChips 消费）。
 */
export interface GroupMessageAttachmentSummary {
  file_id: string;
  name: string;
  size: number;
  kind?: string | null;
}

/**
 * 引用回复快照（群 P2 第二波，2026-09-02）：发送带 ``reply_to_log_id`` 时后端
 * 落库进 user_input 行 ``metadata.reply_to``，并同构透传到群频道实时 log 事件
 * payload（backend ``_get_timeline_row`` 单一源）——``log_id``=被引用消息行 id、
 * ``member_name``/``content_head``(60 字)=发送者与内容摘要快照，气泡顶部引用条
 * 渲染用（回放与实时同一形态）。
 */
export interface GroupMessageReplySnapshot {
  log_id: string;
  member_name: string;
  content_head: string;
}

/**
 * POST /api/daemon/group-chats/{id}/messages — 发群消息。
 *
 * 响应携带 carrier_run_id / log_id（实时 log 事件同 id，seenLogIds 去重容错）+
 * mentioned_member_ids / triggered（触发成员与排队态）。单成员触发失败（机器
 * 未授权/离线、队列满、会话闸满、非 Claude 引擎带附件等）**不再整条抛错**
 * （quick 群 P2 部分失败收集）：消息恒 200 且已落时间线，失败成员的
 * triggered 项带 ``error`` 中文摘要（群频道同步发系统行）——调用方按
 * ``error`` 非空提示「消息已发送，部分成员触发失败」。
 *
 * FR-05 补遗：``attachmentIds`` 附件引用（上传端点产出的 SessionAttachment
 * id，D-7 豁免——携带附件时 content 可空看图说话）；未携带时不发该键（后端
 * 缺省空列表零回归）。
 *
 * 群 P2 第二波：``replyToLogId`` 引用回复目标（群时间线消息行 id，service 校验
 * 属本群时间线，跨群/不存在 404）；未引用时不发该键。
 */
export async function sendGroupMessage(
  groupId: string,
  content: string,
  attachmentIds?: string[],
  replyToLogId?: string | null,
): Promise<GroupMessageSendRead> {
  const body: GroupMessageSendRequest = { content };
  if (attachmentIds?.length) body.attachment_ids = attachmentIds;
  if (replyToLogId) body.reply_to_log_id = replyToLogId;
  return apiFetch<GroupMessageSendRead>(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/messages`,
    { method: "POST", json: body },
  );
}

/* ---------- 影子直聊（quick 影子直聊，2026-09-02） ---------- */

/** POST /group-chats/{gid}/members/{mid}/direct-message 响应（生成版 schema）。 */
export type GroupDirectMessageRead =
  components["schemas"]["GroupDirectMessageRead"];
/** 影子直聊写体（生成版 schema：content 必填 + 可选 attachment_ids）。 */
export type GroupDirectMessageRequest =
  components["schemas"]["GroupDirectMessageRequest"];

/**
 * POST /api/daemon/group-chats/{gid}/members/{mid}/direct-message — 群主对
 * agent 成员影子会话的直聊注入（quick 影子直聊，2026-09-02）。
 *
 * - 权限：群主 / workspace admin（普通成员 403）；影子未建 400——调用方按
 *   member.shadow_status 引导（本端点只在已建影子的成员卡入口出现）。
 * - 直聊语义：content 只落影子会话时间线（零群时间线 / 零 @ 解析）；agent
 *   回复的 ``[[GROUP]]...[[/GROUP]]`` 段由投影层选择性发群。
 * - 响应 queued / mid_turn 表达排队态（成员忙时入影子会话队列），run 侧经
 *   影子会话 SSE 流回放 user_input 行——调用方**不本地 append**。
 */
export async function sendGroupDirectMessage(
  groupId: string,
  memberId: string,
  payload: GroupDirectMessageRequest,
): Promise<GroupDirectMessageRead> {
  return apiFetch<GroupDirectMessageRead>(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}/direct-message`,
    { method: "POST", json: payload },
  );
}

/**
 * typing 心跳写体（POST /api/daemon/group-chats/{id}/typing，204 无响应体）。
 *
 * 2026-09-01-session-group-chat 收口：gen:types 已收录 typing 端点，手写过渡
 * 类型切换为生成版（GroupMessageSendRequest 同款惯例）——typing 布尔（默认
 * true）+ preview ≤400 字，后续写体演进经 gen:types 自动跟进。
 */
export type GroupTypingRequest = components["schemas"]["GroupTypingRequest"];

/**
 * POST /api/daemon/group-chats/{id}/typing — typing 心跳上报。
 *
 * 纯 ephemeral（Redis pub/sub 即发即忘），失败静默即可（fire-and-forget 语义
 * 由调用方决定——本函数照常抛 ApiError，调用方 catch 吞掉）。
 */
export async function sendGroupTyping(
  groupId: string,
  payload: GroupTypingRequest,
): Promise<void> {
  await apiFetch(
    `${GROUP_CHATS_BASE}/${encodeURIComponent(groupId)}/typing`,
    { method: "POST", json: payload },
  );
}
