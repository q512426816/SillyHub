import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Tag: antd Tag 的纯视觉替代(不依赖 antd)。
 * 颜色走语义 token,不硬编码 emerald/amber/red/blue 字面色值。
 */
const tagVariants = cva(
  "inline-flex items-center gap-1 rounded px-1.5 py-px text-[11px] font-medium leading-4 whitespace-nowrap",
  {
    variants: {
      color: {
        default: "bg-primary/10 text-primary",
        info: "bg-info/10 text-info",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        destructive: "bg-destructive/10 text-destructive",
        error: "bg-error/10 text-error",
        outline: "border border-input text-muted-foreground",
      },
    },
    defaultVariants: { color: "default" },
  },
);

export interface TagProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof tagVariants> {
  closable?: boolean;
  onClose?: (e: React.MouseEvent<SVGSVGElement>) => void;
}

export function Tag({
  className,
  color,
  closable,
  onClose,
  children,
  ...props
}: TagProps) {
  return (
    <span className={cn(tagVariants({ color }), className)} {...props}>
      {children}
      {closable ? (
        <X
          className="size-3 cursor-pointer opacity-60 hover:opacity-100"
          onClick={onClose}
        />
      ) : null}
    </span>
  );
}
