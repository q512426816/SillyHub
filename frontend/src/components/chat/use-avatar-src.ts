"use client";

/**
 * useAvatarSrc — 头像 src 解析 hook（2026-09-09-sessions-visual-refresh task-03）。
 *
 * 自 group-member-avatar.tsx 平移（D-006@v2：构件同源、逻辑单份不拷贝）：
 *   - 文件中心 URL（/api/file/{id}）→ fetchFileBlob 带 token 取 Blob →
 *     objectURL（浏览器 <img src> 不带 Authorization，直接用相对 URL 会 401）；
 *   - http(s) 外链 → 原值直用；
 *   - 空 / 非法 → null（消费方首字回退）。
 * group-member-avatar.tsx 改为从此处 import（导出面不变）。
 */
import { useEffect, useState } from "react";

import { fetchFileBlob } from "@/lib/file/api";

/**
 * 文件中心 URL（/api/file/{id}）→ 文件 id；其余（http 外链 / 空 / 非法）→
 * null（null = 非 blob 拉取路径，外链可直接作 src）。
 */
export function avatarFileId(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  if (!avatar.includes("/api/file/")) return null;
  const m = avatar.match(/\/api\/file\/([\w-]+)/);
  return m?.[1] ?? null;
}

/** 头像 src 解析（文件中心 URL → blob objectURL；外链 → 原值直用）。 */
export function useAvatarSrc(avatar: string | null | undefined): string | null {
  const fileId = avatarFileId(avatar);
  const directSrc = fileId == null && avatar ? avatar : null;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (fileId == null) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    setSrc(null);
    fetchFileBlob(fileId)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {
        /* 拉取失败静默回退首字（过期/无权限头像不阻断消息流渲染）。 */
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId]);
  return fileId != null ? src : directSrc;
}
