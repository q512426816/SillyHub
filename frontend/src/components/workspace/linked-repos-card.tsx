"use client";

/**
 * 工作区「关联仓」维护卡（2026-10-10-workspec-maintenance task-05 / FR-06）。
 *
 * 对照原型 prototype-workspace-linked-repos.html（无类型徽标 / 成员级「我的
 * 本地路径」/ 状态列）。权限两档（后端 WORKSPACE_MEMBER_MANAGE vs READ 对齐）：
 * - canManage（owner/admin）：共享字段新增/编辑/删除 + 立即同步
 * - 成员：我的本地路径配置/清除 + 立即同步 + 查看状态
 * 样式：工作台页面规范——SectionCard 外观 + antd 控件 + brand-* 语义阶 +
 * themes.ts 单一源（双主题）；空值统一 —。
 */

import { useCallback, useEffect, useState } from "react";
import { App, Input, Modal } from "antd";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/layout";
import { ApiError } from "@/lib/api";
import {
  createLinkedRepo,
  deleteLinkedRepo,
  listLinkedRepos,
  saveMyLinkedRepoPath,
  syncLinkedReposNow,
  updateLinkedRepo,
  type LinkedRepoView,
  type LocalSnapshotView,
  fetchLocalSnapshot,
  importSelected,
} from "@/lib/linked-repos";
import { LinkedRepoFormModal } from "./linked-repos-form";

export interface LinkedReposCardProps {
  workspaceId: string;
  /** owner/admin（共享字段管理权；成员只见我的路径与同步）。 */
  canManage: boolean;
}

const LAYER_LABEL: Record<string, string> = {
  projects_yaml: "projects",
  repos_registry: "repos",
};

function layerStatusBadge(status: string): string {
  if (status === "ok") return "border-brand-200 bg-brand-50 text-brand-700";
  if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function LinkedReposCard({ workspaceId, canManage }: LinkedReposCardProps): JSX.Element {
  const { message } = App.useApp();
  const [items, setItems] = useState<LinkedRepoView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LinkedRepoView | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [snapshot, setSnapshot] = useState<LocalSnapshotView | null>(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listLinkedRepos(workspaceId));
    } catch (err) {
      setItems([]);
      setError(err instanceof ApiError ? err.message : "加载关联仓失败");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = useCallback(
    async (repo: LinkedRepoView) => {
      try {
        await deleteLinkedRepo(workspaceId, repo.id);
        message.success(`已删除关联仓「${repo.name}」`);
        await refresh();
      } catch (err) {
        message.error(err instanceof ApiError ? err.message : "删除失败");
      }
    },
    [message, refresh, workspaceId],
  );

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const outcome = await syncLinkedReposNow(workspaceId);
      if (outcome.dispatched) {
        message.success(`同步指令已下发（${outcome.repo_count} 个仓），稍后刷新查看落盘状态`);
      } else {
        message.warning(outcome.reason ?? "daemon 暂不支持，需升级");
      }
      // 回报异步落库：延迟刷一轮，用户也可手动刷新。
      setTimeout(() => void refresh(), 3000);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "同步触发失败");
    } finally {
      setSyncing(false);
    }
  }, [message, refresh, workspaceId]);

  const refreshSnapshot = useCallback(async () => {
    setSnapLoading(true);
    try {
      setSnapshot(await fetchLocalSnapshot(workspaceId));
      setSelected(new Set());
    } catch {
      setSnapshot({
        status: "daemon_offline",
        entries: [],
        platform_only_names: [],
      });
    } finally {
      setSnapLoading(false);
    }
  }, [workspaceId]);

  const handleImportSelected = useCallback(async () => {
    if (!snapshot) return;
    const targets = snapshot.entries.filter(
      (e) => e.match === "local_only" && selected.has(e.key) && (e.rel_path || e.abs_path),
    );
    if (targets.length === 0) return;
    setImporting(true);
    try {
      const results = await importSelected(
        workspaceId,
        targets.map((e) => ({ name: e.key, rel_path: e.rel_path, abs_path: e.abs_path })),
      );
      const okCount = results.filter((r) => r.result === "imported").length;
      const skipCount = results.filter((r) => r.result === "skipped").length;
      const failCount = results.filter((r) => r.result === "failed").length;
      message.success(
        `导入完成：${okCount} 成功${skipCount ? `、${skipCount} 已存在` : ""}${failCount ? `、${failCount} 失败` : ""}——已登记，可点「立即同步」落盘`,
      );
      await refresh();
      await refreshSnapshot();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }, [message, refresh, refreshSnapshot, selected, snapshot, workspaceId]);

  const handleSaveMyPath = useCallback(
    async (repo: LinkedRepoView, path: string | null) => {
      try {
        await saveMyLinkedRepoPath(workspaceId, repo.id, path);
        message.success(path ? "已保存我的本地路径" : "已清除我的本地路径");
        await refresh();
      } catch (err) {
        message.error(err instanceof ApiError ? err.message : "保存失败");
      }
    },
    [message, refresh, workspaceId],
  );

  const empty = !loading && (items?.length ?? 0) === 0;

  return (
    <SectionCard
      title="关联仓"
      bodyPadding="p-0"
      extra={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={syncing || empty}
            onClick={() => void handleSyncNow()}
          >
            {syncing ? "同步中…" : "立即同步"}
          </Button>
          {canManage ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              ＋ 新增关联仓
            </Button>
          ) : null}
        </div>
      }
    >
      <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
        本工作区关联的其它仓库（spec 规范仓 / 前后端兄弟仓等）。仓库地址为工作区共享，
        本地路径每个成员各自配置；配置后由守护进程写入 sillyspec 的
        projects 子项目登记与 local.yaml 跨仓注册表，agent 与跨仓对账可直接感知。
      </p>
      {error ? <p className="px-4 py-3 text-sm text-red-600">{error}</p> : null}
      {loading ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">加载中…</p>
      ) : empty ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          尚未登记关联仓。登记 spec 规范仓或兄弟代码仓后，agent 会话与跨仓对账将自动携带关联信息。
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {(items ?? []).map((repo) => {
            const summary = repo.sync_status_summary ?? [];
            return (
              <li key={repo.id} className="grid grid-cols-[minmax(120px,1fr)_1.4fr_1.6fr_auto] items-center gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{repo.name}</p>
                  <p className="truncate text-xs text-muted-foreground" title={repo.description ?? undefined}>
                    {repo.description || "—"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-muted-foreground" title={repo.repo_url ?? undefined}>
                    {repo.repo_url || "—"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={repo.rel_path ?? undefined}>
                    约定相对路径：{repo.rel_path || "—"}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs" title={repo.my_path ?? undefined}>
                    {repo.my_path || <span className="text-amber-600">本机路径未配置</span>}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {summary.length === 0 ? (
                      <span className="text-xs text-muted-foreground">未同步</span>
                    ) : (
                      summary.map((s) => (
                        <Badge
                          key={`${s.machine_id}-${s.layer}`}
                          variant="outline"
                          className={`text-[10px] ${layerStatusBadge(s.status)}`}
                          title={`${LAYER_LABEL[s.layer] ?? s.layer}：${s.status}${s.detail ? `（${s.detail}）` : ""} · ${new Date(s.synced_at).toLocaleString("zh-CN")}`}
                        >
                          {LAYER_LABEL[s.layer] ?? s.layer}·{s.status === "ok" ? "✓" : s.status === "failed" ? "✗" : "−"}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <MyPathButton repo={repo} onSave={(p) => void handleSaveMyPath(repo, p)} />
                  {canManage ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(repo);
                          setFormOpen(true);
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => void handleDelete(repo)}
                      >
                        删除
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <LocalEchoSection
        snapshot={snapshot}
        loading={snapLoading}
        selected={selected}
        onToggle={(key) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })
        }
        onRefresh={() => void refreshSnapshot()}
        canManage={canManage}
        importing={importing}
        onImport={() => void handleImportSelected()}
      />
      {formOpen ? (
        <LinkedRepoFormModal
          open={formOpen}
          editing={editing}
          onClose={() => setFormOpen(false)}
          onSubmit={async (input) => {
            if (editing) {
              await updateLinkedRepo(workspaceId, editing.id, input);
            } else {
              await createLinkedRepo(workspaceId, input);
            }
            await refresh();
          }}
        />
      ) : null}
    </SectionCard>
  );
}

/** 「我的本地路径」小弹窗按钮（成员级，D-007）。 */

function MyPathButton({
  repo,
  onSave,
}: {
  repo: LinkedRepoView;
  onSave: (path: string | null) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(repo.my_path ?? "");

  useEffect(() => {
    if (open) setDraft(repo.my_path ?? "");
  }, [open, repo.my_path]);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {repo.my_path ? "改路径" : "配置路径"}
      </Button>
      <Modal
        open={open}
        title={`我的本地路径 · ${repo.name}`}
        width={460}
        destroyOnHidden
        onCancel={() => setOpen(false)}
        onOk={() => {
          onSave(draft.trim() === "" ? null : draft.trim());
          setOpen(false);
        }}
        okText="保存"
        cancelText="取消"
      >
        <p className="mb-2 text-xs text-muted-foreground">
          该仓库在<b>我这台电脑</b>上的位置。仅保存给我自己，其他成员各配各的；
          留空保存即清除。平台不校验不克隆，仅作只读提示注入你认领的会话与跨仓对账。
        </p>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="C:/Users/你/works/frontend"
        />
      </Modal>
    </>
  );
}


function LocalEchoSection({
  snapshot,
  loading,
  selected,
  onToggle,
  onRefresh,
  canManage,
  importing,
  onImport,
}: {
  snapshot: LocalSnapshotView | null;
  loading: boolean;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onRefresh: () => void;
  canManage: boolean;
  importing: boolean;
  onImport: () => void;
}): JSX.Element {
  const importableCount = snapshot
    ? snapshot.entries.filter((e) => e.match === "local_only" && (e.rel_path || e.abs_path)).length
    : 0;
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">
          本机已有配置（sillyspec projects 登记 + repos 注册表；仅当前绑定机器）
          {snapshot?.fetched_at ? (
            <span className="ml-2 font-normal">
              拉取于 {new Date(snapshot.fetched_at).toLocaleString("zh-CN")}
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          {canManage && importableCount > 0 ? (
            <Button
              size="sm"
              disabled={importing || selected.size === 0}
              onClick={onImport}
            >
              {importing ? "导入中…" : `导入所选（${selected.size}/${importableCount}）`}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" disabled={loading} onClick={onRefresh}>
            {loading ? "读取中…" : "刷新本机现状"}
          </Button>
        </div>
      </div>
      {!snapshot ? (
        <p className="py-2 text-xs text-muted-foreground">
          点「刷新本机现状」读取你机器上已手工配置的 sillyspec 关联信息（不自动拉取）。
        </p>
      ) : snapshot.status === "binding_missing" ? (
        <p className="py-2 text-xs text-amber-600">请先绑定守护进程后再读取本机配置。</p>
      ) : snapshot.status === "daemon_offline" ? (
        <p className="py-2 text-xs text-amber-600">守护进程离线，无法读取本机配置。</p>
      ) : snapshot.status === "daemon_unsupported" ? (
        <p className="py-2 text-xs text-amber-600">守护进程需升级（不支持本机现状读取）。</p>
      ) : snapshot.entries.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          本机暂无相关配置
          {snapshot.projects_skipped ? `（projects 源：${snapshot.projects_skipped}）` : ""}
          {snapshot.repos_skipped ? `（repos 源：${snapshot.repos_skipped}）` : ""}
          。
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {snapshot.entries.map((e) => {
              const importable = e.match === "local_only" && (e.rel_path || e.abs_path);
              return (
                <li key={e.key} className="flex items-center gap-2 text-xs">
                  {canManage && importable ? (
                    <input
                      type="checkbox"
                      checked={selected.has(e.key)}
                      onChange={() => onToggle(e.key)}
                      className="h-3.5 w-3.5"
                      aria-label={`选择导入 ${e.key}`}
                    />
                  ) : null}
                  <span className="font-mono font-semibold">{e.key}</span>
                  {e.match === "both" ? (
                    <Badge variant="outline" className="border-brand-200 bg-brand-50 text-[10px] text-brand-700">
                      两边一致
                    </Badge>
                  ) : e.match === "local_only" ? (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
                      仅本机{importable ? "" : "（路径未知）"}
                    </Badge>
                  ) : null}
                  <span className="truncate text-muted-foreground" title={[e.rel_path, e.abs_path].filter(Boolean).join(" | ") || undefined}>
                    {[e.rel_path, e.abs_path].filter(Boolean).join(" | ") || "—"}
                    {e.state ? ` · ${e.state}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          {snapshot.platform_only_names.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              仅平台登记（{snapshot.platform_only_names.length}）：{snapshot.platform_only_names.join("、")}
              ——本机尚未落盘或已被移除。
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
