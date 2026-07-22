/**
 * task-01 / FR-01 / D-002@v2 / D-005 / R-02 / R-07 / R-09
 *
 * 移动端设备分流中间件：服务端按 UA 把移动请求 rewrite 到 /m/ 移动路由段，
 * 彻底消除首屏 FOUC 且地址栏 URL 不变（rewrite 不改地址栏）。
 *
 * 设计依据：design §5.1（D-002@v2）。
 * 关键约束：
 *  - 只在 matcher 命中的白名单页面生效（/ppm/*、/workspaces/*、/login），
 *    自然排除 /api、/_next、静态资源（R-07）。
 *  - UA 为空 / 异常 / 不可识别一律不 rewrite（默认桌面，R-02）。
 *  - 平板（iPad / Android Tablet）走桌面，不 rewrite（D-005）。
 *  - UA 检测用轻量正则，不引入重型 UA 库（R-09）。
 *  - 不读 cookie：(dashboard)/layout 是 client component，设备定型完全由本 middleware
 *    在服务端完成（D-002@v2）。
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 命中即「移动手机」的 UA 片段。仅收录明确属于手机的标识：
 *  - iPhone：iOS 手机（iPad 单独排除）
 *  - Android + Mobile：Android 手机（Android 平板不含 Mobile，单独排除）
 *  - Windows Phone
 *  - BlackBerry（含 BB10）
 *
 * 注意：iPad 在新版 iPadOS 上 UA 会伪装成 Macintosh，此处也显式排除，
 * 保证平板一律走桌面（D-005）。
 */
const MOBILE_UA_PATTERN =
  /(iphone|android(?=.*mobile)|windows phone|blackberry|bb10)/i;

/**
 * 显式排除的「平板」UA 片段。命中则强制走桌面（D-005）。
 *  - iPad：苹果平板（含 iPadOS 13+ 伪装成 Macintosh 的 UA，取 Macintosh + 触屏无法在 UA
 *    里可靠识别，故只按明文 iPad 字样排除；普通 Mac 桌面 UA 本就不含手机标识，不会误判）
 *  - Android 平板：明文出现 Android 但不含 Mobile（如 "Android ... Tablet" / "SM-T" / "Xoom"）
 *  - Windows 平板 / 触屏：Surface 等用 Windows NT，本就不含手机标识，无需特判
 */
const TABLET_UA_PATTERN = /(ipad|android(?!.*mobile))/i;

/**
 * 判定给定 UA 是否为「移动手机」（非平板）。
 *
 * 纯函数：不访问请求对象，便于单测直接覆盖。判定顺序：
 *   1. UA 为空 / 非字符串 → false（R-02 异常默认桌面）
 *   2. 先排除平板 → false（D-005）
 *   3. 再匹配手机标识 → true
 *
 * @param ua 请求头里的 user-agent 原始字符串，可能为 null/undefined/空串
 */
export function isMobileUserAgent(
  ua: string | null | undefined,
): boolean {
  // R-02：UA 缺失 / 异常一律默认桌面
  if (typeof ua !== "string" || ua.length === 0) {
    return false;
  }
  // D-005：平板先排除（Android 不含 Mobile 的平板 / iPad 一律走桌面）
  if (TABLET_UA_PATTERN.test(ua)) {
    return false;
  }
  return MOBILE_UA_PATTERN.test(ua);
}

/**
 * 按请求 UA 决定是否 rewrite 到 /m/ 移动路由段。
 *
 * 移动 UA → NextResponse.rewrite(new URL('/m' + pathname + search, req.url))；
 * 否则 → NextResponse.next()（桌面 / 平板 / 异常 UA 均放行走原路由）。
 *
 * rewrite 不会改变地址栏 URL（D-002@v2 同一 URL 原意），仅服务端把请求映射到 /m/ 路由段。
 */
export function rewriteToMobile(req: NextRequest): NextResponse {
  const ua = req.headers.get("user-agent");
  if (!isMobileUserAgent(ua)) {
    return NextResponse.next();
  }
  const { pathname, search } = req.nextUrl;
  // 拼装 /m + 原 pathname + query 串；search 已含 '?'（无 query 时为空串）
  const mobileUrl = new URL(`/m${pathname}${search}`, req.url);
  return NextResponse.rewrite(mobileUrl);
}

/**
 * 默认导出的 middleware 入口，由 Next.js 在 matcher 命中的路径上自动调用。
 */
export default function middleware(req: NextRequest): NextResponse {
  return rewriteToMobile(req);
}

/**
 * matcher 白名单：精确限定需做设备分流的目标页面。
 * 未列出的路径（/api、/_next、静态资源、/daemon、其它后台页）天然不被拦截（R-07）。
 */
export const config = {
  matcher: ["/ppm/:path*", "/workspaces/:path*", "/login"],
};
