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
 *   - storage 事件只在「其它」标签页写入时触发，本页 setState 回放不会再
 *     写 localStorage，无回环。
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  is_platform_admin?: boolean;
  permissions?: string[];
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

    // 只回放存在的字段（旧形状缺字段不误清）；hydrated 是本页生命周期标记，不回放。
    useSession.setState({
      ...(remote.accessToken !== undefined ? { accessToken: remote.accessToken } : {}),
      ...(remote.refreshToken !== undefined
        ? { refreshToken: remote.refreshToken }
        : {}),
      ...(remote.user !== undefined ? { user: remote.user } : {}),
    });
  });
}
