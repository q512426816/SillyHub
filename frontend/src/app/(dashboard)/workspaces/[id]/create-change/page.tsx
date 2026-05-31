"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { listComponents, type Component } from "@/lib/components";
import { createChange, type CreateChangeInput } from "@/lib/changes";

interface Props {
  params: { id: string };
}

export default function CreateChangePage({ params }: Props) {
  const workspaceId = params.id;
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"full" | "quick">("full");
  const [components, setComponents] = useState<Component[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listComponents(workspaceId)
      .then((list) => setComponents(list.items ?? []))
      .catch(() => {});
  }, [workspaceId]);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const input: CreateChangeInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        scope,
        affected_components: selectedComponents.length > 0 ? selectedComponents : undefined,
      };
      const result = await createChange(workspaceId, input);
      router.push(`/workspaces/${workspaceId}/changes/${result.change_key}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建变更失败");
    } finally {
      setLoading(false);
    }
  };

  const toggleComponent = (id: string) => {
    setSelectedComponents((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-6">
      <header>
        <p className="text-[11px] text-muted-foreground">
          <Link href={`/workspaces/${workspaceId}/changes`} className="hover:underline">
            ← 变更列表
          </Link>
        </p>
        <h1 className="mt-0.5">创建变更</h1>
      </header>

      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <section className="space-y-4 rounded-md border bg-card p-4">
        {/* 标题 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">标题 *</label>
          <input
            className="h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
            placeholder="输入变更标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* 需求描述 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">需求描述</label>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[120px] resize-y focus:border-ring focus:outline-none"
            placeholder="描述变更的需求背景和目标（可选）"
            rows={6}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* 规模选择 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">规模</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setScope("full")}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                scope === "full"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-muted"
              }`}
            >
              🔧 大需求
            </button>
            <button
              type="button"
              onClick={() => setScope("quick")}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                scope === "quick"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-muted"
              }`}
            >
              ⚡ 小修改
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {scope === "full" ? "走完整 SillySpec 流程" : "快速修复模式"}
          </p>
        </div>

        {/* 关联组件 */}
        {components.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">关联组件</label>
            <div className="flex flex-wrap gap-1.5">
              {components.map((c) => (
                <button
                  key={c.id}
                  onClick={() => toggleComponent(c.component_key)}
                  className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                    selectedComponents.includes(c.component_key)
                      ? "border-primary bg-primary/8 text-primary"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 提交 */}
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={handleSubmit} disabled={loading || !title.trim()}>
            {loading ? "创建中…" : "创建变更"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            取消
          </Button>
        </div>
      </section>
    </div>
  );
}
