/**
 * 登出时统一清理 localStorage 用户域键（2026-10-14-logout-localstorage-user-data-cleanup）。
 *
 * 背景（archive/2026-10-14-logout-full-reload-clear-cache review.json P3）：登出整页跳转
 * 清掉了内存缓存，但 localStorage 持久层跨登录残留——按 sessionId/groupId 索引的键
 * （会话草稿含用户输入内容、群聊草稿、视图模式、群打开锚点、活性状态、未读标记）
 * 换账号后原样留存，B 用户可见 A 用户的草稿、未读徽标错乱。
 *
 * 本文件是用户域键清单的**唯一注册表**：新增按动态资源 id 索引/承载用户内容的
 * localStorage 键时，必须把前缀登记进 USER_SCOPED_LS_PREFIXES（带尾分隔符）——
 * 登出清理自动覆盖，禁止在调用点散落键名。设备级偏好（主题/记住登录名/侧边栏
 * 折叠/输入框高度/浮球/宠物/面板宽度/新建会话默认机器等）不进注册表即保留，
 * 完整二分清单见变更 design.md。
 */
/** 用户域键前缀（全部带尾分隔符，精确到命名空间段，防同命名空间近邻键误删）。 */
export const USER_SCOPED_LS_PREFIXES: readonly string[] = [
  // 单聊会话草稿（含 __pre__ 预会话变体）— turn-state.ts sessionDraftLsKey
  "sillyhub.sessions.draft.",
  // 会话视图模式（对话/进度）— turn-state.ts viewModeLsKey
  "sillyhub.sessions.viewMode.",
  // 群聊草稿 — group-chat-panel.tsx groupDraftLsKey
  "sillyhub.groupchats.draft.",
  // 群「上次打开」锚点（未读计算基准）— lib/group-unread.ts groupLastOpenKey
  "sillyhub-group-last-open-",
  // 会话活性状态机 prevState — hooks/use-session-liveness.ts STATE_KEY_PREFIX
  "sillyhub:liveness-state:",
  // 会话未读标记 — hooks/use-session-liveness.ts UNREAD_KEY_PREFIX
  "sillyhub:liveness-unread:",
  // 会话「执行完成」通知标记 — lib/session-completed-unread.ts COMPLETED_UNREAD_KEY_PREFIX
  //（2026-10-17-audit-risk-followup：键随 fcd4a4048 落地时漏登记，换账号串显前账号角标）
  "sillyhub:session-completed-unread:",
];

/**
 * 遍历 localStorage 删除全部用户域前缀键。
 *
 * 全程 try/catch 容错：任一键删除失败（隐私模式/配额异常）不阻断登出跳转，
 * 继续清剩余键——最坏残留与改前等价，不劣化。仅操作 localStorage；session
 * persist 键由 stores/session.ts 的 clear() 负责（双份清理引入歧义，不碰）。
 */
export function clearUserScopedLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key === null) continue;
      if (USER_SCOPED_LS_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* 单键失败静默，继续清其余 */
      }
    }
  } catch {
    /* localStorage 整体不可用（如被禁用）：静默，不阻断登出 */
  }
}
