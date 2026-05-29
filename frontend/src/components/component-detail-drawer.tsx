"use client";

import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Component, Relation } from "@/lib/components";

interface Props {
  open: boolean;
  component: Component | null;
  relations: Relation[];
  componentsById: Map<string, Component>;
  onClose: () => void;
}

export function ComponentDetailDrawer({
  open,
  component,
  relations,
  componentsById,
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

  if (!open || !component) return null;

  const outgoing = relations.filter((r) => r.source_component_id === component.id);
  const incoming = relations.filter((r) => r.target_component_id === component.id);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-labelledby="component-detail-title"
        className="flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto border-l bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="component-detail-title" className="truncate text-base">
              {component.name}
            </h2>
            <p className="font-mono text-[11px] text-muted-foreground">
              {component.component_key}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={component.status === "active" ? "success" : "destructive"}>
              {component.status}
            </Badge>
            <Button size="sm" variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </div>
        </header>

        <section className="grid grid-cols-[5.5rem_1fr] gap-y-1.5 text-xs">
          {component.type && (
            <>
              <dt className="text-muted-foreground">type</dt>
              <dd>{component.type}</dd>
            </>
          )}
          {component.role && (
            <>
              <dt className="text-muted-foreground">role</dt>
              <dd>{component.role}</dd>
            </>
          )}
          {component.path && (
            <>
              <dt className="text-muted-foreground">path</dt>
              <dd className="break-all font-mono">{component.path}</dd>
            </>
          )}
          {component.repo_url && (
            <>
              <dt className="text-muted-foreground">repo_url</dt>
              <dd className="break-all font-mono">{component.repo_url}</dd>
            </>
          )}
          {component.default_branch && (
            <>
              <dt className="text-muted-foreground">默认分支</dt>
              <dd>{component.default_branch}</dd>
            </>
          )}
          <dt className="text-muted-foreground">source</dt>
          <dd className="break-all font-mono">{component.source_yaml_path}</dd>
        </section>

        {component.tech_stack.length > 0 && (
          <section>
            <h3 className="mb-1.5">技术栈</h3>
            <div className="flex flex-wrap gap-1">
              {component.tech_stack.map((t) => (
                <Badge key={t} variant="outline">{t}</Badge>
              ))}
            </div>
          </section>
        )}

        {(component.build_command || component.test_command) && (
          <section>
            <h3 className="mb-1.5">命令</h3>
            <pre className="rounded bg-muted p-2.5 font-mono text-[11px] leading-4">
              {component.build_command && `build: ${component.build_command}\n`}
              {component.test_command && `test:  ${component.test_command}`}
            </pre>
          </section>
        )}

        <section>
          <h3 className="mb-1.5">关联</h3>
          {outgoing.length === 0 && incoming.length === 0 ? (
            <p className="text-xs text-muted-foreground">无关联组件。</p>
          ) : (
            <ul className="space-y-0.5 text-xs font-mono">
              {outgoing.map((r) => (
                <li key={r.id}>
                  → {componentsById.get(r.target_component_id)?.component_key ?? r.target_component_id}{" "}
                  <span className="text-muted-foreground">[{r.relation_type}]</span>
                </li>
              ))}
              {incoming.map((r) => (
                <li key={r.id}>
                  ← {componentsById.get(r.source_component_id)?.component_key ?? r.source_component_id}{" "}
                  <span className="text-muted-foreground">[{r.relation_type}]</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {Object.keys(component.extra).length > 0 && (
          <section>
            <h3 className="mb-1.5">未识别字段（extra）</h3>
            <pre className="rounded bg-muted p-2.5 font-mono text-[11px] leading-4">
              {JSON.stringify(component.extra, null, 2)}
            </pre>
          </section>
        )}
      </aside>
    </div>
  );
}
