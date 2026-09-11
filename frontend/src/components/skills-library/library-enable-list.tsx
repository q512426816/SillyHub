"use client";

/**
 * LibraryEnableList —— 技能库区块（变更 2026-09-11-skills-central-library /
 * task-04，全员可见）。
 *
 * 三源分组（design「技能库三源聚合列表」+ D-003）：
 * - 系统自带（sillyspec）/ 我的自定义（custom）：恒启用，无开关（不可 enable）；
 * - git 源：按 source_id 分组（组头=源 url 短显 + branch），逐技能启用开关
 *   （默认关，D-003——启用才进 bundle 分发）。
 *
 * 开关走 useToggleSkillEnable（乐观更新失败回滚，见 skill-source-api.ts）；
 * skill_key 含冒号（<source_id>:<目录名>），URL 编码在 api 层统一处理。
 *
 * 样式：FRONTEND_PAGE_STYLE.md §0.5——brand-* 语义阶 + antd Switch/Tag
 * （组件色走 ConfigProvider 预设），无手写 hex。
 */
import { useMemo } from "react";
import { Switch, Tag } from "antd";
import { Library } from "lucide-react";

import { SectionCard } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";
import { errMessage } from "@/lib/errors";
import {
  useSkillsLibrary,
  useToggleSkillEnable,
  type LibrarySkillItem,
  type SkillSourceRead,
} from "./skill-source-api";

/** source 徽标文案/色（git=brand 系不占用，用 antd 预设中性色区分三源）。 */
const SOURCE_BADGE: Record<LibrarySkillItem["source"], { label: string; color?: string }> = {
  sillyspec: { label: "系统自带" },
  custom: { label: "我的自定义", color: "cyan" },
  git: { label: "git", color: "purple" },
};

/** url 短显（剥 scheme；与 source-manage-card 同口径）。 */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** SkillRow props（抽具名 interface，对齐 server-card.tsx 先例）。 */
interface SkillRowProps {
  skill: LibrarySkillItem;
  onToggle: (skill: LibrarySkillItem, enabled: boolean) => void;
  pending: boolean;
}

/** 单行技能（三源同构渲染；git 才有开关，D-003）。 */
function SkillRow({ skill, onToggle, pending }: SkillRowProps) {
  const badge = SOURCE_BADGE[skill.source];
  return (
    <div
      className="flex items-center gap-3 border-b px-4 py-2.5 last:border-0 hover:bg-muted/25"
      data-testid={`library-skill-${skill.skill_key}`}
    >
      <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">
        {skill.name}
      </code>
      <Tag className="m-0 shrink-0" color={badge.color}>
        {badge.label}
      </Tag>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={skill.description}>
        {skill.description || "（无描述——AI 无法自动判断何时使用该技能）"}
      </span>
      {skill.source === "git" ? (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            size="small"
            checked={skill.enabled}
            disabled={pending}
            onChange={(checked) => onToggle(skill, checked)}
            aria-label={`启用技能 ${skill.name}`}
          />
          {skill.enabled ? "已启用" : "未启用"}
        </span>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">恒启用</span>
      )}
    </div>
  );
}

/** 分组头（git 组带源信息；sillyspec/custom 为固定组名）。 */
function GroupHeader({ title, extra }: { title: string; extra?: string }) {
  return (
    <div className="flex items-center gap-2 bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
      {extra && <span className="font-normal normal-case">{extra}</span>}
    </div>
  );
}

export function LibraryEnableList() {
  const { sources, skills, isLoading, isFetching, isError, error, refetch } = useSkillsLibrary();
  const toggleEnable = useToggleSkillEnable();

  // 三源分组：git 按 source_id 归组（组序=后端 sources 返回序，即源 id 升序），
  // sillyspec/custom 各自单组；组间顺序 sillyspec → custom → git（D-010 收集序同口径）。
  const groups = useMemo(() => {
    const sourceById = new Map(sources.map((s: SkillSourceRead) => [s.id, s]));
    const sillyspec: LibrarySkillItem[] = [];
    const custom: LibrarySkillItem[] = [];
    const gitBySource = new Map<string, LibrarySkillItem[]>();
    for (const sk of skills) {
      if (sk.source === "sillyspec") sillyspec.push(sk);
      else if (sk.source === "custom") custom.push(sk);
      else gitBySource.set(sk.source_id ?? "", [...(gitBySource.get(sk.source_id ?? "") ?? []), sk]);
    }
    const result: { key: string; title: string; extra?: string; items: LibrarySkillItem[] }[] = [];
    if (sillyspec.length > 0)
      result.push({ key: "sillyspec", title: "系统自带（sillyspec）", items: sillyspec });
    if (custom.length > 0)
      result.push({ key: "custom", title: "我的自定义技能", items: custom });
    for (const [sid, items] of gitBySource) {
      const src = sourceById.get(sid);
      result.push({
        key: `git-${sid}`,
        title: "git 技能源",
        extra: src ? `${shortUrl(src.url)} @ ${src.branch}${src?.enabled === false ? "（源已停用）" : ""}` : sid,
        items,
      });
    }
    return result;
  }, [sources, skills]);

  const handleToggle = (skill: LibrarySkillItem, enabled: boolean) => {
    // 乐观更新/回滚在 hook 内；此处吞错避免 unhandled rejection（UI 由回滚+重拉兜底）
    toggleEnable.mutate({ skillKey: skill.skill_key, enabled });
  };

  return (
    <SectionCard
      title="技能库（全部技能 + 按需启用）"
      extra={
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {isLoading ? "加载中..." : `${skills.length} 个技能`}
          </span>
          <button
            type="button"
            className="text-xs text-brand-600 hover:underline disabled:opacity-50"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? "刷新中..." : "刷新"}
          </button>
        </div>
      }
      bodyPadding="p-0"
      data-testid="skills-library-list"
    >
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">
        汇总系统自带、你的自定义与 git 源收录的全部技能；git 技能默认不启用，打开开关后
        重启守护进程即分发给你的 AI 助手。
      </p>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>
      ) : isError ? (
        <div className="px-4 py-6 text-sm text-destructive">
          加载技能库失败：{errMessage(error, "网络错误")}
        </div>
      ) : skills.length === 0 ? (
        <EmptyState
          icon={<Library className="h-5 w-5" />}
          title="技能库为空"
          description={<span>暂无任何技能；系统自带技能随部署提供，git 技能源由管理员配置。</span>}
        />
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            <GroupHeader title={g.title} extra={g.extra} />
            {g.items.map((sk) => (
              <SkillRow
                key={sk.skill_key}
                skill={sk}
                onToggle={handleToggle}
                pending={toggleEnable.isPending}
              />
            ))}
          </div>
        ))
      )}
    </SectionCard>
  );
}
