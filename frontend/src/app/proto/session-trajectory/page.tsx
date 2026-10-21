/**
 * dev-only 预览路由：会话轨迹（Trajectory，档 1）——
 * 2026-10-20-session-page-dsh-alignment。
 *
 * Server Component 只做一件事：请求时从 `frontend/.proto-staging/session-export.json`
 * 读真实导出（21 runs / 1271 logs），把 logs/runs 作为 props 交给客户端视图。
 * 这样 SSR 首屏就含完整 `role="grid"` 账本，静态快照/curl 也能验收；3.3 MB JSON
 * 只进 RSC 载荷，不在 JS bundle 里（没有 import 该 json）。
 *
 * 为什么不再用 `/__proto/session-export.json` 运行时 fetch：
 * 2026-10-21-proto-data-exposure-guard 已把真实会话数据迁出 `public/`（免鉴权
 * 静态服务面），原 URL 不再存在；SSR 读盘是唯一取数路径（见
 * ../session-redesign/staged-session-export.ts）。客户端视图保留该 URL 作为
 * 文件缺失时的旧约定兜底。
 *
 * 边界：dev-only——不进导航、不被生产页面引用、不加 middleware 守卫（与
 * /proto/session-redesign 同一边界，D-010）。
 */

import { TrajectoryProtoView } from "./trajectory-proto-view";
import { loadStagedSessionExport } from "../session-redesign/staged-session-export";

// 读盘取数：每次请求都读 staging 文件，避免构建期快照把真实内容固化。
export const dynamic = "force-dynamic";

export default function Page() {
  return <TrajectoryProtoView stagedExport={loadStagedSessionExport()} />;
}
