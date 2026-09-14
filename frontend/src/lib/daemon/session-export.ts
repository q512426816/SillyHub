/**
 * 会话导出认证下载通道(2026-09-14-session-export task-05 / FR-01 / D-001@v1)。
 *
 * `apiFetch` 会强制把响应体当 JSON 解析,不适合导出端点的 .md 文本 / .zip 二进制
 * 流响应,故走裸 fetch POST + 浏览器触发保存。骨架照 `lib/ppm/export.ts`
 * downloadExcel(401 单飞刷新重试一次 + RFC5987 文件名解析 + blob 下载)同款新写,
 * 不 import / 不改动 ppm 文件(防 ppm 域回归,design 约束)。
 *
 * 刻意不接入 ./index 再导出(门户接线归 task-06,届时直接 import 本文件)。
 */
import type { components } from "@/lib/api-types";
import { getApiBaseUrl, safeUUID } from "@/lib/api";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { useSession } from "@/stores/session";

/**
 * 导出档位(task-08 起自 api-types 生成类型取值,单一源后端 schema,禁止手写):
 * - "chat": Markdown 对话档(单会话 .md / 多会话 zip 内每会话一个 .md)
 * - "full": JSON+附件 zip 档(每会话一目录:full.json + attachments/)
 */
export type SessionExportTier = components["schemas"]["SessionExportRequest"]["tier"];

/** 导出端点(POST,body JSON { session_ids, tier })。 */
const EXPORT_PATH = "/api/daemon/sessions/export";

/**
 * 从 Content-Disposition 头解析服务端返回的文件名。
 *
 * 后端用 RFC 5987 格式 `filename="ascii_fallback"; filename*=UTF-8''<percent-encoded>`
 * 传中文文件名(直接放中文会触发 latin-1 编码报错)。
 *
 * @returns 解析失败返回 null,调用方应回退到传入的 fallback filename
 */
function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  // 优先 filename*=UTF-8''<encoded>(支持中文/特殊字符)
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // fallthrough
    }
  }
  // 回退 filename="..."(ASCII)
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain?.[1] ?? null;
}

/**
 * 导出选中会话并触发浏览器下载。
 *
 * POST /api/daemon/sessions/export,body 与后端 SessionExportRequest 同形
 * ({ session_ids, tier },snake_case);响应矩阵:chat 单会话 text/markdown、
 * 其余 application/zip,Content-Disposition 全 RFC5987 中文文件名(design 响应矩阵)。
 *
 * 401 时复刻 apiFetch 的 refresh+retry 一次逻辑(裸 fetch 不会自动刷新,
 * 与 downloadExcel 行为逐段对齐);二次 401 清 session 跳 /login 并抛错。
 * 其余非成功状态码抛含 HTTP status 的 Error——本 lib 层不弹 toast,失败反馈
 * (message.error)归组件层(design FR-04)。
 *
 * @param sessionIds 要导出的会话 id 列表(1~50 个,数量/权限校验归后端 422/404)
 * @param tier 导出档位:chat=Markdown 对话档,full=JSON+附件 zip 档
 */
export async function exportSessions(
  sessionIds: string[],
  tier: SessionExportTier,
): Promise<void> {
  const url = new URL(EXPORT_PATH, getApiBaseUrl());

  // accept 按 tier + 会话数声明预期产物(design 响应矩阵):
  // full 档恒 zip;chat 档单会话 .md、多会话 zip。
  const accept =
    tier === "full" || sessionIds.length > 1
      ? "application/zip"
      : "text/markdown";

  const doFetch = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      accept,
      "content-type": "application/json",
      // x-request-id 对齐 apiFetch / uploadExcelWithAuth 惯例(服务端日志按请求关联)
      "x-request-id": safeUUID(),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({ session_ids: sessionIds, tier }),
    });
  };

  let { accessToken } = useSession.getState();
  let resp = await doFetch(accessToken);

  // 401 → refresh + retry once(apiFetch 行为对齐)
  if (resp.status === 401) {
    // 单飞刷新:与 apiFetch 共享同一 inflight,并发导出 + 普通 API 401 只发 1 次 refresh。
    // 单飞成功后已写回 store,这里直接用返回的新 access token 重试。
    const newToken = await ensureFreshAccessToken();
    if (newToken) {
      resp = await doFetch(newToken);
    }

    // 仍然 401(单飞失败 / 二次 401)→ 清 session 跳 /login,与 apiFetch 行为对齐
    if (resp.status === 401) {
      useSession.getState().clear();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw new Error("导出失败:登录已过期,请重新登录");
    }
  }

  if (!resp.ok) {
    throw new Error(`导出失败:HTTP ${resp.status}`);
  }

  // 优先用服务端 Content-Disposition 里的文件名(RFC5987 中文+时间戳),
  // 解析失败才回退到按档位拼的 fallback 文件名。
  const fallback = tier === "chat" ? "会话导出_对话.zip" : "会话导出_完整.zip";
  const finalName =
    parseFilenameFromContentDisposition(resp.headers.get("Content-Disposition")) ||
    fallback;
  const blob = await resp.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objUrl);
}
