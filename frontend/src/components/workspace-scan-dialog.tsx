"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WorkspacePathPicker } from "@/components/workspace-path-picker";
import { normalizeClientPath } from "@/lib/client-path";
import {
  listDaemonInstances,
  PROVIDER_META,
  type DaemonInstanceRead,
} from "@/lib/daemon";
import { errMessage } from "@/lib/errors";
import {
  createWorkspace,
} from "@/lib/workspaces";

type Phase = "idle" | "creating";

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

export function WorkspaceScanDialog({ onCreated, onCancel }: Props) {
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  // daemon-entity-binding task-10/11 补遗：创建对话框从 runtime 维度改为 daemon 实体维度。
  // 下拉展示守护进程实体（含全部 provider），value=inst.id；不再按 runtime 一项一条。
  const [instances, setInstances] = useState<DaemonInstanceRead[]>([]);
  const [daemonId, setDaemonId] = useState<string>("");
  const [daemonRootPath, setDaemonRootPath] = useState("");
  // spec 同步策略（2026-06-28-daemon-client-spec-sync-strategy）：daemon-client workspace
  // 创建时用户可选源项目已有 .sillyspec 如何进入平台。默认 platform-managed 零回归。
  const [specStrategy, setSpecStrategy] = useState<
    "platform-managed" | "repo-mirrored" | "repo-native"
  >("platform-managed");

  useEffect(() => {
    void listDaemonInstances()
      .then(setInstances)
      .catch(() => setInstances([]));
  }, []);

  const handleCreateDaemonClient = async () => {
    if (!daemonId || !daemonRootPath) return;
    const normalizedRoot = normalizeClientPath(daemonRootPath);
    setError(null);
    setPhase("creating");
    try {
      await createWorkspace({
        name: name.trim() || normalizedRoot.split(/[\\/]/).filter(Boolean).at(-1) || normalizedRoot,
        root_path: normalizedRoot,
        daemon_id: daemonId,
        spec_strategy: specStrategy,
      });
      onCreated();
    } catch (err) {
      setError(errMessage(err, "创建失败"));
      setPhase("idle");
    }
  };

  return (
    <div className="rounded-md border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h3>添加工作区</h3>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
      </header>

      <div className="space-y-4 p-4">
        <p className="text-[11px] text-muted-foreground">
          使用本机守护进程上的项目路径。
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              在线守护进程
            </label>
            <select
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              value={daemonId}
              onChange={(e) => setDaemonId(e.target.value)}
              disabled={phase === "creating"}
            >
              <option value="">— 请选择在线守护进程 —</option>
              {instances.map((inst) => {
                const label =
                  inst.display_alias ?? inst.hostname;
                const providers = inst.providers
                  .map((p) => PROVIDER_META[p.provider]?.label ?? p.provider)
                  .join(" / ");
                const isOnline = inst.status === "online";
                return (
                  <option
                    key={inst.id}
                    value={inst.id}
                    // 离线 daemon 也展示但禁选（用户能看到，引导启动）
                    disabled={!isOnline}
                  >
                    {label} · {providers || "无 provider"} ·{" "}
                    {isOnline ? "在线" : "离线"}
                  </option>
                );
              })}
            </select>
            {instances.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                无在线守护进程，请先启动 sillyhub-daemon。
              </p>
            )}
          </div>
          <WorkspacePathPicker
            daemonId={daemonId}
            value={daemonRootPath}
            onChange={(p) => setDaemonRootPath(normalizeClientPath(p))}
            placeholder="C:\\path\\to\\repo"
            inputClassName="text-sm"
          />
          {daemonRootPath && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="ws-name-d">
                工作区名称
              </label>
              <Input
                id="ws-name-d"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-workspace"
                disabled={phase === "creating"}
              />
            </div>
          )}
          {daemonRootPath && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                spec 同步策略（源项目已有 .sillyspec 如何进入平台）
              </label>
              <div className="flex flex-col gap-1">
                {(
                  [
                    ["platform-managed", "平台托管（默认，不碰源项目，从零扫描）"],
                    ["repo-mirrored", "单次导入（复制源项目 .sillyspec 快照，不污染源项目）"],
                    ["repo-native", "源项目即真理（软链接，扫描直接写源项目）"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="radio"
                      checked={specStrategy === value}
                      onChange={() => setSpecStrategy(value)}
                      disabled={phase === "creating"}
                    />
                    {label}
                  </label>
                ))}
              </div>
              {specStrategy === "repo-native" && (
                <p className="text-[11px] text-amber-600">
                  ⚠ 扫描产出会写入源项目 .sillyspec（若被 git 跟踪需自行 commit）。
                </p>
              )}
            </div>
          )}
          {daemonRootPath && (
            <div className="flex justify-center">
              <Button
                size="sm"
                onClick={handleCreateDaemonClient}
                disabled={phase === "creating"}
              >
                {phase === "creating" ? "创建中..." : "创建工作区"}
              </Button>
            </div>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <footer className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
          >
            取消
          </Button>
        </footer>
      </div>
    </div>
  );
}
