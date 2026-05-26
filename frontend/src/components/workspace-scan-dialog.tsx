"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  createWorkspace,
  scanWorkspace,
  type ScanResult,
} from "@/lib/workspaces";

type Phase = "idle" | "scanning" | "ready" | "creating";

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

export function WorkspaceScanDialog({ onCreated, onCancel }: Props) {
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

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

  const handleCreate = async () => {
    if (!scan || !scan.is_sillyspec) return;
    setError(null);
    setPhase("creating");
    try {
      await createWorkspace({ name: name.trim() || rootPath, root_path: scan.root_path });
      onCreated();
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : "创建失败";
      setError(msg);
      setPhase("ready");
    }
  };

  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold tracking-tight">添加 Workspace</h3>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
      </header>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="root-path">
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
              onClick={handleScan}
              disabled={!rootPath || phase === "scanning" || phase === "creating"}
            >
              {phase === "scanning" ? "扫描中…" : "扫描"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            指向 SillySpec 仓库的本地路径，平台只读地探测 <code>.sillyspec/</code> 目录结构。
          </p>
        </div>

        {scan && (
          <section className="rounded-md border bg-muted/40 p-4 text-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-medium">扫描结果</span>
              <Badge variant={scan.is_sillyspec ? "success" : "destructive"}>
                {scan.is_sillyspec ? "is_sillyspec: true" : "is_sillyspec: false"}
              </Badge>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="text-muted-foreground">root_path</div>
              <div className="break-all font-mono">{scan.root_path}</div>
              <div className="text-muted-foreground">.sillyspec</div>
              <div className="break-all font-mono">{scan.sillyspec_path}</div>
              <div className="text-muted-foreground">projects</div>
              <div>{scan.structure.projects_count}</div>
              <div className="text-muted-foreground">active changes</div>
              <div>{scan.structure.active_changes_count}</div>
              <div className="text-muted-foreground">archived changes</div>
              <div>{scan.structure.archived_changes_count}</div>
              <div className="text-muted-foreground">docs / runtime / local.yaml</div>
              <div>
                {[
                  scan.structure.has_docs_dir && "docs",
                  scan.structure.has_runtime_dir && ".runtime",
                  scan.structure.has_local_yaml && "local.yaml",
                ]
                  .filter(Boolean)
                  .join(" / ") || "—"}
              </div>
            </dl>
            {scan.warnings.length > 0 && (
              <ul className="mt-3 list-inside list-disc text-xs text-amber-600 dark:text-amber-300">
                {scan.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {scan?.is_sillyspec && (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="ws-name">
              Workspace 名称
            </label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-workspace"
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <footer className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!scan?.is_sillyspec || !name.trim() || phase === "creating"}
          >
            {phase === "creating" ? "创建中…" : "确认创建"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
