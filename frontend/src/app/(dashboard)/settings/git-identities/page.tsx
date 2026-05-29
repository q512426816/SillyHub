"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  checkGitAccess,
  createGitIdentity,
  listGitIdentities,
  revokeGitIdentity,
  type AccessCheckResult,
  type GitIdentityRead,
} from "@/lib/git-identities";

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  generic: "Generic",
};

const PROVIDER_ICONS: Record<string, string> = {
  github: "🐙",
  gitlab: "🦊",
  gitea: "⚙️",
  generic: "🔐",
};

type ViewMode = "table" | "cards";

function StatusBadge({ identity }: { identity: GitIdentityRead }) {
  if (identity.revoked_at) {
    return <Badge variant="destructive">revoked</Badge>;
  }
  if (identity.expires_at && new Date(identity.expires_at) < new Date()) {
    return <Badge variant="warning">expired</Badge>;
  }
  return <Badge variant="success">active</Badge>;
}

export default function GitIdentitiesPage() {
  const [identities, setIdentities] = useState<GitIdentityRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formProvider, setFormProvider] = useState("github");
  const [formUsername, setFormUsername] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formToken, setFormToken] = useState("");
  const [formRepos, setFormRepos] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [accessCheckId, setAccessCheckId] = useState("");
  const [accessRepoUrl, setAccessRepoUrl] = useState("");
  const [accessResult, setAccessResult] = useState<AccessCheckResult | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("table");

  const load = async () => {
    try {
      const data = await listGitIdentities();
      setIdentities(data.items);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "加载失败");
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await load();
      setLoading(false);
    };
    void init();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setPageError(null);
    try {
      await createGitIdentity({
        provider: formProvider,
        credential_type: "pat",
        git_username: formUsername || undefined,
        git_email: formEmail || undefined,
        credential: formToken,
        allowed_repositories: formRepos
          ? formRepos.split(",").map((s) => s.trim())
          : undefined,
      });
      setShowForm(false);
      setFormToken("");
      setFormUsername("");
      setFormEmail("");
      setFormRepos("");
      await load();
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokeTarget(null);
    try {
      await revokeGitIdentity(id);
      await load();
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "撤销失败");
    }
  };

  const handleCheckAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setCheckingAccess(true);
    setAccessResult(null);
    try {
      const result = await checkGitAccess({
        identity_id: accessCheckId,
        repo_url: accessRepoUrl,
      });
      setAccessResult(result);
    } catch (err) {
      setPageError(err instanceof ApiError ? err.message : "检测失败");
    } finally {
      setCheckingAccess(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <p className="text-xs text-muted-foreground">加载中...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <h1>Git Identities</h1>
        <div className="flex gap-2">
          {/* View toggle */}
          <div className="flex rounded border border-input">
            <button
              className={`h-7 px-2 text-xs ${viewMode === "table" ? "bg-muted font-medium" : "bg-background"}`}
              onClick={() => setViewMode("table")}
            >
              表格
            </button>
            <button
              className={`h-7 px-2 text-xs ${viewMode === "cards" ? "bg-muted font-medium" : "bg-background"}`}
              onClick={() => setViewMode("cards")}
            >
              卡片
            </button>
          </div>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? "取消" : "+ 添加 Identity"}
          </Button>
        </div>
      </header>

      {/* Security warning banner */}
      <div className="rounded border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <span className="font-medium">安全原则：</span>一个用户一个 Git Identity，凭据加密存储（libsodium），执行时临时注入，日志脱敏。
      </div>

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="space-y-3 rounded-md border bg-card p-4">
          <h3 className="text-xs font-medium text-muted-foreground">新建 Identity</h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground">Provider</label>
              <select
                value={formProvider}
                onChange={(e) => setFormProvider(e.target.value)}
                className="mt-0.5 h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              >
                {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">类型</label>
              <input
                value="PAT"
                disabled
                className="mt-0.5 h-8 w-full rounded border border-input bg-muted px-2.5 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Git Username</label>
              <input
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                className="mt-0.5 h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
                placeholder="octocat"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Git Email</label>
              <input
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                className="mt-0.5 h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
                placeholder="user@example.com"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">
              Personal Access Token <span className="text-destructive">*</span>
            </label>
            <input
              type="password"
              value={formToken}
              onChange={(e) => setFormToken(e.target.value)}
              required
              className="mt-0.5 h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              placeholder="ghp_xxxxxxxxxxxx"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted-foreground">
              Allowed Repositories（逗号分隔，留空=全部）
            </label>
            <input
              value={formRepos}
              onChange={(e) => setFormRepos(e.target.value)}
              className="mt-0.5 h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              placeholder="org/repo-a, org/repo-b"
            />
          </div>
          <Button size="sm" type="submit" disabled={submitting || !formToken}>
            {submitting ? "创建中..." : "创建"}
          </Button>
        </form>
      )}

      {identities.length === 0 ? (
        <div className="rounded-md border py-12 text-center text-xs text-muted-foreground">
          暂无 Git Identity。点击 &ldquo;添加 Identity&rdquo; 绑定凭据。
        </div>
      ) : viewMode === "cards" ? (
        /* Card view */
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {identities.map((id) => (
            <div key={id.id} className="rounded-md border bg-card p-3">
              <div className="flex items-center gap-2">
                <span className="text-base">{PROVIDER_ICONS[id.provider] ?? "🔐"}</span>
                <span className="text-sm font-medium">{PROVIDER_LABELS[id.provider] ?? id.provider}</span>
                <StatusBadge identity={id} />
              </div>
              <div className="mt-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Username</span>
                  <span className="text-xs">{id.git_username ?? "---"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Email</span>
                  <span className="text-xs">{id.git_email ?? "---"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">凭据类型</span>
                  <span className="text-xs">{id.credential_type}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">凭据状态</span>
                  <span className="text-xs text-emerald-600">加密存储中</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">过期时间</span>
                  <span className="text-xs">
                    {id.expires_at ? new Date(id.expires_at).toLocaleDateString() : "永不过期"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">允许仓库</span>
                  <span className="max-w-[140px] truncate text-xs">
                    {id.allowed_repositories.length > 0
                      ? id.allowed_repositories.join(", ")
                      : "全部"}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex gap-2 border-t pt-2">
                <Button size="sm" variant="outline" className="text-[11px]" disabled>
                  验证权限
                </Button>
                <Button size="sm" variant="outline" className="text-[11px]" disabled>
                  更新凭据
                </Button>
                {!id.revoked_at && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[11px] text-destructive"
                    onClick={() => setRevokeTarget(id.id)}
                  >
                    撤销
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Table view (existing) */
        <section className="rounded-md border bg-card">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Username</th>
                <th>Email</th>
                <th>类型</th>
                <th>Repos</th>
                <th>状态</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {identities.map((id) => (
                <tr key={id.id}>
                  <td className="text-xs">{PROVIDER_LABELS[id.provider] ?? id.provider}</td>
                  <td className="text-xs">{id.git_username ?? "---"}</td>
                  <td className="text-xs">{id.git_email ?? "---"}</td>
                  <td className="text-xs">{id.credential_type}</td>
                  <td className="max-w-[160px] truncate text-xs">
                    {id.allowed_repositories.length > 0
                      ? id.allowed_repositories.join(", ")
                      : "全部"}
                  </td>
                  <td><StatusBadge identity={id} /></td>
                  <td className="text-right">
                    {!id.revoked_at && (
                      <button
                        onClick={() => setRevokeTarget(id.id)}
                        className="text-[11px] text-destructive hover:underline"
                      >
                        撤销
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {revokeTarget && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-3">
          <p className="text-xs">确定要撤销此 Git Identity 吗？此操作不可恢复。</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => handleRevoke(revokeTarget)}>
              确认撤销
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRevokeTarget(null)}>
              取消
            </Button>
          </div>
        </div>
      )}

      {/* Credential injection flow diagram */}
      <div className="rounded-md border bg-card p-4">
        <h3 className="text-xs font-medium text-muted-foreground">凭据注入流程</h3>
        <div className="mt-3 flex items-center justify-center gap-1">
          {[
            { label: "加密存储", bg: "bg-blue-50 text-blue-700 border-blue-200" },
            { label: "临时注入", bg: "bg-amber-50 text-amber-700 border-amber-200" },
            { label: "Agent 执行", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
            { label: "自动清理", bg: "bg-red-50 text-red-700 border-red-200" },
          ].map((step, i) => (
            <div key={step.label} className="flex items-center gap-1">
              {i > 0 && (
                <span className="text-[11px] text-muted-foreground">&rarr;</span>
              )}
              <div className={`rounded border px-3 py-1.5 text-[11px] font-medium ${step.bg}`}>
                {step.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <section className="rounded-md border bg-card p-4">
        <h3 className="text-xs font-medium">测试仓库访问</h3>
        <form onSubmit={handleCheckAccess} className="mt-2 flex gap-2">
          <select
            value={accessCheckId}
            onChange={(e) => setAccessCheckId(e.target.value)}
            className="h-7 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
          >
            <option value="">选择 Identity</option>
            {identities
              .filter((i) => !i.revoked_at)
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.git_username ?? i.id.slice(0, 8)} ({PROVIDER_LABELS[i.provider]})
                </option>
              ))}
          </select>
          <input
            value={accessRepoUrl}
            onChange={(e) => setAccessRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className="h-7 flex-1 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none"
          />
          <Button
            size="sm"
            type="submit"
            variant="outline"
            disabled={checkingAccess || !accessCheckId || !accessRepoUrl}
          >
            {checkingAccess ? "检测中..." : "检测"}
          </Button>
        </form>
        {accessResult && (
          <div
            className={`mt-2 rounded px-2.5 py-1.5 text-xs ${
              accessResult.accessible
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {accessResult.accessible
              ? "可访问"
              : `不可访问${accessResult.reason ? ` (${accessResult.reason})` : ""}`}
          </div>
        )}
      </section>
    </div>
  );
}
