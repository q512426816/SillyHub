"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  listDaemonInstances,
  PROVIDER_META,
  type DaemonInstanceRead,
} from "@/lib/daemon";
import { errMessage } from "@/lib/errors";
import {
  upsertMyBinding,
  type MemberBindingUpsertRequest,
} from "@/lib/workspace-binding";

/**
 * 已绑定成员回填的当前值（编辑模式 initial）。
 * 2026-07-03-daemon-entity-binding：绑定维度从 runtime_id 改 daemon_id（D-004）。
 */
export interface AccessGuideInitial {
  daemon_id: string | null;
  root_path: string;
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

/** 下拉项文案：hostname · provider 列表 · 状态。一个守护进程一项（含其全部 provider）。 */
function instanceOptionLabel(inst: DaemonInstanceRead): string {
  const name = inst.display_alias?.trim() || inst.hostname;
  const providers =
    (inst.providers ?? []).map((p) => providerLabel(p.provider)).join("/") ||
    "无 provider";
  const status = inst.status === "online" ? "在线" : "离线";
  return `${name} · ${providers} · ${status}`;
}

/** online 排前；同级按 hostname 稳定排序（与 workspace-daemon-switcher 一致）。 */
function sortInstances(list: DaemonInstanceRead[]): DaemonInstanceRead[] {
  return [...list].sort((a, b) => {
    const ra = a.status === "online" ? 0 : 1;
    const rb = b.status === "online" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.hostname.localeCompare(b.hostname, "zh-CN");
  });
}

/**
 * Access guide card: member configures own daemon + local path.
 * Shown when the current user has no binding for this workspace (FR-001/FR-003).
 *
 * 2026-07-03-daemon-entity-binding（D-004/D-006）：「绑定守护进程」下拉数据源
 * listDaemonInstances()（守护进程实体，含其 providers 列表），一个守护进程一项
 * （不再按 runtime/provider 维度选）。daemon_id 可不选（提交 null）；root_path 必填。
 */
export function WorkspaceAccessGuide({
  workspaceId,
  onConfigured,
  initial,
}: Props) {
  const [daemonId, setDaemonId] = useState(initial?.daemon_id ?? "");
  const [rootPath, setRootPath] = useState(initial?.root_path ?? "");
  const editing = !!initial;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [instances, setInstances] = useState<DaemonInstanceRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listDaemonInstances();
      setInstances(sortInstances(list));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "加载守护进程列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!rootPath || saving) return;
    setSaving(true);
    setError(null);
    try {
      // path_source 是 member 级 spec 同步策略字段（后端 MemberBindingUpsertRequest 保留，
      // 非 workspace 路径来源）。2026-07-10 移除 server-local 模式后固定为 "daemon-client"。
      const req: MemberBindingUpsertRequest = {
        daemon_id: daemonId || null,
        root_path: rootPath,
        path_source: "daemon-client",
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
          {editing ? "✏ 编辑我的接入配置" : "⚙ 配置你在此工作空间的守护进程和本地路径"}
        </h3>
        <p className="mt-1 text-xs text-amber-800">
          {editing
            ? "修改你自己的守护进程和本地代码检出路径。保存后，后续 scan / 运行 agent 会用新值。代码靠 git 同步，平台不碰代码内容。"
            : "你已被加入此工作空间。请配置你自己的守护进程和本地代码检出路径，然后才能 scan / 运行 agent。代码靠 git 同步，平台不碰代码内容。"}
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1" data-testid="daemon-field">
          <label htmlFor="daemon" className="text-xs font-medium">
            绑定守护进程
          </label>
          <select
            id="daemon"
            value={daemonId}
            onChange={(e) => setDaemonId(e.target.value)}
            disabled={loading}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
          >
            <option value="">不绑定守护进程</option>
            {instances.map((inst) => (
              <option key={inst.id} value={inst.id}>
                {instanceOptionLabel(inst)}
              </option>
            ))}
          </select>
          {loading && (
            <p className="text-[11px] text-muted-foreground">加载中…</p>
          )}
          {loadError && (
            <p className="text-[11px] text-destructive" role="alert">
              {loadError}
            </p>
          )}
          {!loading && !loadError && instances.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              还没有在线守护进程，请先启动一个。
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
