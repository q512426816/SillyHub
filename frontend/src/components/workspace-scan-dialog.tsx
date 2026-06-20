"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AgentModelInput } from "@/components/AgentModelInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentProviderSelect } from "@/components/AgentProviderSelect";
import { Input } from "@/components/ui/input";
import { DaemonDirBrowser } from "@/components/daemon-dir-browser";
import { ApiError } from "@/lib/api";
import { normalizeClientPath } from "@/lib/client-path";
import { listOnlineRuntimes, type DaemonRuntimeRead } from "@/lib/daemon";
import { hasAnyPermission } from "@/lib/permission";
import {
  createWorkspace,
  scanGenerate,
  scanWorkspace,
  type ScanResult,
} from "@/lib/workspaces";
import { useSession } from "@/stores/session";

type Phase = "idle" | "scanning" | "ready" | "creating";
type PathSource = "server-local" | "daemon-client";

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

export function WorkspaceScanDialog({ onCreated, onCancel }: Props) {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const canUseServerLocal = hasAnyPermission(user, ["workspace:admin"]);

  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [scanProvider, setScanProvider] = useState<string | null>(null);
  const [scanModel, setScanModel] = useState<string | null>(null);

  const [pathSource, setPathSource] = useState<PathSource>("daemon-client");
  const [runtimes, setRuntimes] = useState<DaemonRuntimeRead[]>([]);
  const [daemonRuntimeId, setDaemonRuntimeId] = useState<string>("");
  const [daemonRootPath, setDaemonRootPath] = useState("");

  useEffect(() => {
    if (!canUseServerLocal && pathSource === "server-local") {
      setPathSource("daemon-client");
      setRootPath("");
      setScan(null);
    }
  }, [canUseServerLocal, pathSource]);

  useEffect(() => {
    if (pathSource !== "daemon-client") return;
    void listOnlineRuntimes()
      .then(setRuntimes)
      .catch(() => setRuntimes([]));
  }, [pathSource]);

  const handlePathSourceChange = (next: PathSource) => {
    setPathSource(next);
    setError(null);
    if (next === "server-local") {
      setDaemonRuntimeId("");
      setDaemonRootPath("");
    } else {
      setRootPath("");
      setScan(null);
      setPhase("idle");
    }
  };

  const handleCreateDaemonClient = async () => {
    if (!daemonRuntimeId || !daemonRootPath) return;
    const normalizedRoot = normalizeClientPath(daemonRootPath);
    setError(null);
    setPhase("creating");
    try {
      await createWorkspace({
        name: name.trim() || normalizedRoot.split(/[\\/]/).filter(Boolean).at(-1) || normalizedRoot,
        root_path: normalizedRoot,
        path_source: "daemon-client",
        daemon_runtime_id: daemonRuntimeId,
      });
      onCreated();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : "创建失败";
      setError(msg);
      setPhase("idle");
    }
  };

  const handleScan = async () => {
    setError(null);
    setScan(null);
    setPhase("scanning");
    try {
      const result = await scanWorkspace(normalizeClientPath(rootPath));
      setScan(result);
      if (!name) {
        const last = result.root_path.split(/[\\/]/).filter(Boolean).at(-1);
        if (last) setName(last);
      }
      setPhase("ready");
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : "扫描失败";
      setError(msg);
      setPhase("idle");
    }
  };

  const handleGenerate = async () => {
    if (!scan) return;
    setError(null);
    setPhase("creating");
    try {
      const result = await scanGenerate(scan.root_path, scanProvider, scanModel);
      router.push(`/workspaces/${result.workspace_id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : "生成失败";
      setError(msg);
      setPhase("ready");
    }
  };

  const handleCreate = async () => {
    if (!scan) return;
    setError(null);
    setPhase("creating");
    try {
      await createWorkspace({
        name: name.trim() || scan.root_path,
        root_path: scan.root_path,
      });
      onCreated();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : "创建失败";
      setError(msg);
      setPhase("ready");
    }
  };

  const sillyspecBadgeVariant = scan?.is_sillyspec ? "success" : "outline";
  const sillyspecBadgeLabel = scan?.is_sillyspec ? "已检测到 .sillyspec" : "未检测到 .sillyspec";

  return (
    <div className="rounded-md border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h3>添加工作区</h3>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
      </header>

      <div className="space-y-4 p-4">
        {canUseServerLocal ? (
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                checked={pathSource === "daemon-client"}
                onChange={() => handlePathSourceChange("daemon-client")}
              />
              本机守护进程路径
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                checked={pathSource === "server-local"}
                onChange={() => handlePathSourceChange("server-local")}
              />
              服务器本地路径
            </label>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            默认使用本机守护进程上的项目路径。服务器本地路径需工作区管理权限。
          </p>
        )}

        {pathSource === "server-local" && canUseServerLocal && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="root-path">
              仓库根目录绝对路径（backend 宿主机）
            </label>
            <div className="flex gap-2">
              <Input
                id="root-path"
                value={rootPath}
                placeholder="C:\\path\\to\\repo  或  /abs/path/to/repo"
                onChange={(e) => setRootPath(e.target.value)}
                disabled={phase === "scanning" || phase === "creating"}
              />
              <Button
                size="sm"
                onClick={handleScan}
                disabled={!rootPath || phase === "scanning" || phase === "creating"}
              >
                {phase === "scanning" ? "扫描中..." : "扫描"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              指向 backend 容器/进程可访问的本地路径，平台探测目录结构和可选的{" "}
              <code>.sillyspec/</code> 目录。
            </p>
          </div>
        )}

        {pathSource === "daemon-client" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                在线守护进程
              </label>
              <select
                className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                value={daemonRuntimeId}
                onChange={(e) => setDaemonRuntimeId(e.target.value)}
                disabled={phase === "creating"}
              >
                <option value="">— 请选择在线守护进程 —</option>
                {runtimes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name ?? r.id} ({r.provider ?? "?"})
                  </option>
                ))}
              </select>
              {runtimes.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  无在线守护进程，请先启动 sillyhub-daemon。
                </p>
              )}
            </div>
            {daemonRuntimeId && (
              <DaemonDirBrowser
                runtimeId={daemonRuntimeId}
                onSelect={(p) => setDaemonRootPath(normalizeClientPath(p))}
                selectedPath={daemonRootPath}
              />
            )}
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
        )}

        {scan && (
          <section className="rounded border bg-muted/30 p-3 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">扫描结果</span>
              <div className="flex items-center gap-2">
                <Badge variant={sillyspecBadgeVariant}>
                  {sillyspecBadgeLabel}
                </Badge>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">root_path</dt>
              <dd className="break-all font-mono">{scan.root_path}</dd>
              <dt className="text-muted-foreground">.sillyspec</dt>
              <dd className="break-all font-mono">{scan.is_sillyspec ? "✓ 已检测到" : "未找到"}</dd>
              <dt className="text-muted-foreground">项目</dt>
              <dd>{scan.structure.projects_count}</dd>
              <dt className="text-muted-foreground">进行中变更</dt>
              <dd>{scan.structure.active_changes_count}</dd>
              <dt className="text-muted-foreground">已归档变更</dt>
              <dd>{scan.structure.archived_changes_count}</dd>
              <dt className="text-muted-foreground">文档 / 运行时 / local.yaml</dt>
              <dd>
                {[
                  scan.structure.has_docs_dir && "docs",
                  scan.structure.has_runtime_dir && ".runtime",
                  scan.structure.has_local_yaml && "local.yaml",
                  scan.structure.has_projects_dir && "projects",
                  scan.structure.has_changes_dir && "changes",
                ]
                  .filter(Boolean)
                  .join(" / ") || "---"}
              </dd>
            </dl>
            {scan.warnings.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-amber-600">
                {scan.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {scan && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              智能体提供方（生成项目规范时生效）
            </label>
            <AgentProviderSelect
              value={scanProvider}
              onChange={setScanProvider}
              includeDefault="跟随工作区默认"
            />
            <div className="mt-2 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                智能体模型
              </label>
              <AgentModelInput value={scanModel} onChange={setScanModel} />
            </div>
          </div>
        )}

        {scan && phase === "ready" && (
          <div className="flex justify-center gap-3">
            {scan.is_sillyspec && (
              <Button size="sm" variant="outline" onClick={handleCreate}>
                直接创建
              </Button>
            )}
            <Button size="sm" onClick={handleGenerate}>
              生成项目规范
            </Button>
          </div>
        )}

        {scan && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="ws-name">
              工作区名称
            </label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-workspace"
              disabled={phase === "creating"}
            />
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <footer className="flex items-center justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={phase === "scanning"}
          >
            取消
          </Button>
        </footer>
      </div>
    </div>
  );
}
