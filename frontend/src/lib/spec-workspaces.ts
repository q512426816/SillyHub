/**
 * Spec Workspace API client. Mirrors backend spec_workspace endpoints.
 */
import { apiFetch, ApiError, safeUUID } from "@/lib/api";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { useSession } from "@/stores/session";

export type SpecStrategy = "platform-managed" | "repo-mirrored" | "repo-native";
export type SyncStatus = "pending" | "clean" | "dirty" | "conflicted";

export interface SpecWorkspace {
  id: string;
  workspace_id: string;
  spec_root: string;
  strategy: SpecStrategy;
  repo_sillyspec_path: string | null;
  profile_version: string;
  sync_status: SyncStatus;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getSpecWorkspace(
  workspaceId: string,
): Promise<SpecWorkspace> {
  return apiFetch<SpecWorkspace>(
    `/api/workspaces/${workspaceId}/spec-workspace`,
  );
}

/**
 * PATCH /api/workspaces/{workspaceId}/spec-workspace — 修改 spec 工作区可维护字段。
 *
 * 三字段全部可选（omit 不改）。strategy 值域 SpecStrategy 三值，非法值后端
 * Pydantic Literal 422。改 strategy 对后续派发实时生效（backend dispatch/init
 * 每次从 spec_workspaces 读库），但 daemon 本地缓存布局（repo-native junction /
 * repo-mirrored 首拷）要等下次无条件 pull（初始化按钮）才重建。
 */
export interface SpecWorkspaceUpdateInput {
  strategy?: SpecStrategy;
  repo_sillyspec_path?: string | null;
  profile_version?: string;
}

export async function updateSpecWorkspace(
  workspaceId: string,
  input: SpecWorkspaceUpdateInput,
): Promise<SpecWorkspace> {
  return apiFetch<SpecWorkspace>(
    `/api/workspaces/${workspaceId}/spec-workspace`,
    { method: "PATCH", json: input },
  );
}

export type ImportPhase =
  | "packing"
  | "packed"
  | "applying"
  | "reparsing_docs"
  | "reparsing_changes"
  | "done"
  | "error";

export interface ImportSseHandlers {
  onProgress?: (phase: ImportPhase, data?: Record<string, unknown>) => void;
}

/**
 * 流式导入 spec（D-001 SSE，2026-07-01-spec-import-async-and-change-reparse）。
 *
 * POST /import 返回 text/event-stream，分阶段推 packing/packed/applying/
 * reparsing_docs/reparsing_changes/done/error。原生 fetch + ReadableStream 解析
 * （不复用 apiFetch——它 JSON parse）；error 事件 → throw ApiError；done → resolve。
 * 调用方通过 onProgress 更新阶段进度 UI，done 后自行刷新 spec_ws + 变更中心。
 */
export async function importSpecWorkspace(
  workspaceId: string,
  handlers: ImportSseHandlers = {},
): Promise<void> {
  const { onProgress } = handlers;
  const { accessToken } = useSession.getState();
  const resp = await fetch(
    `/api/workspaces/${workspaceId}/spec-workspace/import`,
    {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    },
  );
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    let payload: { code?: string; message?: string } | null = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    throw new ApiError(resp.status, {
      code: payload?.code ?? "import_failed",
      message: payload?.message ?? `导入失败 (HTTP ${resp.status})`,
      request_id: null,
      details: null,
    });
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block: string): void => {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(":")) return; // keepalive / comment
    let event = "";
    let dataStr = "";
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) dataStr = line.slice(6);
    }
    if (!event) return;
    let data: Record<string, unknown> = {};
    if (dataStr) {
      try {
        data = JSON.parse(dataStr) as Record<string, unknown>;
      } catch {
        data = { raw: dataStr };
      }
    }
    const phase = event as ImportPhase;
    onProgress?.(phase, data);
    if (phase === "error") {
      throw new ApiError(0, {
        code: (data.code as string) ?? "import_error",
        message: (data.message as string) ?? "导入失败",
        request_id: null,
        details: null,
      });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) flush(block);
  }
  if (buffer.trim()) flush(buffer);
}

export interface GenerateProjectsResult {
  generated_files: number;
  reparse: {
    parsed: number;
    created: number;
    updated: number;
    deleted: number;
  };
  children: { id: string; name: string; component_key: string; slug: string }[];
}

export async function generateProjects(
  workspaceId: string,
): Promise<GenerateProjectsResult> {
  return apiFetch<GenerateProjectsResult>(
    `/api/workspaces/${workspaceId}/generate-projects`,
    { method: "POST" },
  );
}

// ── Init dispatch (D-002/D-009, task-08) ──

export interface InitDispatchResult {
  lease_id: string;
  runtime_id: string;
  claim_token: string;
}

/**
 * POST /api/workspaces/{workspaceId}/init — dispatch an init-mode
 * interactive lease to the current member's daemon.  The daemon writes
 * `.sillyspec-platform.json` and pulls the latest spec bundle.
 */
export async function initDispatch(
  workspaceId: string,
): Promise<InitDispatchResult> {
  return apiFetch<InitDispatchResult>(
    `/api/workspaces/${workspaceId}/init`,
    { method: "POST" },
  );
}

// ── Sync Manual (D-012, task-13/14) ──

export interface SyncManualResult {
  status: "pending" | "done";
  task_id?: string;
}

/**
 * POST /api/workspaces/{workspaceId}/spec-workspace/sync-manual
 *
 * 「同步到服务器」手动按钮入口。建 kind=spec-sync 的 DaemonChangeWrite
 * outbox 行，返 {"status": "pending", "task_id": "uuid"}。
 */
export async function syncManual(
  workspaceId: string,
): Promise<SyncManualResult> {
  return apiFetch<SyncManualResult>(
    `/api/workspaces/${workspaceId}/spec-workspace/sync-manual`,
    { method: "POST" },
  );
}

// PendingSyncItem 对齐后端 sync_manual_get_pending 返回字段（design FR-01 / Wave 1：
// 修复既有 schema 漂移——旧类型 id/workspace_id/change_key/kind 与后端 task_id/error/
// completed_at 完全脱节）。files_total/files_processed 由 Wave 3 task-09 补。
export interface PendingSyncItem {
  task_id: string;
  status: string;
  runtime_id: string;
  /** 失败原因（status=failed 时后端 DaemonChangeWrite.error 透传，FR-01）。 */
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
  /** 同步进度计数（FR-05/FR-06，D-004 单一写者=progress 端点）。 */
  files_total?: number | null;
  files_processed?: number | null;
}

/**
 * GET /api/workspaces/{workspaceId}/spec-workspace/sync-manual/pending
 *
 * 查询 workspace 下所有 kind="spec-sync" 的 pending 行。
 * 按 created_at desc 返回，前端取最新一条判定进度。
 */
export async function listPendingSync(
  workspaceId: string,
): Promise<PendingSyncItem[]> {
  return apiFetch<PendingSyncItem[]>(
    `/api/workspaces/${workspaceId}/spec-workspace/sync-manual/pending`,
  );
}

// ── Bundle download (task-09, 2026-08-29-change-delete-closure-and-spec-pull) ──

/** downloadSpecBundle 返回：Blob + Content-Disposition 文件名 + X-Spec-Version 快照版本。 */
export interface SpecBundleDownload {
  blob: Blob;
  /** 下载落盘文件名（Content-Disposition 解析值，缺失时回退 spec-bundle-{wsId}.tar）。 */
  filename: string;
  /** 快照版本号（X-Spec-Version 头，供 toast 一次性展示；缺失/非法 → null，R-07 不常驻展示）。 */
  specVersion: number | null;
}

/** 从 `attachment; filename="..."` 解析文件名（支持引号/裸 token 两种形态）。 */
function parseDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:"([^"]+)"|([^;]+))/i.exec(header);
  const name = (match?.[1] ?? match?.[2] ?? "").trim();
  return name || null;
}

/**
 * GET /api/workspaces/{workspaceId}/spec-workspace/bundle — 下载服务器 spec 整树
 * 快照 tar（FR-06/FR-08，design §7.2/§7.3）。
 *
 * 鉴权 blob 范式（照 lib/explorer.ts fetchDownload / lib/file/api.ts
 * fetchFileBlob 先例）：裸 fetch + Authorization Bearer（浏览器 ``<a href>``
 * 直连不带 JWT 会 401），401 时单飞刷新 token 重试一次（并发 401 由
 * token-refresh 模块级 inflight 保证只发一次）；非 2xx 抛 ApiError。
 *
 * 拿到 Blob 后转 objectURL → ``<a download>`` click → finally revoke
 * （downloadExplorerFile / downloadFile 范式，对齐知识库 D-009 blob 生命周期
 * 托管，防 objectURL 泄漏）。文件名取响应 Content-Disposition，缺失回退
 * ``spec-bundle-{workspaceId}.tar``；specVersion 读 X-Spec-Version 头返回
 * 给调用方（成功 toast 一次性展示快照版本）。
 *
 * 语义：人拉=主动快照（design §7.4），即时 HTTP 拉流——不建 DaemonChangeWrite
 * 任务、不轮询，与 syncManual 的任务化推送是两条独立链路。
 */
export async function downloadSpecBundle(
  workspaceId: string,
): Promise<SpecBundleDownload> {
  const url = `/api/workspaces/${workspaceId}/spec-workspace/bundle`;
  const doFetch = (token: string | null) =>
    fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);

  let token = useSession.getState().accessToken ?? null;
  let resp = await doFetch(token);
  if (resp.status === 401) {
    // 单飞刷新（并发 401 由 token-refresh 模块级 inflight 保证只发一次）。
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

  const filename =
    parseDispositionFilename(resp.headers.get("Content-Disposition")) ??
    `spec-bundle-${workspaceId}.tar`;
  // X-Spec-Version 是数字字符串（backend str(spec_version)）；空串/缺失/非数字 → null。
  const versionRaw = resp.headers.get("X-Spec-Version");
  const specVersion =
    versionRaw && Number.isFinite(Number(versionRaw)) ? Number(versionRaw) : null;
  const blob = await resp.blob();

  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return { blob, filename, specVersion };
}

