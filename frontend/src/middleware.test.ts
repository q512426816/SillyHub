/**
 * task-01 验收证据：middleware UA 分流单测（FR-01 / R-02 / D-005 / R-07）。
 *
 * 覆盖：
 *  - 手机 UA → rewrite 到 /m/ 原 path（FR-01）
 *  - 桌面 UA → 不 rewrite
 *  - UA 为空 / 异常 → 默认桌面不 rewrite（R-02）
 *  - 平板（iPad / Android Tablet）→ 不 rewrite（D-005）
 *  - query 串保留
 *  - matcher 白名单不拦 /api 与 /_next（R-07）
 *
 * 判定依据：NextResponse.rewrite(url) 会在响应头写入 x-middleware-rewrite，
 * NextResponse.next() 不写该头。故断言该头即可判断是否 rewrite。
 *
 * import 风格对齐 lib/errors.test.ts（显式 import vitest，保持项目既有惯例）。
 */
import { describe, expect, it } from "vitest";

import { NextRequest } from "next/server";

import {
  config,
  default as middleware,
  isMobileUserAgent,
  rewriteToMobile,
} from "@/middleware";

// ---- 真实 UA 样本（取自常见设备，覆盖各分支）-------------------------------

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36";
const WINDOWS_PHONE_UA =
  "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36";
const BLACKBERRY_UA =
  "Mozilla/5.0 (BlackBerry; U; BlackBerry 9900; en) AppleWebKit/534.11+ (KHTML, like Gecko) Version/7.1.0.346 Mobile Safari/534.11+";

const DESKTOP_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36";
const MACOS_SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15";

const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const ANDROID_TABLET_UA =
  "Mozilla/5.0 (Linux; Android 12; SM-X800) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36";

// ---- 工具：构造带 UA 的 NextRequest ---------------------------------------

function makeReq(
  pathAndQuery: string,
  ua: string | null,
  baseUrl = "https://app.example.com",
): NextRequest {
  const headers: Record<string, string> = {};
  if (ua !== null) {
    headers["user-agent"] = ua;
  }
  return new NextRequest(`${baseUrl}${pathAndQuery}`, { headers });
}

/** 取 rewrite 目标 URL；未 rewrite 时返回 null。 */
function rewriteTarget(res: ReturnType<typeof rewriteToMobile>): string | null {
  return res.headers.get("x-middleware-rewrite");
}

// ---- isMobileUserAgent：判定核心 ------------------------------------------

describe("isMobileUserAgent", () => {
  it("识别 iPhone / Android 手机 / Windows Phone / BlackBerry 为移动", () => {
    expect(isMobileUserAgent(IPHONE_UA)).toBe(true);
    expect(isMobileUserAgent(ANDROID_PHONE_UA)).toBe(true);
    expect(isMobileUserAgent(WINDOWS_PHONE_UA)).toBe(true);
    expect(isMobileUserAgent(BLACKBERRY_UA)).toBe(true);
  });

  it("桌面 Chrome / macOS Safari 判定为非移动", () => {
    expect(isMobileUserAgent(DESKTOP_CHROME_UA)).toBe(false);
    expect(isMobileUserAgent(MACOS_SAFARI_UA)).toBe(false);
  });

  it("UA 为空 / null / undefined 一律判定为非移动（R-02 默认桌面）", () => {
    expect(isMobileUserAgent(null)).toBe(false);
    expect(isMobileUserAgent(undefined)).toBe(false);
    expect(isMobileUserAgent("")).toBe(false);
  });

  it("不可识别的爬虫 / 随机字符串判定为非移动（R-02）", () => {
    expect(isMobileUserAgent("some-random-bot/1.0")).toBe(false);
    expect(isMobileUserAgent("curl/8.0.1")).toBe(false);
  });

  it("iPad 判定为非移动（D-005 平板走桌面）", () => {
    expect(isMobileUserAgent(IPAD_UA)).toBe(false);
  });

  it("Android 平板（不含 Mobile）判定为非移动（D-005）", () => {
    expect(isMobileUserAgent(ANDROID_TABLET_UA)).toBe(false);
  });
});

// ---- rewriteToMobile：请求级判定 ------------------------------------------

describe("rewriteToMobile", () => {
  it("手机 UA 访问 /ppm/workbench 被 rewrite 到 /m/ppm/workbench（FR-01）", () => {
    const res = rewriteToMobile(makeReq("/ppm/workbench", IPHONE_UA));
    expect(rewriteTarget(res)).toBe(
      "https://app.example.com/m/ppm/workbench",
    );
  });

  it("Android 手机访问 /ppm/task-plans 被 rewrite", () => {
    const res = rewriteToMobile(makeReq("/ppm/task-plans", ANDROID_PHONE_UA));
    expect(rewriteTarget(res)).toBe("https://app.example.com/m/ppm/task-plans");
  });

  it("手机 UA 访问 /workspaces 被 rewrite", () => {
    const res = rewriteToMobile(makeReq("/workspaces", IPHONE_UA));
    expect(rewriteTarget(res)).toBe("https://app.example.com/m/workspaces");
  });

  it("手机 UA 访问 /login 被 rewrite", () => {
    const res = rewriteToMobile(makeReq("/login", ANDROID_PHONE_UA));
    expect(rewriteTarget(res)).toBe("https://app.example.com/m/login");
  });

  it("rewrite 保留 query 串", () => {
    const res = rewriteToMobile(
      makeReq("/ppm/problem-list?page=2&size=10", IPHONE_UA),
    );
    expect(rewriteTarget(res)).toBe(
      "https://app.example.com/m/ppm/problem-list?page=2&size=10",
    );
  });

  it("桌面 UA 不 rewrite（放行桌面路由）", () => {
    expect(rewriteTarget(rewriteToMobile(makeReq("/ppm/workbench", DESKTOP_CHROME_UA)))).toBeNull();
    expect(rewriteTarget(rewriteToMobile(makeReq("/workspaces", MACOS_SAFARI_UA)))).toBeNull();
  });

  it("UA 为空 / 异常不 rewrite（R-02）", () => {
    expect(rewriteTarget(rewriteToMobile(makeReq("/ppm/workbench", null)))).toBeNull();
    expect(rewriteTarget(rewriteToMobile(makeReq("/ppm/workbench", "")))).toBeNull();
    expect(
      rewriteTarget(rewriteToMobile(makeReq("/ppm/workbench", "curl/8.0.1"))),
    ).toBeNull();
  });

  it("平板 UA（iPad / Android Tablet）不 rewrite（D-005）", () => {
    expect(rewriteTarget(rewriteToMobile(makeReq("/ppm/workbench", IPAD_UA)))).toBeNull();
    expect(
      rewriteTarget(rewriteToMobile(makeReq("/ppm/workbench", ANDROID_TABLET_UA))),
    ).toBeNull();
  });
});

// ---- middleware 默认导出：包裹 rewriteToMobile -----------------------------

describe("middleware (default export)", () => {
  it("手机 UA → rewrite 到 /m/", () => {
    const res = middleware(makeReq("/login", IPHONE_UA));
    expect(rewriteTarget(res)).toBe("https://app.example.com/m/login");
  });

  it("桌面 UA → 放行", () => {
    const res = middleware(makeReq("/login", DESKTOP_CHROME_UA));
    expect(rewriteTarget(res)).toBeNull();
  });
});

// ---- config.matcher：白名单不拦 /api 与 /_next（R-07）----------------------
//
// Next.js matcher 是路径白名单：只有列出的路径模式才会进入 middleware。
// 这里验证 (1) 白名单精确为目标页 (2) /api 与 /_next 不被任何白名单模式命中。

/** 把 Next.js matcher 模式（含 :path*）近似编译成 RegExp 用于测试断言。 */
function compileMatcherPattern(pattern: string): RegExp {
  // 仅支持 /literal、/literal/:path* 两种本项目用到的形式
  const base = pattern.replace(/\/:path\*$/, "");
  const hasWildcard = pattern.endsWith("/:path*");
  // hasWildcard: base 或 base/...；否则精确等于 base
  const escaped = base.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return hasWildcard
    ? new RegExp(`^${escaped}(/.*)?$`)
    : new RegExp(`^${escaped}$`);
}

describe("config.matcher 白名单（R-07）", () => {
  const patterns: readonly string[] = config.matcher;

  it("白名单精确为 /ppm/*、/workspaces/*、/login", () => {
    expect([...patterns]).toEqual([
      "/ppm/:path*",
      "/workspaces/:path*",
      "/login",
    ]);
  });

  it("命中目标页面（手机才会进入 middleware 做分流）", () => {
    const regexes = patterns.map(compileMatcherPattern);
    const hitPaths = [
      "/ppm/workbench",
      "/ppm/task-plans",
      "/ppm/problem-list",
      "/workspaces",
      "/workspaces/foo",
      "/login",
    ];
    for (const p of hitPaths) {
      expect(regexes.some((re) => re.test(p))).toBe(true);
    }
  });

  it("不拦截 /api/**（R-07，避免吞掉后端代理请求）", () => {
    const regexes = patterns.map(compileMatcherPattern);
    expect(regexes.some((re) => re.test("/api/users"))).toBe(false);
    expect(regexes.some((re) => re.test("/api"))).toBe(false);
  });

  it("不拦截 /_next/** 与静态资源（R-07）", () => {
    const regexes = patterns.map(compileMatcherPattern);
    expect(regexes.some((re) => re.test("/_next/static/chunk.js"))).toBe(false);
    expect(regexes.some((re) => re.test("/favicon.ico"))).toBe(false);
  });

  it("不拦截 /daemon/**（后端 daemon 公开端点代理）", () => {
    const regexes = patterns.map(compileMatcherPattern);
    expect(regexes.some((re) => re.test("/daemon/install.sh"))).toBe(false);
  });
});
