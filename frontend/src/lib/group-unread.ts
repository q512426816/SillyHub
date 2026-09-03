/**
 * 群聊「@我」未读记忆（群聊体验 quick，2026-09-02）。
 *
 * 纯本地 localStorage 侧记忆：群列表项 `GroupChatListItemRead.last_mention`
 * （后端 get_last_mention_previews：最近 @请求用户的摘要 {content, ts,
 * member_name}）与「本群上次打开时间」比较——mention 晚于打开时间即未读
 * （微信式：打开群即视为已读，群聊面板挂载/收到新 log 事件时推进时间戳）。
 *
 * 单源说明：session-list-panel（群行红点渲染）与 group-chat-panel（打开群
 * 写已读）共用本模块，避免 key / 比较口径两处漂移。ISO 字符串比较走
 * Date.parse（后端 ts 秒级 / 本地写入毫秒级，字典序在 `…00Z` vs `…00.5Z`
 * 边界会误序，解析比较稳）。
 *
 * ql-20260903-007（时钟域统一）：已读锚与 mention.ts **同为服务端时钟域**
 * ——面板写锚用回放日志最大 ts / 实时事件 timestamp（见 markGroupOpened），
 * 不再用客户端 now 参与判定（跨域比较会吞红点/出假红点，详见该函数注释）。
 */

/** 群「上次打开」localStorage key（先例：SESSION_TREE_EXPANSION_LS_KEY 命名风格）。 */
export function groupLastOpenKey(groupId: string): string {
  return `sillyhub-group-last-open-${groupId}`;
}

/** 读群「上次打开」ISO 时间戳（无记录/不可解析 → null = 视为从未打开）。 */
export function readGroupLastOpen(groupId: string): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(groupLastOpenKey(groupId));
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

/**
 * 写群「上次打开」时间戳（打开群即已读；实时收 log 亦推进，抑制在群内时的假未读）。
 *
 * ql-20260903-007：时间锚优先取**服务端**时间戳（回放日志最大 ts / 实时事件
 * env.timestamp）——判定方 `isGroupMentionUnread` 比较的 last_mention.ts 来自
 * 后端时钟，此前锚用 `new Date()`（客户端时钟）跨时钟域直接比：浏览器时钟快
 * Δ 秒时，落在 Δ 窗口内新到的 @（服务端 ts < 本地锚）被误判已读，红点永久
 * 吞掉。服务端锚不可得（无消息/回放失败）时不写——无消息即无 mention 可丢，
 * 保留旧锚不劣于写错域的锚。缺省回落客户端时钟仅供无服务端数据的调用方。
 */
export function markGroupOpened(groupId: string, serverIso?: string | null): void {
  if (typeof window === "undefined") return;
  const anchor =
    serverIso && !Number.isNaN(Date.parse(serverIso)) ? serverIso : new Date().toISOString();
  window.localStorage.setItem(groupLastOpenKey(groupId), anchor);
}

/**
 * 「@我」未读判定（纯函数，单测推理面）：mention 存在且晚于上次打开时间。
 * 从未打开过（无已读记忆）→ 恒未读；mention.ts 缺失/不可解析 → 不误报。
 */
export function isGroupMentionUnread(
  mention: { ts?: string; content?: string; member_name?: string } | null | undefined,
  lastOpenIso: string | null,
): boolean {
  if (!mention?.ts) return false;
  const mentionTs = Date.parse(mention.ts);
  if (Number.isNaN(mentionTs)) return false;
  if (!lastOpenIso) return true;
  const openTs = Date.parse(lastOpenIso);
  if (Number.isNaN(openTs)) return true;
  return mentionTs > openTs;
}
