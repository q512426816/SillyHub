/**
 * Client-side session store.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
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
      name: "multi-agent-platform.session",
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
