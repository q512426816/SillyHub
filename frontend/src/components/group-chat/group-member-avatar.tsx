"use client";

/**
 * GroupMemberAvatar / GroupMemberAvatarUpload — 群成员头像渲染与上传共用件
 * （quick 群成员头像自定义：GroupMemberRead / GroupMemberAgentConfig /
 * GroupMemberUserCreate / GroupMemberUpdate 均含 avatar string|null，值为
 * 文件中心 URL（/api/file/{id}）或外链 http(s)）。
 *
 * 渲染口径（GroupMemberAvatar）：
 *   - avatar 有值 → antd Avatar 图片：文件中心 URL 经 fetchFileBlob 带 token 取
 *     Blob → objectURL（浏览器 <img src> 不带 Authorization，直接用相对 URL 会
 *     401——FileImage 同款惯例，file-image.tsx）；http(s) 外链直用 src；
 *   - 无值 / 加载失败 → 调用方现状首字回退（fallbackClassName 维持各渲染点
 *     既有配色阶——agent=brand 紫 / 用户=info 青 / member_id 哈希分色等）。
 *
 * 上传管线（GroupMemberAvatarUpload）：POST /api/file/upload（multipart +
 * owner_type="group_member_avatar"，lib/file/api uploadFile 现成封装）→
 * FileUploadResp.id → avatar 值 = getFileDownloadUrl(id)（/api/file/{id}）。
 * onChange(null) = 恢复默认（建群侧清本地值；成员面板侧调 PATCH avatar=""——
 * 后端 None=不改、空串=清除）。
 */

import { useEffect, useRef, useState } from "react";
import { Avatar, Button } from "antd";
import { Image as ImageIcon, RotateCcw, Upload } from "lucide-react";

import { errMessage, useNotify } from "@/lib/errors";
import { fetchFileBlob, getFileDownloadUrl, uploadFile } from "@/lib/file/api";
import { cn } from "@/lib/utils";

/* ────────────────────── 常量与纯辅助 ────────────────────── */

/** 头像文件上传归属类型（文件中心 owner 维度，列表/审计按此归组）。 */
export const GROUP_MEMBER_AVATAR_OWNER_TYPE = "group_member_avatar";

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

/* ────────────────────── 渲染组件 ────────────────────── */

/** 头像 src 解析（文件中心 URL → blob objectURL；外链 → 原值直用）。 */
function useAvatarSrc(avatar: string | null | undefined): string | null {
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

export interface GroupMemberAvatarProps {
  /** 头像 URL（文件中心 /api/file/{id} 或外链）；空 = 首字回退。 */
  avatar?: string | null;
  /** 成员昵称（首字回退 + 图片 alt）。 */
  name: string;
  /** px 尺寸（antd Avatar size；首字回退尺寸由 fallbackClassName 控制）。 */
  size: number;
  /** 两态共用类（形状 / 边框 / 叠层偏移 -ml-*）。 */
  className?: string;
  /** 首字回退态专属类（h-/w-/text- + 配色阶，维持各渲染点现状样式）。 */
  fallbackClassName: string;
  title?: string;
}

/**
 * 群成员头像（渲染口径见文件头）：avatar 有值 → antd Avatar 图片；无值 →
 * 现状首字回退。群行 facepile / 群聊面板气泡与顶栏 / 成员面板共用。
 */
export function GroupMemberAvatar({
  avatar,
  name,
  size,
  className,
  fallbackClassName,
  title,
}: GroupMemberAvatarProps) {
  const src = useAvatarSrc(avatar);
  if (src) {
    // antd Avatar 不接受 title 属性——外包 span 承载（悬浮提示 + 布局类）。
    return (
      <span
        title={title}
        data-testid="group-member-avatar-img"
        className={cn("inline-flex shrink-0", className)}
      >
        <Avatar src={src} alt={name} size={size} />
      </span>
    );
  }
  const initial = (name || "?").trim().slice(0, 1) || "?";
  return (
    <span
      aria-hidden
      title={title}
      data-testid="group-member-avatar-initial"
      className={cn(
        "flex shrink-0 items-center justify-center font-bold text-white",
        fallbackClassName,
        className,
      )}
    >
      {initial}
    </span>
  );
}

/* ────────────────────── 上传控件 ────────────────────── */

export interface GroupMemberAvatarUploadProps {
  /** 当前头像值（null = 未自定义）。 */
  value: string | null;
  /** 上传成功 → 新 avatar 值；「恢复默认」→ null（提交语义由调用方决定）。 */
  onChange: (_avatar: string | null) => void;
  /** 无障碍名（如「Agent 成员 1 头像」「林一 头像」）。 */
  label: string;
  /** 未设头像时预览回退首字。 */
  name: string;
  /** 紧凑形态（成员面板行内）：图标按钮；默认整态（建群向导）：文字按钮。 */
  compact?: boolean;
}

/**
 * 群成员头像上传控件：预览 + 上传（POST /api/file/upload，
 * owner_type="group_member_avatar"）+ 可清除恢复默认。建群向导（本地值）与
 * 成员面板（onChange 直调 PATCH）共用同一上传管线。
 */
export function GroupMemberAvatarUpload({
  value,
  onChange,
  label,
  name,
  compact = false,
}: GroupMemberAvatarUploadProps) {
  const notify = useNotify();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      // 固定文案走 warning(msg) 通道；error(err) 第一参是错误对象，误传字符串
      // 会被 errMessage 吞成兜底「操作失败」。
      notify.warning("头像仅支持图片文件，请重新选择");
      return;
    }
    setUploading(true);
    try {
      const resp = await uploadFile(file, {
        owner_type: GROUP_MEMBER_AVATAR_OWNER_TYPE,
      });
      onChange(getFileDownloadUrl(resp.id));
    } catch (err) {
      notify.error(err, "头像上传失败，请稍后重试");
    } finally {
      setUploading(false);
    }
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      hidden
      aria-label={`${label}（选择图片）`}
      onChange={(e) => void handleFile(e.target.files)}
    />
  );

  if (compact) {
    return (
      <span
        data-testid="group-member-avatar-upload"
        className="inline-flex shrink-0 items-center gap-1"
      >
        {input}
        <button
          type="button"
          aria-label={`${label}上传`}
          title={uploading ? "上传中…" : value ? "更换头像" : "上传头像"}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ImageIcon aria-hidden className="h-3 w-3" />
        </button>
        {value && (
          <button
            type="button"
            aria-label={`${label}恢复默认`}
            title="清除自定义头像，恢复首字默认"
            disabled={uploading}
            onClick={() => onChange(null)}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw aria-hidden className="h-3 w-3" />
          </button>
        )}
      </span>
    );
  }

  return (
    <span
      data-testid="group-member-avatar-upload"
      className="inline-flex items-center gap-2"
    >
      {input}
      <GroupMemberAvatar
        avatar={value}
        name={name}
        size={36}
        fallbackClassName="h-9 w-9 rounded-[10px] bg-brand-600 text-[13px]"
      />
      <Button
        size="small"
        loading={uploading}
        onClick={() => inputRef.current?.click()}
      >
        <Upload aria-hidden className="h-3.5 w-3.5" /> {value ? "更换头像" : "上传头像"}
      </Button>
      {value && (
        <Button size="small" type="text" onClick={() => onChange(null)}>
          <RotateCcw aria-hidden className="h-3.5 w-3.5" /> 恢复默认
        </Button>
      )}
    </span>
  );
}
