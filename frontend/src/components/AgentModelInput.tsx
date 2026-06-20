"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AgentModelInputProps = {
  value: string | null;
  onChange: (model: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function AgentModelInput({
  value,
  onChange,
  placeholder = "提供方默认值",
  disabled,
  className,
}: AgentModelInputProps) {
  return (
    <Input
      value={value ?? ""}
      onChange={(event) => {
        const next = event.target.value;
        onChange(next === "" ? null : next);
      }}
      placeholder={placeholder}
      disabled={disabled}
      className={cn("h-8 min-w-[220px] text-xs", className)}
    />
  );
}
