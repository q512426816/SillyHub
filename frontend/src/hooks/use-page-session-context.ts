/**
 * URL 派生页面上下文（2026-08-25-unified-floating-session task-07 / FR-6 / D-007）。
 *
 * v1 语义：**显式入口优先**——PPM 行按钮等入口直接携带 {page_key, project_id}
 * 唤起（startPreSession 第二参）；本 hook 只做无参唤起时的「页面级」默认感知
 * （pathname 前缀 → 展示标签），不读 searchParams（Next App Router 布局层
 * useSearchParams 需 Suspense 边界，v1 不引入；实体 id 的 URL 派生归 v2）。
 *
 * 纯派生 hook：不发请求、无副作用；非注册页面返回 { pageContext: null }。
 */
import { useMemo } from "react";
import { usePathname } from "next/navigation";

import type { FloatingPageContext } from "@/stores/floating-session";

/** 感知结果：pageContext 供创建轮上送（v1 仅显式入口非空）；label 供上下文条展示。 */
export interface PageSessionContext {
  pageContext: FloatingPageContext | null;
  /** 当前页面展示标签；null = 未注册页面（上下文条降级文案）。 */
  label: string | null;
}

/** pathname 前缀 → 页面标签注册表（v1 仅 PPM；新页面按页注册扩展）。 */
const PAGE_LABELS: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: "/ppm", label: "PPM · 项目管理" },
  { prefix: "/workspaces", label: "工作区" },
];

export function usePageSessionContext(): PageSessionContext {
  const pathname = usePathname();
  return useMemo(() => {
    const hit = PAGE_LABELS.find(
      (p) => pathname === p.prefix || pathname.startsWith(p.prefix + "/"),
    );
    // v1 无 URL 级实体派生：页面上下文只来自显式入口（store.pageContext）。
    return { pageContext: null, label: hit?.label ?? null };
  }, [pathname]);
}
