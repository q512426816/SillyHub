/**
 * PPM 通用工具:Excel 导出下载。
 *
 * `apiFetch` 会强制把响应体当 JSON 解析,不适合 .xlsx 二进制流响应,
 * 故导出端点走独立 fetch + 浏览器触发保存。
 */
import { getApiBaseUrl, safeUUID } from "@/lib/api";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { useSession } from "@/stores/session";

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
 * 下载指定导出端点为 Excel 文件。
 *
 * 401 时复刻 apiFetch 的 refresh+retry 一次逻辑(裸 fetch 不会自动刷新,
 * 否则 token 过期导出直接 401 AUTH_TOKEN_EXPIDED 抛出)。
 *
 * @param path 以 /api/ppm 开头的相对路径(走 next rewrite 或 SSR origin)
 * @param params 查询参数(过滤/分页条件)
 * @param filename 后端未返回 Content-Disposition 时的回退文件名
 */
export async function downloadExcel(
  path: string,
  params?: Record<string, unknown>,
  filename = "export.xlsx",
): Promise<void> {
  const url = new URL(path, getApiBaseUrl());
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        // 数组用重复 key 编码:?k=a&k=b (与 apiFetch 多值语义一致)
        if (v.length === 0) continue;
        url.searchParams.delete(k);
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const doFetch = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url.toString(), { headers });
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

  // 优先用服务端 Content-Disposition 里的文件名(支持中文+时间戳),
  // 解析失败才回退到调用方传入的 filename。
  const finalName =
    parseFilenameFromContentDisposition(resp.headers.get("Content-Disposition")) ||
    filename;
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

/**
 * 用 FormData 上传 Excel 到指定端点 (task-08)。
 *
 * 为什么不复用 `apiFetch`:
 * - `apiFetch` 强制 `accept: application/json` + `JSON.stringify(json)` body,
 *   既不支持 FormData body,也不适合上传场景;
 * - 上传需 `multipart/form-data`,且 **不设 Content-Type** — 由浏览器自动加
 *   `boundary=...`,手动设会破坏 boundary 导致后端解析失败。
 *
 * token 刷新逻辑与 `downloadExcel` 一致:401 → `ensureFreshAccessToken()` 单飞刷新
 * 重试一次,二次 401 清 session 跳 /login 并抛错。
 *
 * @param url 完整或相对路径(相对路径走 resolveUrl 同源/SSR 解析,与 downloadExcel 一致)
 * @param file 用户选择的 .xlsx File 对象,以字段名 "file" append 进 FormData
 * @returns 原始 Response,由调用方按需 `.json()` 解析(预览端点返回 JSON)
 */
export async function uploadExcelWithAuth(
  url: string,
  file: File,
): Promise<Response> {
  // 相对路径走与 downloadExcel 一致的 origin 解析(浏览器内走 next rewrite)。
  const resolved =
    url.startsWith("http") || typeof window === "undefined"
      ? new URL(url, getApiBaseUrl()).toString()
      : new URL(url, window.location.origin).toString();

  const doFetch = async (token: string | null): Promise<Response> => {
    // 不设 Content-Type — 让浏览器根据 FormData 自动加 multipart boundary。
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-request-id": safeUUID(),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const formData = new FormData();
    formData.append("file", file);
    return fetch(resolved, { method: "POST", headers, body: formData });
  };

  let { accessToken } = useSession.getState();
  let resp = await doFetch(accessToken);

  // 401 → refresh + retry once (downloadExcel / apiFetch 行为对齐)
  if (resp.status === 401) {
    const newToken = await ensureFreshAccessToken();
    if (newToken) {
      resp = await doFetch(newToken);
    }
    if (resp.status === 401) {
      useSession.getState().clear();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw new Error("上传失败:登录已过期,请重新登录");
    }
  }

  if (!resp.ok) {
    throw new Error(`上传失败:HTTP ${resp.status}`);
  }

  return resp;
}
