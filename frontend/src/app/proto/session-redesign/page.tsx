import { SessionRedesignView } from "./view";
import { loadStagedSessionExport } from "./staged-session-export";

// 2026-10-22-review-risk-fixes：本页含真实会话导出的请求时读盘（loadStagedSessionExport），
// 必须显式动态渲染——Next 14 默认对无动态 API 的 Server Component 页做构建期静态预
// 渲染，会把当时在位的 .proto-staging/session-export.json 烘进构建产物（对齐
// ../session-trajectory/page.tsx 同款声明；staged-session-export.ts 头注口径落地）。
export const dynamic = "force-dynamic";

/**
 * dev-only 预览路由（v2 视觉）—— 2026-10-20-session-page-dsh-alignment / D-010 / D-017。
 *
 * Server Component 只做一件事：请求时把真实会话导出读成 props（SSR 快照因此含真实
 * 内容，静态导出稿无 JS 也能评审）。3.2 MB JSON 只进 RSC 载荷，不进 JS bundle；
 * 读盘失败时返回 null，客户端退化为运行时 fetch（见 view.tsx）。
 *
 * 边界：不进导航、不被生产页面引用、不受 middleware 守卫（D-010 故障面已登记）。
 */
export default function Page() {
  return <SessionRedesignView initialV2 stagedExport={loadStagedSessionExport()} />;
}
