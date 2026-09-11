/**
 * 平台级文件中心 — 前端文件 API 封装。
 *
 * - ``uploadFile``：走 XHR（fetch 无原生上传进度），401 时经 ``ensureFreshAccessToken``
 *   刷新并重试一次（对齐 apiFetch 的单飞刷新语义）。用**相对路径**（``/api/file/upload``），
 *   走 Next.js rewrite proxy，与 ``apiFetch`` 一致——任意 origin（公网域名/内网/localhost）可达，
 *   不用绝对内网 IP（公网浏览器访问不到）。
 * - ``fetchFileMetaBatch``：走 ``apiFetch``（自带 401 refresh）。
 * - ``getFileDownloadUrl``：返回 ``/api/file/{id}`` 相对路径（供 FileViewer 预览/下载，走 rewrite proxy）。
 *
 * 依据：design.md §D-003/D-005 + tasks/task-07.md。
 */

import { ApiError, apiFetch, safeUUID } from "@/lib/api";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { useSession } from "@/stores/session";

export interface FileUploadResp {
  id: string;
  original_name: string;
  mime_type: string;
  size: number;
}

export interface FileMetaResp {
  id: string;
  original_name: string;
  mime_type: string;
  size: number;
  owner_type: string;
  owner_id: string | null;
}

export interface UploadFileOptions {
  owner_type?: string;
  owner_id?: string | null;
  onProgress?: (percent: number) => void;
  /** 注入 XHR 工厂（测试用），默认浏览器 XMLHttpRequest。 */
  xhrFactory?: () => XMLHttpRequest;
}

interface XhrLikeErrorPayload {
  code?: string;
  message?: string;
  request_id?: string | null;
  details?: unknown;
}

function buildUploadUrl(owner_type?: string, owner_id?: string | null): string {
  const params = new URLSearchParams();
  if (owner_type) params.set("owner_type", owner_type);
  if (owner_id) params.set("owner_id", owner_id);
  const qs = params.toString();
  return `/api/file/upload${qs ? `?${qs}` : ""}`;
}

function xhrUpload(
  url: string,
  file: File,
  token: string | null,
  onProgress: ((percent: number) => void) | undefined,
  xhrFactory: (() => XMLHttpRequest) | undefined,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = (xhrFactory ?? (() => new XMLHttpRequest()))();
    xhr.open("POST", url);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => reject(new Error("网络错误，上传失败"));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

function parseError(status: number, body: string): ApiError {
  let payload: XhrLikeErrorPayload = {};
  try {
    payload = JSON.parse(body) as XhrLikeErrorPayload;
  } catch {
    payload = {};
  }
  return new ApiError(status, {
    code: payload.code ?? "upload_failed",
    message: payload.message ?? `上传失败（HTTP ${status}）`,
    request_id: payload.request_id ?? null,
    details: payload.details ?? null,
  });
}

/**
 * 上传文件（multipart，XHR）。401 时刷新 token 并重试一次。
 * 返回后端 FileUploadResp。
 */
export async function uploadFile(
  file: File,
  options: UploadFileOptions = {},
): Promise<FileUploadResp> {
  const { owner_type, owner_id, onProgress, xhrFactory } = options;
  const url = buildUploadUrl(owner_type, owner_id ?? null);
  const requestId = safeUUID();

  let token = useSession.getState().accessToken ?? null;
  let resp = await xhrUpload(url, file, token, onProgress, xhrFactory);
  if (resp.status === 401) {
    // 单飞刷新（并发 401 由 token-refresh 模块级 inflight 保证只发一次）。
    const fresh = await ensureFreshAccessToken();
    if (fresh) {
      token = fresh;
      resp = await xhrUpload(url, file, token, onProgress, xhrFactory);
    }
  }
  if (resp.status === 401) {
    throw new ApiError(401, {
      code: "unauthorized",
      message: "登录已过期，请重新登录",
      request_id: requestId,
      details: null,
    });
  }
  if (resp.status !== 201 && resp.status !== 200) {
    throw parseError(resp.status, resp.body);
  }
  return JSON.parse(resp.body) as FileUploadResp;
}

/** 批量取文件元数据（前端回显用）。走 apiFetch（自带 401 refresh）。 */
export async function fetchFileMetaBatch(ids: string[]): Promise<FileMetaResp[]> {
  if (!ids.length) return [];
  return apiFetch<FileMetaResp[]>("/api/file/batch-meta", {
    method: "POST",
    json: { ids },
  });
}

/**
 * 按归属/上传者列文件元数据（task-13 / FR-06 借用方案查看）。
 *
 * 后端 ``GET /api/file/list``：query ``owner_type`` / ``owner_id`` / ``uploaded_by``
 * / ``limit``。业务人员「借用方案」用 ``owner_type="workspace"&owner_id=<ws_id>``
 * 列该工作空间借用 daemon 产出的方案文件。走 apiFetch（自带 401 refresh）。
 */
export interface ListFilesParams {
  owner_type?: string;
  owner_id?: string | null;
  uploaded_by?: string | null;
  limit?: number;
}

export async function listFiles(params: ListFilesParams = {}): Promise<FileMetaResp[]> {
  const query: Record<string, string | number> = {};
  if (params.owner_type) query.owner_type = params.owner_type;
  if (params.owner_id) query.owner_id = params.owner_id;
  if (params.uploaded_by) query.uploaded_by = params.uploaded_by;
  if (params.limit != null) query.limit = params.limit;
  return apiFetch<FileMetaResp[]>("/api/file/list", { query });
}

/** 文件下载/预览（GET /api/file/{id}，相对路径走 rewrite proxy，浏览器带 session 由后端鉴权）。 */
export function getFileDownloadUrl(id: string): string {
  return `/api/file/${id}`;
}

/** 软删文件（DELETE /api/file/{id} → 204；归属断言在后端，非本人文件 404）。 */
export async function deleteFile(id: string): Promise<void> {
  await apiFetch<void>(`/api/file/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * best-effort 回收孤儿头像文件（ql-20260911-019-1f01）：URL 为 /api/file/{uuid}
 * 形态时 fire-and-forget 软删——「上传成功但保存（PATCH）失败」路径的新文件即刻
 * 兜底回收；其余形态（外链/清除空串/null）不动。返回是否触发了删除。
 */
export function tryReclaimOrphanAvatarFile(url: string | null | undefined): boolean {
  if (!url || !url.startsWith("/api/file/")) return false;
  const id = url.slice("/api/file/".length);
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return false;
  void deleteFile(id).catch(() => {
    /* best-effort：失败留孤儿可接受（服务端换绑回收为主路径）。 */
  });
  return true;
}

/**
 * 取文件二进制（Blob）—— 带 Authorization 头，401 单飞刷新重试一次。
 *
 * 浏览器原生 ``<img src>`` / ``<a href>`` 不带 Authorization，而下载端点要 JWT 鉴权，
 * 直接用 URL 会 401。故图片预览/文件下载都经本函数取 Blob：图片转 objectURL 给 img，
 * 文件下载触发 ``<a download>``。
 */
export async function fetchFileBlob(id: string): Promise<Blob> {
  const path = `/api/file/${id}`;
  const doFetch = (token: string | null) =>
    fetch(path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);

  let token = useSession.getState().accessToken ?? null;
  let resp = await doFetch(token);
  if (resp.status === 401) {
    const fresh = await ensureFreshAccessToken();
    if (fresh) {
      token = fresh;
      resp = await doFetch(token);
    }
  }
  if (!resp.ok) {
    throw new ApiError(resp.status, {
      code: "download_failed",
      message: `下载失败（HTTP ${resp.status}）`,
      request_id: safeUUID(),
      details: null,
    });
  }
  return resp.blob();
}

/** 触发浏览器下载（fetch Blob → ``<a download>`` click → revoke）。 */
export async function downloadFile(id: string, filename: string): Promise<void> {
  const blob = await fetchFileBlob(id);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
