"use client";

/**
 * daemon 客户端目录浏览器（task-11，2026-06-18-workspace-client-path）。
 * 经 backend list-dir RPC（task-04）浏览 daemon 客户端机器目录，
 * 受 daemon allowed_roots 白名单限制（D-002@v1），越界 403。
 */
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { listDir, type DirEntry } from "@/lib/daemon";

interface Props {
  runtimeId: string;
  initialPath?: string;
  onSelect: (path: string) => void;
  selectedPath?: string;
}

export function DaemonDirBrowser({
  runtimeId,
  initialPath = "",
  onSelect,
  selectedPath,
}: Props) {
  const [path, setPath] = useState(initialPath);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: string) => {
      if (!p) return;
      setLoading(true);
      setError(null);
      try {
        const res = await listDir(runtimeId, p);
        setEntries(res.entries);
        setPath(p);
      } catch (err) {
        const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : "加载失败";
        setError(msg);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [runtimeId],
  );

  useEffect(() => {
    if (initialPath) void load(initialPath);
    // 仅在 initialPath 变化时触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  const join = (base: string, name: string): string => {
    if (!base) return name;
    const sep = base.endsWith("/") || base.endsWith("\\") ? "" : "/";
    return `${base}${sep}${name}`;
  };

  const enter = (name: string) => void load(join(path, name));

  const goUp = () => {
    if (!path) return;
    const norm = path.replace(/\\/g, "/");
    const leadingSlash = norm.startsWith("/");
    const parts = norm.split("/").filter(Boolean);
    parts.pop();
    const parent = parts.length ? (leadingSlash ? "/" : "") + parts.join("/") : path;
    void load(parent);
  };

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex gap-2">
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="输入 daemon 机器路径后回车列出"
          onKeyDown={(e) => {
            if (e.key === "Enter") void load(path);
          }}
          disabled={loading}
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load(path)}
          disabled={loading || !path}
        >
          {loading ? "..." : "列出"}
        </Button>
        <Button size="sm" variant="ghost" onClick={goUp} disabled={loading || !path}>
          上级
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <ul className="max-h-56 overflow-auto rounded border bg-background text-sm">
        {entries.length === 0 && !loading && (
          <li className="p-2 text-muted-foreground">空目录</li>
        )}
        {entries.map((e) => {
          const full = join(path, e.name);
          return (
            <li key={e.name}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent ${
                  selectedPath === full ? "bg-accent" : ""
                }`}
                onClick={() => (e.type === "dir" ? enter(e.name) : onSelect(full))}
              >
                <span>{e.type === "dir" ? "📁" : "📄"}</span>
                <span className="flex-1 truncate">{e.name}</span>
                {e.type === "dir" && (
                  <span className="text-[10px] text-muted-foreground">进入</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between">
        <span className="truncate text-[11px] text-muted-foreground">
          当前：{path || "—"}
        </span>
        <Button size="sm" onClick={() => onSelect(path)} disabled={!path || loading}>
          选定为 root_path
        </Button>
      </div>
    </div>
  );
}
