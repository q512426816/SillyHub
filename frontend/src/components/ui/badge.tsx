import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded px-1.5 py-px text-[11px] font-medium leading-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary/10 text-primary",
        success:
          "bg-emerald-50 text-emerald-700",
        warning:
          "bg-amber-50 text-amber-700",
        destructive:
          "bg-red-50 text-red-700",
        outline:
          "border border-border text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
