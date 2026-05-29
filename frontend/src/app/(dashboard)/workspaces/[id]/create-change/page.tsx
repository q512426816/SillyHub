"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { listComponents, type Component } from "@/lib/components";
import { createChange, generateDocs } from "@/lib/change-writer";

interface Props {
  params: { id: string };
}

const DOC_OPTIONS = [
  { key: "proposal", label: "Proposal（提案）" },
  { key: "requirements", label: "Requirements（需求）" },
  { key: "design", label: "Design（设计）" },
  { key: "plan", label: "Plan（计划）" },
] as const;

export default function CreateChangePage({ params }: Props) {
  const workspaceId = params.id;
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [components, setComponents] = useState<Component[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);  // component_key values
  const [selectedDocs, setSelectedDocs] = useState<string[]>(["proposal"]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [createdChangeId, setCreatedChangeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listComponents(workspaceId)
      .then((list) => setComponents(list.items ?? []))
      .catch(() => {});
  }, [workspaceId]);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await createChange(workspaceId, {
        title: title.trim(),
        affected_components: selectedComponents.length > 0 ? selectedComponents : undefined,
      });
      setCreatedChangeId(result.id);
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建变更失败");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!createdChangeId || selectedDocs.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      await generateDocs(workspaceId, createdChangeId, selectedDocs);
      router.push(`/workspaces/${workspaceId}/changes/${createdChangeId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "生成文档失败");
    } finally {
      setLoading(false);
    }
  };

  const toggleComponent = (id: string) => {
    setSelectedComponents((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const toggleDoc = (key: string) => {
    setSelectedDocs((prev) =>
      prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key],
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

      {step === 1 ? (
        <section className="space-y-4 rounded-md border bg-card p-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">标题 *</label>
            <input
              className="h-8 w-full rounded border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none"
              placeholder="输入变更标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

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

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleCreate} disabled={loading || !title.trim()}>
              {loading ? "创建中…" : "创建变更"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.back()}>
              取消
            </Button>
          </div>
        </section>
      ) : (
        <section className="space-y-4 rounded-md border bg-card p-4">
          <p className="text-xs text-emerald-700">
            变更已创建！选择要生成的文档模板。
          </p>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">文档模板</label>
            <div className="space-y-1">
              {DOC_OPTIONS.map((doc) => (
                <label key={doc.key} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selectedDocs.includes(doc.key)}
                    onChange={() => toggleDoc(doc.key)}
                    className="size-3.5"
                  />
                  {doc.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleGenerate} disabled={loading || selectedDocs.length === 0}>
              {loading ? "生成中…" : "生成文档"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                router.push(`/workspaces/${workspaceId}/changes/${createdChangeId}`)
              }
            >
              跳过
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
