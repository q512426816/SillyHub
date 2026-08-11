"use client";

import { useState, type ReactNode } from "react";

/**
 * 次线侧栏可折叠卡片基件（2026-08-11-change-detail-layout-rework / FR-01b）。
 *
 * 受控折叠由内部 state 承载（非受控语义：defaultOpen 决定初始态，点击 header 切换）。
 * 桌面侧栏常驻、移动端 <lg 堆叠时同样用此件折叠省空间。沿用本页 @/components/ui 风格
 * （rounded-md border bg-card），不引入 antd（D-005）。
 */
export interface CollapsibleCardProps {
  /** 卡片标题（中文） */
  title: string;
  /** 初始是否展开，默认收起（次线卡默认折叠省空间，R-05） */
  defaultOpen?: boolean;
  /** 卡片正文 */
  children: ReactNode;
}

export function CollapsibleCard({
  title,
  defaultOpen = false,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between px-3 py-2 text-left ${
          open ? "border-b" : ""
        }`}
      >
        <h2 className="text-xs font-medium">{title}</h2>
        <span className="text-[11px] text-muted-foreground">
          {open ? "▾ 收起" : "▸ 展开"}
        </span>
      </button>
      {open ? <div className="p-3">{children}</div> : null}
    </section>
  );
}
