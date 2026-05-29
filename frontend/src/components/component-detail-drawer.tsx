"use client";

import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Workspace, WorkspaceRelation } from "@/lib/workspaces";

interface Props {
  open: boolean;
  workspace: Workspace | null;
  relations: WorkspaceRelation[];
  onClose: () => void;
}

export function ComponentDetailDrawer({
  open,
  workspace,
  relations,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !workspace) return null;

  const outgoing = relations.filter((r) => r.source_id === workspace.id);
  const incoming = relations.filter((r) => r.target_id === workspace.id);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-labelledby="workspace-detail-title"
        className="flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto border-l bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="workspace-detail-title" className="truncate text-base">
              {workspace.name}
            </h2>
            <p className="font-mono text-[11px] text-muted-foreground">
              {workspace.slug}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={workspace.status === "active" ? "success" : "destructive"}>
              {workspace.status}
            </Badge>
            <Button size="sm" variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </div>
        </header>

        <section className="grid grid-cols-[5.5rem_1fr] gap-y-1.5 text-xs">
          {workspace.component_key && (
            <>
              <dt className="text-muted-foreground">component_key</dt>
              <dd className="font-mono">{workspace.component_key}</dd>
            </>
          )}
          {workspace.type && (
            <>
              <dt className="text-muted-foreground">type</dt>
              <dd>{workspace.type}</dd>
            </>
          )}
          {workspace.role && (
            <>
              <dt className="text-muted-foreground">role</dt>
              <dd>{workspace.role}</dd>
            </>
          )}
          <dt className="text-muted-foreground">root_path</dt>
          <dd className="break-all font-mono">{workspace.root_path}</dd>
          {workspace.repo_url && (
            <>
              <dt className="text-muted-foreground">repo_url</dt>
              <dd className="break-all font-mono">{workspace.repo_url}</dd>
            </>
          )}
          {workspace.default_branch && (
            <>
              <dt className="text-muted-foreground">默认分支</dt>
              <dd>{workspace.default_branch}</dd>
            </>
          )}
          {workspace.source_yaml_path && (
            <>
              <dt className="text-muted-foreground">source</dt>
              <dd className="break-all font-mono">{workspace.source_yaml_path}</dd>
            </>
          )}
        </section>

        {workspace.tech_stack.length > 0 && (
          <section>
            <h3 className="mb-1.5">技术栈</h3>
            <div className="flex flex-wrap gap-1">
              {workspace.tech_stack.map((t) => (
                <Badge key={t} variant="outline">{t}</Badge>
              ))}
            </div>
          </section>
        )}

        {(workspace.build_command || workspace.test_command) && (
          <section>
            <h3 className="mb-1.5">命令</h3>
            <pre className="rounded bg-muted p-2.5 font-mono text-[11px] leading-4">
              {workspace.build_command && `build: ${workspace.build_command}\n`}
              {workspace.test_command && `test:  ${workspace.test_command}`}
            </pre>
          </section>
        )}

        <section>
          <h3 className="mb-1.5">关联</h3>
          {outgoing.length === 0 && incoming.length === 0 ? (
            <p className="text-xs text-muted-foreground">无关联 Workspace。</p>
          ) : (
            <ul className="space-y-0.5 text-xs font-mono">
              {outgoing.map((r) => (
                <li key={r.id}>
                  → {r.target_id.slice(0, 8)}…{" "}
                  <span className="text-muted-foreground">[{r.relation_type}]</span>
                </li>
              ))}
              {incoming.map((r) => (
                <li key={r.id}>
                  ← {r.source_id.slice(0, 8)}…{" "}
                  <span className="text-muted-foreground">[{r.relation_type}]</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
