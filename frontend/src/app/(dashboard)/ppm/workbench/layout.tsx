import type { ReactNode } from "react";

/**
 * workbench 路由布局 —— 强制 dynamic(每次 SSR 壳 HTML,不缓存)。
 *
 * workbench 是 "use client" 页(数据运行时 fetch),壳 HTML 只含 chunk 引用。
 * 默认 Next.js 把它当 static 预渲染,打 Cache-Control: s-maxage=31536000,
 * stale-while-revalidate,导致 rebuild 后浏览器/代理仍用旧 HTML 壳(引用旧
 * chunk,新功能如范围切换不显示)。
 *
 * force-dynamic 让壳 HTML 每次 SSR + Cache-Control no-store,浏览器始终拿
 * 最新 HTML(含最新 chunk 引用)。运行时行为不变(client fetch)。
 *
 * 注:route segment config(dynamic)只能在 Server Component export,
 * "use client" 的 page.tsx 不能,故放在本 server layout。
 */
export const dynamic = "force-dynamic";

export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return children;
}
