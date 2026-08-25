"use client";

/**
 * useObjectUrl — 预览文件 blob 拉取与 objectURL 生命周期 hook。
 *
 * 统一托管「鉴权拉 blob → createObjectURL → 卸载/切换自动 revoke」三件套，供
 * FilePreviewModal 消费，消灭三入口各自手写拉取逻辑的泄漏风险（R-04）。
 * 竞态防护：fetcher 变化时先丢弃 stale 结果再重拉（参照 file-image.tsx 语义）。
 *
 * 依据：design.md §5 数据流 + §7 接口定义。
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type ObjectUrlStatus = "idle" | "loading" | "ok" | "error";

export interface UseObjectUrlResult {
  blob: Blob | null;
  url: string | null;
  status: ObjectUrlStatus;
  retry: () => void;
}

export function useObjectUrl(
  fetcher: (() => Promise<Blob>) | null,
): UseObjectUrlResult {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ObjectUrlStatus>("idle");
  const seqRef = useRef(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  const run = useCallback(() => {
    // 清理上一轮的 cleanup（retry 场景）
    cleanupRef.current?.();
    cleanupRef.current = null;

    if (!fetcher) {
      setStatus("idle");
      return;
    }
    const seq = ++seqRef.current;
    setStatus("loading");
    let created: string | null = null;
    fetcher()
      .then((b) => {
        if (seqRef.current !== seq) return;
        created = URL.createObjectURL(b);
        setBlob(b);
        setUrl(created);
        setStatus("ok");
      })
      .catch(() => {
        if (seqRef.current !== seq) return;
        setBlob(null);
        setUrl(null);
        setStatus("error");
      });
    cleanupRef.current = () => {
      if (created) URL.revokeObjectURL(created);
    };
  }, [fetcher]);

  useEffect(() => {
    run();
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      setBlob(null);
      setUrl(null);
    };
  }, [run]);

  const retry = useCallback(() => {
    run();
  }, [run]);

  return { blob, url, status, retry };
}
