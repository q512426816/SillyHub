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
      url.searchParams.set(k, String(v));
    }
  }
  const { accessToken } = useSession.getState();
  const resp = await fetch(url.toString(), {
    headers: {
      accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
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
