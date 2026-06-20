"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  addMember,
  searchUsersForInvite,
  type UserSearchHit,
  type WorkspaceMemberRoleKey,
} from "@/lib/workspace-members";

interface Props {
  workspaceId: string;
  onAdded: () => void;
  onClose: () => void;
}

// FR-08 默认 developer；backend Literal["workspace_owner","developer","viewer"]
// 不暴露 platform_admin / reviewer / qa / component_lead —— 后端会拒绝
const ROLE_OPTIONS: ReadonlyArray<{ value: WorkspaceMemberRoleKey; label: string }> = [
  { value: "developer", label: "开发者" },
  { value: "viewer", label: "只读成员" },
  { value: "workspace_owner", label: "工作区所有者" },
];

// 隐性 state machine：6 phase 由 loading / submitting / error / selectedUser 组合表达
// idle       = loading=false, submitting=false, error=null, selectedUser=null
// searching  = loading=true
// select     = loading=false, selectedUser=null, candidates.length>0
// submitting = submitting=true
// success    = submitting=true → 立即 onAdded()+onClose()（瞬态）
// error      = error !== null
export function WorkspaceMemberAddDialog({ workspaceId, onAdded, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<UserSearchHit[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchHit | null>(null);
  const [role, setRole] = useState<WorkspaceMemberRoleKey>("developer");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 竞态 token：每次新 search 时 ++，结果返回时仅当仍等于 mySeq 才 setState
  const searchSeqRef = useRef(0);
  // 蒙层 ref：检测点击起点在卡片之外（pointerdown）
  const overlayRef = useRef<HTMLDivElement>(null);

  // Debounce 300ms 搜索（内联 useEffect + setTimeout + clearTimeout；项目无 use-debounce）
  useEffect(() => {
    const q = query.trim();

    // 边界：长度 < 2 不发请求（与 backend Query(min_length=2) 对齐，挡 422 噪音）
    if (q.length < 2) {
      setCandidates([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    // 本笔请求分配一个递增 seq；返回时仅当自己仍是最新 seq 时 setState
    const mySeq = ++searchSeqRef.current;

    const timer = setTimeout(async () => {
      try {
        const hits = await searchUsersForInvite(workspaceId, q);
        if (searchSeqRef.current === mySeq) {
          setCandidates(hits);
          setLoading(false);
        }
      } catch (err) {
        if (searchSeqRef.current === mySeq) {
          const msg =
            err instanceof ApiError ? `${err.code}: ${err.message}` : "搜索失败";
          setError(msg);
          setCandidates([]);
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
    // searchSeqRef 是 ref，不进 deps（React 官方约定）
  }, [query, workspaceId]);

  // ESC 键关闭（submitting 时禁用，避免请求中关闭导致 UI 不一致）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const handleOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 仅当 pointer down 起点在 overlay 本身（而非内部卡片）才关闭
    // 用 pointerdown 而非 click：避免在 input 内拖选文本松手时误触发
    if (e.target === overlayRef.current && !submitting) {
      onClose();
    }
  };

  const handleSubmit = async () => {
    if (!selectedUser) return;
    if (submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await addMember(workspaceId, {
        user_id: selectedUser.user_id,
        role_key: role,
      });
      // FR-08 GWT3：对话框关闭 + 列表刷新；先 onAdded 让父 refetch，再 onClose unmount
      onAdded();
      onClose();
    } catch (err) {
      // FR-08 GWT4：保持对话框打开，顶部红色错误条；不调用 onClose
      const msg =
        err instanceof ApiError ? `${err.code}: ${err.message}` : "添加失败";
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      onPointerDown={handleOverlayPointerDown}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-5 shadow-lg">
        <h2 className="text-base font-semibold">添加成员</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          搜索已注册的非成员用户（display name 或 email），选中后指定角色并添加。
        </p>

        <div className="mt-4 space-y-3">
          {/* 搜索 input + 候选下拉 */}
          <div>
            <label className="text-[11px] text-muted-foreground">搜索用户</label>
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                // 改 query 时清掉选中（避免候选列表变化后仍指向旧选中）
                setSelectedUser(null);
              }}
              placeholder="输入至少 2 个字符，如 ali / @example.com"
              className="mt-0.5"
              disabled={submitting}
              autoFocus
            />
            {loading && (
              <p className="mt-1 text-[11px] text-muted-foreground">搜索中…</p>
            )}
            {!loading && query.trim().length >= 2 && candidates.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                无匹配候选（已是成员或 status 非 active 的用户不展示）。
              </p>
            )}
            {candidates.length > 0 && (
              <ul className="mt-1 max-h-44 overflow-auto rounded border bg-card">
                {candidates.map((hit) => {
                  const active = selectedUser?.user_id === hit.user_id;
                  return (
                    <li key={hit.user_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedUser(hit)}
                        disabled={submitting}
                        className={
                          "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-muted/60 disabled:opacity-50 " +
                          (active ? "bg-primary/10 font-medium" : "")
                        }
                      >
                        <span>
                          {hit.display_name ?? "（无显示名）"}{" "}
                          <span className="text-muted-foreground">
                            &lt;{hit.email}&gt;
                          </span>
                        </span>
                        {active && <span className="text-primary">已选</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 角色下拉（原生 select；项目无 shadcn Select 组件） */}
          <div>
            <label className="text-[11px] text-muted-foreground">角色</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceMemberRoleKey)}
              disabled={submitting}
              className="mt-0.5 w-full rounded border bg-background px-2 py-1.5 text-sm"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              工作区所有者可管理成员；开发者可读写；只读成员只读。
            </p>
          </div>

          {/* 错误条（与 api-key-create-dialog.tsx 一致样式） */}
          {error && (
            <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!selectedUser || loading || submitting}
          >
            {submitting ? "添加中…" : "添加"}
          </Button>
        </div>
      </div>
    </div>
  );
}
