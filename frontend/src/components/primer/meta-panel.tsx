/**
 * MetaPanel / MetaPanelSection —— primer 侧栏信息面板（2026-09-26-core-pages-visual-redesign FR-01 / FR-04）。
 *
 * GitHub PR sidebar 范式：细边框圆角浅底容器 + 若干 title+children 分组，
 * 供变更详情六组信息 / 会话右栏信息面板消费。
 */
import * as React from "react";

export interface MetaPanelProps {
  children: React.ReactNode;
  className?: string;
}

export function MetaPanel({ children, className }: MetaPanelProps) {
  return (
    <aside
      className={`rounded-lg border text-sm ${className ?? ""}`}
      style={{
        borderColor: "hsl(var(--border))",
        backgroundColor: "hsl(var(--muted))",
      }}
    >
      {children}
    </aside>
  );
}

export interface MetaPanelSectionProps {
  /** 分组标题（如「负责人」「消耗统计」）。 */
  title: string;
  children: React.ReactNode;
}

export function MetaPanelSection({ title, children }: MetaPanelSectionProps) {
  return (
    <section
      className="border-b px-4 py-3 last:border-b-0"
      style={{ borderBottomColor: "hsl(var(--border))" }}
    >
      <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{title}</h3>
      <div className="flex flex-col gap-1.5 text-sm">{children}</div>
    </section>
  );
}
