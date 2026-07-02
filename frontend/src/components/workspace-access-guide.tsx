"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  listDaemonRuntimes,
  PROVIDER_META,
  type DaemonRuntimeRead,
} from "@/lib/daemon";
import { errMessage } from "@/lib/errors";
import { DAEMON_RUNTIME_STATUS_LABELS, labelOf } from "@/lib/status-labels";
import { workspacePathSourceLabel } from "@/lib/workspace-path";
import {
  upsertMyBinding,
  type MemberBindingUpsertRequest,
} from "@/lib/workspace-binding";

/** 已绑定成员回填的当前值（编辑模式 initial）。 */
export interface AccessGuideInitial {
  runtime_id: string | null;
  root_path: string;
  path_source: string;
}

interface Props {
  workspaceId: string;
  onConfigured: () => void;
  /**
   * 已绑定编辑模式：传入当前 member binding 值，表单回填并切换文案为「编辑」。
   * 不传（undefined）即首次绑定模式（unbound，空值）。
   */
  initial?: AccessGuideInitial | null;
}

function providerLabel(provider: string | null): string {
  if (!provider) return "未知";
  return PROVIDER_META[provider]?.label ?? provider;
}

/** 下拉项文案：provider 中文 · runtime name · 中文状态。 */
function runtimeOptionLabel(rt: DaemonRuntimeRead): string {
  const name = rt.name?.trim() || rt.id.slice(0, 8);
  const status = labelOf(DAEMON_RUNTIME_STATUS_LABELS, rt.status);
  return `${providerLabel(rt.provider)} · ${name} · ${status}`;
}

/** online 排前；同级按 provider label 稳定排序（与 workspace-daemon-switcher 一致）。 */
function sortRuntimes(list: DaemonRuntimeRead[]): DaemonRuntimeRead[] {
  return [...list].sort((a, b) => {
    const ra = a.status === "online" ? 0 : 1;
    const rb = b.status === "online" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return providerLabel(a.provider).localeCompare(
      providerLabel(b.provider),
      "zh-CN",
    );
  });
}

/**
 * Access guide card: member configures own daemon runtime + local path.
 * Shown when the current user has no binding for this workspace (FR-001/FR-003).
 *
 * 「绑定守护进程」下拉数据源 listDaemonRuntimes()（已按当前登录用户过滤），
 * 交互沿用 workspace-daemon-switcher：online 排前、离线可选、状态中文化。
 * runtime_id 可不选（提交 null）；root_path 必填。
 */
export function WorkspaceAccessGuide({
  workspaceId,
  onConfigured,
  initial,
}: Props) {
  const [runtimeId, setRuntimeId] = useState(initial?.runtime_id ?? "");
  const [rootPath, setRootPath] = useState(initial?.root_path ?? "");
  const [pathSource, setPathSource] = useState<"server-local" | "daemon-client">(
    (initial?.path_source as "server-local" | "daemon-client") ??
      "daemon-client",
  );
  const editing = !!initial;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [runtimes, setRuntimes] = useState<DaemonRuntimeRead[]>([]);
  const [loadingRuntimes, setLoadingRuntimes] = useState(true);
  const [runtimesError, setRuntimesError] = useState<string | null>(null);

  const loadRuntimes = useCallback(async () => {
    setLoadingRuntimes(true);
    setRuntimesError(null);
    try {
      const list = await listDaemonRuntimes();
      setRuntimes(sortRuntimes(list));
    } catch (e) {
      setRuntimesError(e instanceof ApiError ? e.message : "加载守护进程列表失败");
    } finally {
      setLoadingRuntimes(false);
    }
  }, []);

  useEffect(() => {
    void loadRuntimes();
  }, [loadRuntimes]);

  const handleSave = async () => {
    if (!rootPath || saving) return;
    setSaving(true);
    setError(null);
    try {
      const req: MemberBindingUpsertRequest = {
        runtime_id: runtimeId || null,
        root_path: rootPath,
        path_source: pathSource,
      };
      await upsertMyBinding(workspaceId, req);
      onConfigured();
    } catch (err) {
      setError(errMessage(err, "保存失败"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-lg border border-amber-300 bg-amber-50 p-4"
      data-testid="workspace-access-guide"
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-amber-900">
          {editing ? "✏ 编辑我的接入配置" : "⚙ 配置你在此工作空间的 daemon 和本地路径"}
        </h3>
        <p className="mt-1 text-xs text-amber-800">
          {editing
            ? "修改你自己的守护进程和本地代码检出路径。保存后，后续 scan / 运行 agent 会用新值。代码靠 git 同步，平台不碰代码内容。"
            : "你已被加入此工作空间。请配置你自己的守护进程和本地代码检出路径，然后才能 scan / 运行 agent。 代码靠 git 同步，平台不碰代码内容。"}
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1" data-testid="runtime-field">
          <label htmlFor="runtime" className="text-xs font-medium">
            绑定守护进程
          </label>
          <select
            id="runtime"
            value={runtimeId}
            onChange={(e) => setRuntimeId(e.target.value)}
            disabled={loadingRuntimes}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
          >
            <option value="">不绑定守护进程</option>
            {runtimes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {runtimeOptionLabel(rt)}
              </option>
            ))}
          </select>
          {loadingRuntimes && (
            <p className="text-[11px] text-muted-foreground">加载中…</p>
          )}
          {runtimesError && (
            <p className="text-[11px] text-destructive" role="alert">
              {runtimesError}
            </p>
          )}
          {!loadingRuntimes && !runtimesError && runtimes.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              还没有守护进程运行时，请先在「守护进程」页启动一个。
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="rootPath" className="text-xs font-medium">
            本地项目路径
          </label>
          <Input
            id="rootPath"
            placeholder="/Users/you/code/project"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="pathSource" className="text-xs font-medium">
            路径来源
          </label>
          <select
            id="pathSource"
            value={pathSource}
            onChange={(e) =>
              setPathSource(e.target.value as "server-local" | "daemon-client")
            }
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
          >
            <option value="daemon-client">
              {workspacePathSourceLabel("daemon-client")}
            </option>
            <option value="server-local">
              {workspacePathSourceLabel("server-local")}
            </option>
          </select>
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || !rootPath}>
          {saving
            ? "保存中…"
            : editing
              ? "保存修改"
              : "保存我的接入配置"}
        </Button>
      </div>
    </div>
  );
}
