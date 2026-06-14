"use client";

/**
 * AgentProviderSelect — provider 下拉共享组件（task-09,
 * 2026-06-14-agent-runtime-selection）。
 *
 * 三个触发面板（设置页 / task / stage+scan）共用本组件。选项来自在线
 * daemon runtime 的 distinct provider，label/icon/color 由 PROVIDER_META
 * 渲染；找不到 meta 时回退到 provider 原值（容忍未知 provider, R-06）。
 *
 * 受控组件：``value`` + ``onChange``，不维护内部选中态（仅加载态）。
 * - ``value=null`` 映射到兜底项（``value=""``）。
 * - 当 ``value`` 指向不在在线列表的 provider（如 default_agent 指向离线
 *   provider），仍单独渲染该项并标注"（离线）"，保证用户可识别（R-01）。
 * - ``listDaemonRuntimes`` 失败时退化为空列表，不崩（R-04）。
 */

import { useEffect, useState } from "react";

import { listDaemonRuntimes, PROVIDER_META } from "@/lib/daemon";
import { cn } from "@/lib/utils";

interface AgentProviderSelectProps {
  value: string | null;
  onChange: (provider: string | null) => void;
  /** 兜底项文案（如"使用默认"）；不传则不显示该兜底项。 */
  includeDefault?: string;
  className?: string;
}

const DEFAULT_CLS =
  "h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none";

export function AgentProviderSelect({
  value,
  onChange,
  includeDefault,
  className,
}: AgentProviderSelectProps) {
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    listDaemonRuntimes()
      .then((rs) => {
        if (!active) return;
        const online = rs.filter((r) => r.status === "online" && r.provider);
        setProviders(
          Array.from(new Set(online.map((r) => r.provider as string))),
        );
      })
      .catch(() => {
        if (active) setProviders([]);
      });
    return () => {
      active = false;
    };
  }, []);

  // value 指向离线 provider（不在在线列表）→ 追加渲染并标注。
  const valueOffline =
    value && value !== "" && !providers.includes(value) ? value : null;

  const renderOption = (p: string, offline = false) => {
    const label = PROVIDER_META[p]?.label ?? p;
    return (
      <option key={p} value={p}>
        {offline ? `${label}（离线）` : label}
      </option>
    );
  };

  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : v);
      }}
      className={cn(DEFAULT_CLS, className)}
    >
      {includeDefault ? <option value="">{includeDefault}</option> : null}
      {providers.map((p) => renderOption(p))}
      {valueOffline ? renderOption(valueOffline, true) : null}
    </select>
  );
}
