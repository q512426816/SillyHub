"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { getHealth, type HealthResponse } from "@/lib/health";
import {
  listSettings,
  updateSettings,
} from "@/lib/settings";

type Tab = "workspace" | "agent" | "security" | "integrations";

const TABS: { key: Tab; label: string }[] = [
  { key: "workspace", label: "工作区信息" },
  { key: "agent", label: "智能体配置" },
  { key: "security", label: "安全策略" },
  { key: "integrations", label: "集成" },
];

const inputCls =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

/* ---------- Workspace Tab ---------- */

function WorkspaceTab({ dbStatus }: { dbStatus: HealthResponse | null }) {
  const [wsName, setWsName] = useState("");
  const [sillyspecPath, setSillyspecPath] = useState("");
  const [worktreeRoot, setWorktreeRoot] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await listSettings();
        const map = Object.fromEntries(resp.settings.map((s) => [s.key, s.value]));
        setWsName(map["workspace_name"] ?? "multi-agent-platform");
        setSillyspecPath(map["sillyspec_path"] ?? "");
        setWorktreeRoot(map["worktree_root"] ?? "");
      } catch {
        // Use defaults if API unavailable
        setWsName("multi-agent-platform");
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, string> = {};
      if (wsName) payload["workspace_name"] = wsName;
      if (sillyspecPath) payload["sillyspec_path"] = sillyspecPath;
      if (worktreeRoot) payload["worktree_root"] = worktreeRoot;
      await updateSettings(payload);
      setMessage({ ok: true, text: "保存成功" });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-md border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">基本信息</h3>
        <div className="mt-3 space-y-2.5">
          <div>
            <label className="text-[11px] text-muted-foreground">工作区名称</label>
            <input value={wsName} onChange={(e) => setWsName(e.target.value)} className={`mt-0.5 ${inputCls}`} />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">SillySpec 路径</label>
            <input value={sillyspecPath} onChange={(e) => setSillyspecPath(e.target.value)} className={`mt-0.5 ${inputCls}`} />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">Worktree 根路径</label>
            <input value={worktreeRoot} onChange={(e) => setWorktreeRoot(e.target.value)} className={`mt-0.5 ${inputCls}`} />
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : "保存设置"}
            </Button>
            {message && (
              <span className={`text-xs ${message.ok ? "text-emerald-600" : "text-destructive"}`}>
                {message.text}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-md border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">数据库</h3>
        <div className="mt-3">
          <KVRow label="类型" value="PostgreSQL 16" />
          <KVRow label="主机" value={dbStatus ? "已连接" : "—"} />
          <KVRow label="版本" value={dbStatus?.version ?? "—"} />
          <div className="flex items-center justify-between py-1.5 text-xs">
            <span className="text-muted-foreground">连接状态</span>
            <Badge variant={dbStatus?.db === "ok" ? "success" : "destructive"}>
              {dbStatus?.db === "ok" ? "已连接" : "未连接"}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentConfigTab() {
  const [defaultAgent, setDefaultAgent] = useState("claude_code");
  const [maxConcurrent, setMaxConcurrent] = useState(4);
  const [timeout, setTimeout_] = useState(30);
  const [autoCleanup, setAutoCleanup] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await listSettings();
        const map = Object.fromEntries(resp.settings.map((s) => [s.key, s.value]));
        if (map["agent_default_type"]) setDefaultAgent(map["agent_default_type"]);
        if (map["agent_max_concurrent"]) setMaxConcurrent(Number(map["agent_max_concurrent"]));
        if (map["agent_default_timeout_min"]) setTimeout_(Number(map["agent_default_timeout_min"]));
        if (map["agent_auto_cleanup"]) setAutoCleanup(map["agent_auto_cleanup"] === "true");
      } catch {
        // Use defaults
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await updateSettings({
        agent_default_type: defaultAgent,
        agent_max_concurrent: String(maxConcurrent),
        agent_default_timeout_min: String(timeout),
        agent_auto_cleanup: String(autoCleanup),
      });
      setMessage({ ok: true, text: "保存成功" });
    } catch (err) {
      setMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-md border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">智能体运行时配置</h3>
        <div className="mt-3 space-y-2.5">
          <div>
            <label className="text-[11px] text-muted-foreground">默认智能体</label>
            <select value={defaultAgent} onChange={(e) => setDefaultAgent(e.target.value)} className={`mt-0.5 w-full ${inputCls}`}>
              <option value="claude_code">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="cursor">Cursor</option>
              <option value="shell">Shell</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">最大并发智能体运行</label>
            <input type="number" min={1} value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value))} className={`mt-0.5 w-32 ${inputCls}`} />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">默认超时（分钟）</label>
            <input type="number" min={1} value={timeout} onChange={(e) => setTimeout_(Number(e.target.value))} className={`mt-0.5 w-32 ${inputCls}`} />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={autoCleanup} onChange={(e) => setAutoCleanup(e.target.checked)} className="h-3.5 w-3.5 rounded border border-input" />
            <span className="text-xs">执行完成后自动清理 Worktree</span>
          </label>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : "保存配置"}
            </Button>
            {message && (
              <span className={`text-xs ${message.ok ? "text-emerald-600" : "text-destructive"}`}>
                {message.text}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-md border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">Spec Profile 与智能体信息</h3>
        <div className="mt-3">
          <KVRow label="Profile 版本" value="0.1.0" />
          <KVRow label="默认智能体类型" value="claude_code" />
          <KVRow label="Spec 策略" value="platform-managed" />
          <KVRow label="适配器" value="ClaudeCodeAdapter" />
          <div className="flex items-center justify-between border-b py-1.5 text-xs">
            <span className="text-muted-foreground">Profile 状态</span>
            <Badge variant="success">活跃</Badge>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          以上为当前平台默认配置，后续版本支持自定义编辑。
        </p>
      </div>
    </div>
  );
}

/* ---------- Security Tab ---------- */

function SecurityTab() {
  const policies = [
    { title: "凭据加密", desc: "使用 libsodium secretbox", key: "security_credential_encryption" },
    { title: "高危操作审批", desc: "git_push_branch / create_pr 需人工审批", key: "security_high_risk_approval" },
    { title: "极端风险操作拦截", desc: "deploy / db_migration / git_merge / push_main", key: "security_extreme_risk_block" },
    { title: "日志脱敏", desc: "自动脱敏凭据和敏感信息", key: "security_log_desensitization" },
    { title: "Worktree 隔离", desc: "每 Run 独立 worktree + 临时 HOME", key: "security_worktree_isolation" },
  ];

  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await listSettings();
        const map: Record<string, boolean> = {};
        for (const s of resp.settings) {
          if (s.key.startsWith("security_")) {
            map[s.key] = s.value === "true";
          }
        }
        // Default all to enabled
        for (const p of policies) {
          if (!(p.key in map)) map[p.key] = true;
        }
        setEnabledMap(map);
      } catch {
        const map: Record<string, boolean> = {};
        for (const p of policies) map[p.key] = true;
        setEnabledMap(map);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = async (key: string) => {
    const next = !enabledMap[key];
    setToggling(key);
    try {
      await updateSettings({ [key]: String(next) });
      setEnabledMap((prev) => ({ ...prev, [key]: next }));
    } catch {
      // Revert on error
    } finally {
      setToggling(null);
    }
  };

  if (loading) return <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>;

  return (
    <div className="space-y-2">
      {policies.map((p) => (
        <div key={p.key} className="flex items-center justify-between rounded-md border bg-card px-4 py-3">
          <div>
            <p className="text-xs font-medium">{p.title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{p.desc}</p>
          </div>
          <button
            onClick={() => void handleToggle(p.key)}
            disabled={toggling === p.key}
            className="cursor-pointer"
          >
            <Badge variant={enabledMap[p.key] ? "success" : "outline"}>
              {toggling === p.key ? "…" : enabledMap[p.key] ? "已启用" : "已禁用"}
            </Badge>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ---------- Integrations Tab ---------- */

function IntegrationsTab() {
  const [integrations, setIntegrations] = useState<
    { name: string; key: string; connected: boolean }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await listSettings();
        const keys = ["integration_github", "integration_gitlab"];
        const list = keys.map((k) => {
          const s = resp.settings.find((s) => s.key === k);
          return {
            name: k.replace("integration_", "").replace(/^\w/, (c) => c.toUpperCase()),
            key: k,
            connected: s?.value === "true",
          };
        });
        setIntegrations(list);
      } catch {
        setIntegrations([
          { name: "GitHub", key: "integration_github", connected: false },
          { name: "GitLab", key: "integration_gitlab", connected: false },
        ]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleToggle = async (key: string) => {
    const current = integrations.find((i) => i.key === key);
    const next = !current?.connected;
    setToggling(key);
    try {
      await updateSettings({ [key]: String(next) });
      setIntegrations((prev) =>
        prev.map((i) => (i.key === key ? { ...i, connected: next } : i)),
      );
    } catch {
      // Revert
    } finally {
      setToggling(null);
    }
  };

  if (loading) return <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>;

  return (
    <div>
      <h3 className="mb-3 text-xs font-medium text-muted-foreground">已配置集成</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {integrations.map((ig) => (
          <div key={ig.key} className="flex items-center justify-between rounded-md border bg-card px-4 py-3">
            <div>
              <p className="text-xs font-medium">{ig.name}</p>
            </div>
            <button onClick={() => void handleToggle(ig.key)} disabled={toggling === ig.key}>
              <Badge variant={ig.connected ? "success" : "outline"}>
                {toggling === ig.key ? "切换中…" : ig.connected ? "已连接" : "未连接"}
              </Badge>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Helpers ---------- */

function KVRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/* ---------- Main Page ---------- */

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("workspace");
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getHealth();
        if (!cancelled) setHealth(data);
      } catch {
        // keep null
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header>
        <h1 className="mt-0.5">设置</h1>
        <p className="text-xs text-muted-foreground">平台配置、安全策略</p>
      </header>

      <div className="flex gap-4 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 pb-1.5 text-xs font-medium transition-colors ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "workspace" && <WorkspaceTab dbStatus={health} />}
      {tab === "agent" && <AgentConfigTab />}
      {tab === "security" && <SecurityTab />}
      {tab === "integrations" && <IntegrationsTab />}
    </div>
  );
}
