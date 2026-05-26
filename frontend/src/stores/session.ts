/**
 * Session store (placeholder).
 *
 * Real auth lands in task-04 (references/15-authentication.md). For task-01
 * we only expose the type surface so other modules can already import it.
 */
import { create } from "zustand";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

interface SessionState {
  user: SessionUser | null;
  setUser: (_user: SessionUser | null) => void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  setUser: (next) => set({ user: next }),
}));
