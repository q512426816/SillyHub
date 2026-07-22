"use client";

/**
 * FileImage — 带鉴权的文件图片渲染。
 *
 * 浏览器原生 ``<img src>`` 不带 Authorization，而文件下载端点要 JWT → 直接用 URL 会 401。
 * 本组件用 ``fetchFileBlob``（带 token）取 Blob → ``URL.createObjectURL`` → 渲染，
 * 并在卸载/id 变化时 ``revokeObjectURL`` 防内存泄露。
 *
 * - ``preview=false``（默认）：普通 ``<img>``，用于 FileUpload 缩略图（编辑态，不放大）。
 * - ``preview=true``：antd ``<Image>``，可点击放大；放在 ``Image.PreviewGroup`` 内自动加入预览组。
 *
 * 依据：design.md §D-005（前端 MIME 判定 + 预览）。
 */

import { useEffect, useState } from "react";
import { Image } from "antd";

import { fetchFileBlob } from "@/lib/file/api";

export interface FileImageProps {
  /** 文件 id。 */
  id: string;
  alt?: string;
  className?: string;
  /** 是否可预览放大（antd Image，在 PreviewGroup 内自动加入）。默认 false=普通 img 缩略图。 */
  preview?: boolean;
}

export function FileImage({ id, alt = "", className, preview = false }: FileImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setSrc(null);
    setFailed(false);
    fetchFileBlob(id)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  if (failed) {
    return <div className={className} aria-label="图片加载失败" title="图片加载失败" />;
  }
  if (!src) {
    // 占位：保持布局尺寸，加载完成前不跳动
    return <div className={`${className ?? ""} animate-pulse bg-muted/40`} aria-label="图片加载中" />;
  }
  if (preview) {
    return <Image src={src} alt={alt} className={className} preview={{ mask: "预览" }} />;
  }
  // 缩略图（FileUpload 编辑态，点击不放大）
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

export default FileImage;
