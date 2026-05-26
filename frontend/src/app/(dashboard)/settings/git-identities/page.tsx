"use client";

import { useEffect, useState } from "react";

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

function StatusBadge({ identity }: { identity: GitIdentityRead }) {
  if (identity.revoked_at) {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
        revoked
      </span>
    );
  }
  if (identity.expires_at && new Date(identity.expires_at) < new Date()) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
        expired
      </span>
    );
  }
  return (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
      active
    </span>
  );
}

export default function GitIdentitiesPage() {
  const [identities, setIdentities] = useState<GitIdentityRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Add form state
  const [showForm, setShowForm] = useState(false);
  const [formProvider, setFormProvider] = useState("github");
  const [formUsername, setFormUsername] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formToken, setFormToken] = useState("");
  const [formRepos, setFormRepos] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Check-access state
  const [accessCheckId, setAccessCheckId] = useState("");
  const [accessRepoUrl, setAccessRepoUrl] = useState("");
  const [accessResult, setAccessResult] = useState<AccessCheckResult | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(false);

  // Revoke confirm
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);

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
      <div className="mx-auto max-w-4xl px-6 py-8">
        <p className="text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Git Identities</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {showForm ? "取消" : "添加 Identity"}
        </button>
      </header>

      {pageError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {pageError}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="space-y-3 rounded-md border bg-card p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Provider</label>
              <select
                value={formProvider}
                onChange={(e) => setFormProvider(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">类型</label>
              <input
                value="PAT"
                disabled
                className="mt-1 w-full rounded-md border bg-muted px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Git Username</label>
              <input
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                placeholder="octocat"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Git Email</label>
              <input
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                placeholder="user@example.com"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              Personal Access Token <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={formToken}
              onChange={(e) => setFormToken(e.target.value)}
              required
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              placeholder="ghp_xxxxxxxxxxxx"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              Allowed Repositories（逗号分隔，留空=全部）
            </label>
            <input
              value={formRepos}
              onChange={(e) => setFormRepos(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              placeholder="org/repo-a, org/repo-b"
            />
          </div>
          <button
            type="submit"
            disabled={submitting || !formToken}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "创建中…" : "创建"}
          </button>
        </form>
      )}

      {identities.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
          暂无 Git Identity。点击 &ldquo;添加 Identity&rdquo; 绑定凭据。
        </div>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Provider</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Username</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">类型</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Repos</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">状态</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody>
              {identities.map((id) => (
                <tr key={id.id} className="border-b last:border-0">
                  <td className="px-4 py-2">{PROVIDER_LABELS[id.provider] ?? id.provider}</td>
                  <td className="px-4 py-2">{id.git_username ?? "—"}</td>
                  <td className="px-4 py-2">{id.git_email ?? "—"}</td>
                  <td className="px-4 py-2">{id.credential_type}</td>
                  <td className="px-4 py-2">
                    {id.allowed_repositories.length > 0
                      ? id.allowed_repositories.join(", ")
                      : "全部"}
                  </td>
                  <td className="px-4 py-2"><StatusBadge identity={id} /></td>
                  <td className="px-4 py-2">
                    {!id.revoked_at && (
                      <button
                        onClick={() => setRevokeTarget(id.id)}
                        className="text-xs text-destructive hover:underline"
                      >
                        撤销
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {revokeTarget && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm">确定要撤销此 Git Identity 吗？此操作不可恢复。</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => handleRevoke(revokeTarget)}
              className="rounded-md bg-destructive px-3 py-1 text-sm font-medium text-destructive-foreground"
            >
              确认撤销
            </button>
            <button
              onClick={() => setRevokeTarget(null)}
              className="rounded-md border px-3 py-1 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <section className="rounded-md border bg-card p-4">
        <h2 className="text-sm font-semibold">测试仓库访问</h2>
        <form onSubmit={handleCheckAccess} className="mt-3 flex gap-2">
          <select
            value={accessCheckId}
            onChange={(e) => setAccessCheckId(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
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
            className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={checkingAccess || !accessCheckId || !accessRepoUrl}
            className="rounded-md bg-muted px-3 py-1.5 text-sm font-medium hover:bg-muted/80 disabled:opacity-50"
          >
            {checkingAccess ? "检测中…" : "检测"}
          </button>
        </form>
        {accessResult && (
          <div className={`mt-2 rounded-md p-2 text-sm ${accessResult.accessible ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {accessResult.accessible
              ? "可访问"
              : `不可访问${accessResult.reason ? ` (${accessResult.reason})` : ""}`}
          </div>
        )}
      </section>
    </div>
  );
}
