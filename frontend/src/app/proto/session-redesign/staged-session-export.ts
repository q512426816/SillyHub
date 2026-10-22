/**
 * staged session export 的服务端读取器 —— dev-only 预览用（2026-10-20-session-page-
 * dsh-alignment / D-010 / D-014 / D-017）。
 *
 * 为什么在服务端读而不是只在浏览器 fetch：
 *   - D-014 的交付物是「dev server 的 SSR 快照 → 内联 CSS → 剥 script」的静态 HTML，
 *     快照里没有 JS。若真实数据只在浏览器 `useEffect` 里取，导出稿（观感评审的唯一
 *     载体）就只剩一个「加载真实会话…」占位——用户看到的仍是空壳。
 *   - 因此页面（Server Component）在**请求时**从磁盘读一次导出文件，把 logs/runs
 *     作为 props 交给客户端视图；客户端视图在同一份数据上跑产品装配器
 *     （logsToTurns），SSR 与 hydrate 结果一致，静态快照含真实内容。
 *   - 3.3 MB JSON 只进 RSC 载荷，**不进 JS bundle**（没有 `import` 该 json）。
 *     2026-10-21-proto-data-exposure-guard：数据文件由 `public/__proto/` 迁至
 *     `frontend/.proto-staging/`（public/ 是免鉴权静态服务面，真实会话数据不得
 *     留驻；.proto-staging/ 被 gitignore 覆盖——不进 git 也不进构建产物，SSR
 *     读盘是唯一取数路径）。
 *
 * 容错：文件缺失/JSON 坏/形状不符 → 返回 null；客户端视图保持「加载真实会话…」
 * 占位不白屏（原 public URL 运行时 fetch 兜底已随迁移移除——数据不在可 fetch 面）。
 *
 * 边界：本文件含 node:fs，只允许 server component（page.tsx）import；客户端视图
 * 仅以 `import type` 引用 ./types.ts，不引入本文件。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { StagedSessionExport } from "./types";

/** staging 相对路径（Next dev 的 cwd 即 frontend 目录）。2026-10-21 迁出 public/（免鉴权静态服务面）→ .proto-staging/（gitignore 覆盖，不进构建）。 */
const STAGED_EXPORT_RELATIVE_PATH = [".proto-staging", "session-export.json"];

/**
 * 读一次 staged session export。返回值只受文件内容影响，不做缓存
 * （dev 预览页是 force-dynamic，单次请求多读一次 3.3 MB 也可接受）。
 */
export function loadStagedSessionExport(): StagedSessionExport | null {
  try {
    const file = path.join(process.cwd(), ...STAGED_EXPORT_RELATIVE_PATH);
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<StagedSessionExport> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.session || !Array.isArray(parsed.runs) || !Array.isArray(parsed.logs)) {
      return null;
    }
    return parsed as StagedSessionExport;
  } catch {
    // 文件未 staging / 读盘失败 / JSON 坏：占位符收场（fetch 兜底已随 public 迁移移除）。
    return null;
  }
}
