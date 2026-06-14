"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentProviderSelect } from "@/components/AgentProviderSelect";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  createWorkspace,
  scanGenerate,
  scanWorkspace,
  type ScanResult,
} from "@/lib/workspaces";

type Phase = "idle" | "scanning" | "ready" | "creating";

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

export function WorkspaceScanDialog({ onCreated, onCancel }: Props) {
  const router = useRouter();
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // 生成项目规范时使用的 agent provider 覆盖（FR-02，2026-06-14-agent-runtime-selection）
  const [scanProvider, setScanProvider] = useState<string | null>(null);

  const handleScan = async () => {
    setError(null);
    setScan(null);
    setPhase("scanning");
    try {
      const result = await scanWorkspace(rootPath);
      setScan(result);
      if (!name) {
        const last = rootPath.split(/[\\/]/).filter(Boolean).at(-1);
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
      const result = await scanGenerate(scan.root_path, scanProvider);
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
        name: name.trim() || rootPath,
        root_path: scan.root_path,
      });
      onCreated();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : "创建失败";
      setError(msg);
      setPhase("ready");
    }
  };

  const handleCancel = () => {
    onCancel();
  };

  const sillyspecBadgeVariant = scan?.is_sillyspec ? "success" : "outline";
  const sillyspecBadgeLabel = scan?.is_sillyspec ? "已检测到 .sillyspec" : "未检测到 .sillyspec";

  return (
    <div className="rounded-md border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h3>添加 Workspace</h3>
        <Button variant="ghost" size="sm" onClick={handleCancel}>
          取消
        </Button>
      </header>

      <div className="space-y-4 p-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="root-path">
            仓库根目录绝对路径
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
            指向项目代码仓库的本地路径，平台探测目录结构和可选的{" "}
            <code>.sillyspec/</code> 目录。
          </p>
        </div>

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
              <dt className="text-muted-foreground">projects</dt>
              <dd>{scan.structure.projects_count}</dd>
              <dt className="text-muted-foreground">active changes</dt>
              <dd>{scan.structure.active_changes_count}</dd>
              <dt className="text-muted-foreground">archived changes</dt>
              <dd>{scan.structure.archived_changes_count}</dd>
              <dt className="text-muted-foreground">docs / runtime / local.yaml</dt>
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
              Agent provider（生成项目规范时生效）
            </label>
            <AgentProviderSelect
              value={scanProvider}
              onChange={setScanProvider}
              includeDefault="跟随工作区默认"
            />
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
              Workspace 名称
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
            onClick={handleCancel}
            disabled={phase === "scanning"}
          >
            取消
          </Button>
        </footer>
      </div>
    </div>
  );
}
