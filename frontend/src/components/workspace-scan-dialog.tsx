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
import type { SpecStrategy } from "@/lib/spec-workspaces";

type Phase = "idle" | "scanning" | "ready" | "creating";

const STRATEGY_OPTIONS: { value: SpecStrategy; label: string; description: string }[] = [
  {
    value: "platform-managed",
    label: "Platform Managed",
    description: "规范由平台托管，与代码目录分离",
  },
  {
    value: "repo-mirrored",
    label: "Repo Mirrored",
    description: "平台托管但同步回仓库 .sillyspec 目录",
  },
  {
    value: "repo-native",
    label: "Repo Native",
    description: "直接使用仓库 .sillyspec 作为规范来源",
  },
];

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

export function WorkspaceScanDialog({ onCreated, onCancel }: Props) {
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [specStrategy, setSpecStrategy] = useState<SpecStrategy>("platform-managed");
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
      // Auto-select strategy based on hint
      if (result.sillyspec_strategy_hint === "repo-native") {
        setSpecStrategy("repo-native");
      }
      setPhase("ready");
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : "扫描失败";
      setError(msg);
      setPhase("idle");
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
        spec_strategy: specStrategy,
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
        <h3>添加 Workspace</h3>
        <Button variant="ghost" size="sm" onClick={onCancel}>
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
                {scan.sillyspec_strategy_hint && (
                  <Badge variant="default">
                    {scan.sillyspec_strategy_hint}
                  </Badge>
                )}
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
            <label className="text-xs font-medium text-muted-foreground" htmlFor="ws-name">
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

        {scan && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              规范策略 (Spec Strategy)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {STRATEGY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`rounded border px-3 py-2 text-left text-xs transition-colors ${
                    specStrategy === opt.value
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-muted/50"
                  }`}
                  onClick={() => setSpecStrategy(opt.value)}
                >
                  <span className="font-medium">{opt.label}</span>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {opt.description}
                  </p>
                </button>
              ))}
            </div>
            {scan.is_sillyspec && specStrategy !== "repo-native" && (
              <p className="text-[11px] text-amber-600">
                检测到 .sillyspec 但未选择 repo-native 策略。规范将独立托管。
              </p>
            )}
            {!scan.is_sillyspec && specStrategy === "repo-native" && (
              <p className="text-[11px] text-amber-600">
                未检测到 .sillyspec，选择 repo-native 需后续手动导入。
              </p>
            )}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <footer className="flex items-center justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!scan || !name.trim() || phase === "creating"}
          >
            {phase === "creating" ? "创建中..." : "确认创建"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
