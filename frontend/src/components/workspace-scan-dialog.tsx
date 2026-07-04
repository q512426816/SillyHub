"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AgentModelInput } from "@/components/AgentModelInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentProviderSelect } from "@/components/AgentProviderSelect";
import { Input } from "@/components/ui/input";
import { DaemonDirBrowser } from "@/components/daemon-dir-browser";
import { normalizeClientPath } from "@/lib/client-path";
import {
  listDaemonInstances,
  listDaemonRuntimes,
  PROVIDER_META,
  type DaemonInstanceRead,
  type DaemonRuntimeRead,
} from "@/lib/daemon";
import { errMessage } from "@/lib/errors";
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
  // daemon-entity-binding task-10/11 补遗：创建对话框从 runtime 维度改为 daemon 实体维度。
  // 下拉展示守护进程实体（含全部 provider），value=inst.id；不再按 runtime 一项一条。
  const [instances, setInstances] = useState<DaemonInstanceRead[]>([]);
  const [daemonId, setDaemonId] = useState<string>("");
  // list-dir RPC 仍走 runtime 维度路由（/runtimes/{runtime_id}/list-dir，内部解析 daemon_id）。
  // 选 daemon 后从此 daemon 的 online providers 中取第一个 runtime_id 用于路径浏览。
  const [browseRuntimeId, setBrowseRuntimeId] = useState<string>("");
  const [daemonRootPath, setDaemonRootPath] = useState("");
  // spec 同步策略（2026-06-28-daemon-client-spec-sync-strategy）：daemon-client workspace
  // 创建时用户可选源项目已有 .sillyspec 如何进入平台。默认 platform-managed 零回归。
  const [specStrategy, setSpecStrategy] = useState<
    "platform-managed" | "repo-mirrored" | "repo-native"
  >("platform-managed");

  useEffect(() => {
    if (!canUseServerLocal && pathSource === "server-local") {
      setPathSource("daemon-client");
      setRootPath("");
      setScan(null);
    }
  }, [canUseServerLocal, pathSource]);

  useEffect(() => {
    if (pathSource !== "daemon-client") return;
    void listDaemonInstances()
      .then(setInstances)
      .catch(() => setInstances([]));
  }, [pathSource]);

  // task-10/11 补遗：选 daemon 后解析该 daemon 下第一个 online runtime_id 供 list-dir 浏览。
  // list-dir RPC 端点仍按 runtime_id 路由（/runtimes/{runtime_id}/list-dir），内部解析 daemon_id；
  // 创建则按 daemon_id 走 WorkspaceService.create 建 member binding 行。
  useEffect(() => {
    if (!daemonId) {
      setBrowseRuntimeId("");
      return;
    }
    void listDaemonRuntimes()
      .then((all) => {
        const hit = all.find(
          (r) =>
            r.daemon_instance_id === daemonId && r.status === "online",
        );
        setBrowseRuntimeId(hit?.id ?? "");
      })
      .catch(() => setBrowseRuntimeId(""));
  }, [daemonId]);

  const handlePathSourceChange = (next: PathSource) => {
    setPathSource(next);
    setError(null);
    if (next === "server-local") {
      setDaemonId("");
      setBrowseRuntimeId("");
      setDaemonRootPath("");
    } else {
      setRootPath("");
      setScan(null);
      setPhase("idle");
    }
  };

  const handleCreateDaemonClient = async () => {
    if (!daemonId || !daemonRootPath) return;
    const normalizedRoot = normalizeClientPath(daemonRootPath);
    setError(null);
    setPhase("creating");
    try {
      await createWorkspace({
        name: name.trim() || normalizedRoot.split(/[\\/]/).filter(Boolean).at(-1) || normalizedRoot,
        root_path: normalizedRoot,
        path_source: "daemon-client",
        daemon_id: daemonId,
        spec_strategy: specStrategy,
      });
      onCreated();
    } catch (err) {
      setError(errMessage(err, "创建失败"));
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
      setError(errMessage(err, "扫描失败"));
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
      setError(errMessage(err, "生成失败"));
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
      setError(errMessage(err, "创建失败"));
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
            {daemonId && browseRuntimeId && (
              <DaemonDirBrowser
                runtimeId={browseRuntimeId}
                onSelect={(p) => setDaemonRootPath(normalizeClientPath(p))}
                selectedPath={daemonRootPath}
              />
            )}
            {daemonId && !browseRuntimeId && (
              <div className="space-y-1.5">
                <label
                  className="text-xs font-medium text-muted-foreground"
                  htmlFor="daemon-root-path-manual"
                >
                  守护进程暂无在线智能体，请手动填写项目路径
                </label>
                <Input
                  id="daemon-root-path-manual"
                  value={daemonRootPath}
                  onChange={(e) =>
                    setDaemonRootPath(normalizeClientPath(e.target.value))
                  }
                  placeholder="C:\\path\\to\\repo  或  /abs/path/to/repo"
                  disabled={phase === "creating"}
                />
                <p className="text-[11px] text-amber-600">
                  无法浏览目录（守护进程无在线 provider runtime）；请直接填写绝对路径后创建。
                </p>
              </div>
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
