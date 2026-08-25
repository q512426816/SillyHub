"use client";

/**
 * ImagePreviewer — 图片渲染器。
 *
 * antd Image 居中展示 objectURL，支持点击放大/缩放/旋转（与 file-image.tsx 交互一致）。
 * 统一消费 PreviewerProps。
 */

import { Image } from "antd";

import type { PreviewerProps } from "./index";

export function ImagePreviewer({ url, meta }: PreviewerProps) {
  return (
    <div className="flex min-h-[420px] items-center justify-center p-4">
      <Image
        src={url}
        alt={meta.name}
        className="max-h-[560px] max-w-full rounded-lg object-contain"
      />
    </div>
  );
}
