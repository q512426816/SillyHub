"use client";

/**
 * 会话附件 API 封装（2026-08-20-session-multimodal-attachments task-11）。
 *
 * - upload 走 multipart：apiFetch 的 JSON 通道不携带 FormData（body 被 Omit），
 *   故封装内用原生 fetch + useSession Bearer（上传不经代理，直连 API base）。
 * - remove / contentUrl 常规 REST。
 * - contentUrl 供 <img src> / 新窗查看：带 Bearer 的鉴权拉取由
 *   task-13 的 fetch→objectURL 路径处理；此 URL 形态供日志/降级场景。
 */

import { ApiError, getApiBaseUrl, safeUUID } from "@/lib/api";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { useSession } from "@/stores/session";
import type { components } from "@/lib/api-types";

export type AttachmentRead = components["schemas"]["AttachmentRead"];

function authHeaders(): Record<string, string> {
  const { accessToken } = useSession.getState();
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export async function uploadSessionAttachment(
  file: File,
  kind: "image" | "file",
): Promise<AttachmentRead> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const resp = await fetch(
    `${getApiBaseUrl()}/api/daemon/session-attachments`,
    { method: "POST", headers: authHeaders(), body: form },
  );
  if (!resp.ok) {
    // 413/415 等业务错误体是 {message}——透传给 toast。
    let message = `上传失败（${resp.status}）`;
    try {
      const body = (await resp.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* 非 JSON 错误体用状态码文案 */
    }
    throw new Error(message);
  }
  return (await resp.json()) as AttachmentRead;
}

export async function removeSessionAttachment(id: string): Promise<void> {
  const resp = await fetch(
    `${getApiBaseUrl()}/api/daemon/session-attachments/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: authHeaders() },
  );
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`删除失败（${resp.status}）`);
  }
}

/** 附件内容鉴权拉取（缩略图/预览用；返回 objectURL，调用方负责 revoke）。 */
export async function fetchAttachmentObjectUrl(id: string): Promise<string> {
  const resp = await fetch(
    `${getApiBaseUrl()}/api/daemon/session-attachments/${encodeURIComponent(id)}/content`,
    { headers: authHeaders() },
  );
  if (!resp.ok) throw new Error(`附件拉取失败（${resp.status}）`);
  return URL.createObjectURL(await resp.blob());
}

/**
 * 附件内容鉴权拉取（预览 Modal 用；返回 Blob，401 时单飞刷新重试一次，对齐 fetchFileBlob）。
 * 与 fetchAttachmentObjectUrl 的区别：本函数返回原始 Blob（docx/xlsx/md 渲染需 ArrayBuffer/text），
 * 且 401 时经 ensureFreshAccessToken 刷新后重试一次。
 */
export async function fetchAttachmentBlob(id: string): Promise<Blob> {
  const url = `${getApiBaseUrl()}/api/daemon/session-attachments/${encodeURIComponent(id)}/content`;
  const doFetch = (token: string | null) =>
    fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);

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
      code: "attachment_fetch_failed",
      message: `附件拉取失败（HTTP ${resp.status}）`,
      request_id: safeUUID(),
      details: null,
    });
  }
  return resp.blob();
}
