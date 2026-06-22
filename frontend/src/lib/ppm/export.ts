/**
 * PPM 通用工具:Excel 导出下载。
 *
 * `apiFetch` 会强制把响应体当 JSON 解析,不适合 .xlsx 二进制流响应,
 * 故导出端点走独立 fetch + 浏览器触发保存。
 */
import { getApiBaseUrl } from "@/lib/api";
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
    const { refreshToken, setTokens, hydrated } = useSession.getState();
    if (refreshToken && hydrated) {
      const refreshResp = await fetch(`${url.origin}/api/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (refreshResp.ok) {
        const refreshPayload = (await refreshResp.json().catch(() => null)) as {
          access_token?: string | null;
          refresh_token?: string | null;
        } | null;
        if (refreshPayload?.access_token) {
          setTokens({
            accessToken: refreshPayload.access_token,
            refreshToken: refreshPayload.refresh_token ?? null,
          });
          // 用新 token 重试一次
          resp = await doFetch(refreshPayload.access_token);
        }
      }
    }

    // 仍然 401 → 清 session 跳 /login,与 apiFetch 行为对齐
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
