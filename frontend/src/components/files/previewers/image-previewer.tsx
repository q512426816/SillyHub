"use client";

/**
 * ImagePreviewer — 图片渲染器。
 *
 * antd Image 居中展示 objectURL，支持点击放大/缩放/旋转（与 file-image.tsx 交互一致）。
 * 统一消费 PreviewerProps。
 */

import { Image } from "antd";

import type { PreviewerProps } from "./index";

export function ImagePreviewer({ url, meta, fill }: PreviewerProps) {
  return (
    <div
      className={
        fill
          ? "flex h-full items-center justify-center p-4"
          : "flex min-h-[420px] items-center justify-center p-4"
      }
    >
      {/* fill 态把 antd Image 外层 wrapper（v6 语义 root）一并撑高并居中：
          img 的 max-h-full 是百分比，wrapper 高度随内容（inline-block）时解析不了 */}
      <Image
        src={url}
        alt={meta.name}
        classNames={fill ? { root: "flex h-full items-center justify-center" } : undefined}
        className={
          fill
            ? "max-h-full max-w-full rounded-lg object-contain"
            : "max-h-[560px] max-w-full rounded-lg object-contain"
        }
      />
    </div>
  );
}
