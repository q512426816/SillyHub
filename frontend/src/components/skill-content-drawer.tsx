"use client";

/**
 * SkillContentDrawer —— 技能内容只读查看抽屉。2026-08-05-skill-content-viewer task-06。
 *
 * 右侧 antd Drawer，按 kind 加载并渲染 SKILL.md / 自定义技能 content：
 * - platform：usePlatformSkillContent(skillName)（按 skill_name 缓存）。
 * - custom：useQuery 包装 getCustomSkill(skillId)（与 platform 缓存策略对称）。
 * 两种 kind 都用 <MarkdownText size="reading"> 渲染（阅读尺寸）。
 */
import { Drawer, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";

import { MarkdownText } from "@/components/ui/markdown-text";
import { errMessage } from "@/lib/errors";
import {
  getCustomSkill,
  usePlatformSkillContent,
  type CustomSkillDetail,
} from "@/lib/custom-skills";
import type { ApiError } from "@/lib/api";

export interface SkillContentDrawerProps {
  open: boolean;
  onClose: () => void;
  kind: "platform" | "custom";
  /** platform kind 下要查看的 sillyspec-* skill 名（目录名）。 */
  skillName?: string | null;
  /** custom kind 下要查看的自定义技能 id。 */
  skillId?: string | null;
}

export function SkillContentDrawer({
  open,
  onClose,
  kind,
  skillName,
  skillId,
}: SkillContentDrawerProps) {
  const isPlatform = kind === "platform";

  // platform：按 skill_name 缓存（usePlatformSkillContent enabled 由 name 控制）。
  const platform = usePlatformSkillContent(isPlatform ? skillName : null);
  // custom：useQuery 包装 getCustomSkill，与 platform 缓存策略对称（gap ②）。
  const custom = useQuery<CustomSkillDetail, ApiError>({
    queryKey: ["customSkills", "detail", skillId ?? ""],
    queryFn: () => getCustomSkill(skillId as string),
    enabled: !isPlatform && !!skillId,
    staleTime: 30_000,
  });

  const title = isPlatform ? skillName : custom.data?.name ?? "自定义技能";
  const isLoading = isPlatform ? platform.isLoading : custom.isLoading;
  const isError = isPlatform ? platform.isError : custom.isError;
  const error = isPlatform ? platform.error : custom.error;
  const content = isPlatform
    ? platform.content?.content ?? null
    : custom.data?.content ?? null;

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2">
          <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-medium text-foreground">
            {title}
          </code>
          <span className="text-xs text-muted-foreground">
            {isPlatform ? "系统自带 · 只读" : "自定义 · 只读"}
          </span>
        </div>
      }
      open={open}
      onClose={onClose}
      width={560}
      destroyOnClose
    >
      {isLoading ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <Spin />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-red-50 px-4 py-3 text-sm text-destructive">
          加载失败：{errMessage(error, "网络错误")}
        </div>
      ) : content ? (
        <MarkdownText content={content} size="reading" />
      ) : (
        <div className="py-10 text-center text-sm text-muted-foreground">无内容</div>
      )}
    </Drawer>
  );
}
