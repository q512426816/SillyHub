/**
 * Client-side session store.
 *
 * 数据流边界（localStorage 即真相源，同浏览器多标签页共享）：
 *   - 本 store 的 persist 写 localStorage[SESSION_STORAGE_KEY]；
 *   - zustand persist 默认**不监听**其它标签页的写入——多标签页各自内存持有
 *     token 副本，A 页续票轮换 refresh token 后 B 页仍持旧 token，超过后端
 *     60s 复用宽限窗（auth_refresh_grace_seconds）再续票会被判重放攻击并
 *     吊销该用户全部会话（多标签页被周期性踢回登录页的根因）。故模块级注册
 *     storage 事件监听，把其它标签页写入的会话状态回放进本页内存；同秒并发
 *     续票竞态（两页同时触发刷新、事件尚未送达）由后端 grace 宽限兜底。
 *   - storage 事件只在「其它」标签页写入时触发。⚠️ 回放 setState 经 persist
 *     中间件**会**写回 localStorage（旧注释「回放不写盘、无回环」与实际行为
 *     不符）：同值回放会造成 A/B 标签互换令牌的无限乒乓（2026-10-17 生产
 *     401 风暴根因），故回放只回放与本地实际不同的字段，全等时静默返回。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  is_platform_admin?: boolean;
  permissions?: string[];
  /**
   * 头像 URL（文件中心 /api/file/{id} 或外链）；null/undefined = 未设置（首字回退）。
   * 可选字段（2026-09-10-account-avatar-upload）：旧 localStorage user 缺该字段按
   * undefined 兼容，persist version 不 bump，storage 回放只回放存在的字段不误清。
   */
  avatar?: string | null;
}

export interface SessionTokens {
  accessToken: string | null;
  refreshToken: string | null;
}

interface SessionState extends SessionTokens {
  hydrated: boolean;
  user: SessionUser | null;

  setUser: (_user: SessionUser | null) => void;
  setTokens: (_tokens: SessionTokens) => void;
  clear: () => void;

  markHydrated: () => void;
}

/** persist 落盘 key，监听器与 persist 配置共用同一源。 */
export const SESSION_STORAGE_KEY = "multi-agent-platform.session";

/**
 * user 对象的键序无关稳定键。JSON.parse 每次产出新对象引用，逐引用比较会把
 * 「内容相同的回放」误判为变化；且不同来源构造的 user 键序可能不同（fetchMe
 * 现算 vs storage 往返），必须键排序后再比较（2026-10-17-session-replay-pingpong-fix）。
 */
function sessionUserKey(user: SessionUser | null): string {
  if (user === null || typeof user !== "object") {
    return JSON.stringify(user) ?? "null";
  }
  const entries = Object.entries(user)
    .filter((pair) => pair[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

function isSameUser(a: SessionUser | null, b: SessionUser | null): boolean {
  return a === b || (a !== null && b !== null && sessionUserKey(a) === sessionUserKey(b));
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      hydrated: false,
      user: null,
      accessToken: null,
      refreshToken: null,

      setUser: (next) => set({ user: next }),
      setTokens: ({ accessToken, refreshToken }) =>
        set({ accessToken, refreshToken }),
      clear: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
        }),
      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: SESSION_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({
        hydrated: state.hydrated,
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      onRehydrateStorage: () => (state) => {
        // Zustand persist hydration is async; this makes guard logic deterministic.
        if (!state) return;
        state.markHydrated();
      },
    },
  ),
);

/** zustand persist 的落盘形状：{ state: partialized, version }。 */
interface PersistedSessionEnvelope {
  state?: Partial<Pick<SessionState, "user" | "accessToken" | "refreshToken">>;
  version?: number;
}

// SSR 安全：window 仅在客户端存在；HMR 重复注册也无害（回放是幂等 setState）。
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    // 只关心本 store 的 key；newValue === null（removeItem）无状态可回放。
    if (event.key !== SESSION_STORAGE_KEY || event.newValue === null) return;

    let remote: PersistedSessionEnvelope["state"];
    try {
      remote = (JSON.parse(event.newValue) as PersistedSessionEnvelope).state;
    } catch {
      // 坏 JSON（写入方异常/外部篡改）：忽略，本页状态不动。
      return;
    }
    if (!remote) return;

    // 乒乓环路切断（2026-10-17-session-replay-pingpong-fix）：persist 中间件对
    // 每次 setState（含回放）都会写回 localStorage，回放必然再触发对方 storage
    // 事件。若同值也回放，两标签各持不同 token 时形成 A写→B回放→B写→A回放 的
    // 无限循环，accessToken 字符串在 X↔Y 间翻转反复重触发 (dashboard)/layout 的
    // fetchMe effect，而 /api/auth/* 不走 401 自动续期，循环永不自愈（生产实证：
    // /api/auth/me 每秒 10 条 401 刷屏 11 小时）。故只回放与本地当前状态实际
    // 不同的字段，全等时静默返回（不 setState 即不写盘）。
    const current = useSession.getState();
    const patch: Partial<
      Pick<SessionState, "accessToken" | "refreshToken" | "user">
    > = {};
    if (remote.accessToken !== undefined && remote.accessToken !== current.accessToken) {
      patch.accessToken = remote.accessToken;
    }
    if (remote.refreshToken !== undefined && remote.refreshToken !== current.refreshToken) {
      patch.refreshToken = remote.refreshToken;
    }
    if (remote.user !== undefined && !isSameUser(remote.user, current.user)) {
      patch.user = remote.user;
    }
    if (
      patch.accessToken === undefined &&
      patch.refreshToken === undefined &&
      patch.user === undefined
    ) {
      return;
    }
    useSession.setState(patch);
  });
}
