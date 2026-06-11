/**
 * Daemon runtime API client.
 */
import { apiFetch } from "@/lib/api";

export interface DaemonRuntimeRead {
  id: string;
  name: string | null;
  provider: string | null;
  version: string | null;
  status: string | null; // online, offline, maintenance
  last_heartbeat_at: string | null;
  capabilities: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export async function listDaemonRuntimes(): Promise<DaemonRuntimeRead[]> {
  return apiFetch<DaemonRuntimeRead[]>("/api/daemon/runtimes");
}

export async function getDaemonRuntime(
  runtimeId: string,
): Promise<DaemonRuntimeRead> {
  return apiFetch<DaemonRuntimeRead>(`/api/daemon/runtimes/${runtimeId}`);
}

export interface QuickChatResponse {
  id: string;
  agent_type: string;
  status: string;
}

export async function quickChat(
  prompt: string,
  provider: string,
  prevRunId?: string,
): Promise<QuickChatResponse> {
  let url = `/api/daemon-chat?prompt=${encodeURIComponent(prompt)}&provider=${encodeURIComponent(provider)}`;
  if (prevRunId) {
    url += `&prev_run_id=${encodeURIComponent(prevRunId)}`;
  }
  return apiFetch<QuickChatResponse>(url, { method: "POST" });
}

export interface QuickChatResult {
  id: string;
  status: string;
  output_redacted: string | null;
  agent_type: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export async function getQuickChatResult(
  runId: string,
): Promise<QuickChatResult> {
  return apiFetch<QuickChatResult>(`/api/daemon-chat/${runId}`);
}

/* ---------- Provider display metadata ---------- */

/** Provider display name, icon emoji, and Tailwind color classes. */
export const PROVIDER_META: Record<
  string,
  { label: string; icon: string; color: string }
> = {
  claude: { label: "Claude Code", icon: "🟣", color: "bg-purple-100 text-purple-800" },
  codex: { label: "Codex", icon: "🟢", color: "bg-green-100 text-green-800" },
  copilot: { label: "Copilot", icon: "🔵", color: "bg-blue-100 text-blue-800" },
  opencode: { label: "OpenCode", icon: "🔷", color: "bg-teal-100 text-teal-800" },
  openclaw: { label: "OpenClaw", icon: "🟠", color: "bg-orange-100 text-orange-800" },
  hermes: { label: "Hermes", icon: "🟣", color: "bg-indigo-100 text-indigo-800" },
  gemini: { label: "Gemini", icon: "💎", color: "bg-cyan-100 text-cyan-800" },
  pi: { label: "Pi", icon: "🩷", color: "bg-pink-100 text-pink-800" },
  cursor: { label: "Cursor", icon: "🟡", color: "bg-amber-100 text-amber-800" },
  kimi: { label: "Kimi", icon: "🔴", color: "bg-red-100 text-red-800" },
  kiro: { label: "Kiro", icon: "🟩", color: "bg-emerald-100 text-emerald-800" },
  antigravity: { label: "Antigravity", icon: "⚫", color: "bg-slate-100 text-slate-800" },
};

/** Frontend-known minimum version requirements (UI warning only). */
export const MIN_VERSIONS: Record<string, string> = {
  claude: "2.0.0",
  codex: "0.100.0",
  copilot: "1.0.0",
};

/**
 * Simple semver comparison.
 * Returns true when `version` is strictly less than `minVersion`.
 * Handles optional "v" prefix and non-standard suffixes (e.g. "v2.1.0-beta").
 */
export function isVersionBelow(version: string, minVersion: string): boolean {
  const parse = (v: string): number[] => {
    const stripped = v.replace(/^v/, "");
    const parts = stripped.split(".");
    const nums: number[] = [];
    for (let i = 0; i < 3; i++) {
      const segment = (parts[i] ?? "").replace(/\D.*$/, "");
      nums.push(Number.parseInt(segment, 10) || 0);
    }
    return nums;
  };
  const v = parse(version);
  const m = parse(minVersion);
  for (let i = 0; i < 3; i++) {
    if ((v[i] ?? 0) < (m[i] ?? 0)) return true;
    if ((v[i] ?? 0) > (m[i] ?? 0)) return false;
  }
  return false; // equal
}
