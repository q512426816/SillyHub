/**
 * PPM 通用工具:Excel 导出下载。
 *
 * `apiFetch` 会强制把响应体当 JSON 解析,不适合 .xlsx 二进制流响应,
 * 故导出端点走独立 fetch + 浏览器触发保存。
 */
import { getApiBaseUrl } from "@/lib/api";
import { useSession } from "@/stores/session";

/**
 * 下载指定导出端点为 Excel 文件。
 *
 * @param path 以 /api/ppm 开头的相对路径(走 next rewrite 或 SSR origin)
 * @param params 查询参数(过滤/分页条件)
 * @param filename 保存文件名
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
  const blob = await resp.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objUrl);
}
