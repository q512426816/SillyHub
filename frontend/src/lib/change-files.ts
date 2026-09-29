import { ApiError, apiFetch, safeUUID } from "./api";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { useSession } from "@/stores/session";

// ── Types（对齐 backend change/schema.py file tree DTOs）──────────────

export type ChangeFileEntry = {
  path: string; // 相对变更目录 posix，如 "tasks/task-01.md"
  name: string;
  size: number;
  last_modified_at: string | null;
  is_text: boolean;
};

export type ChangeFileList = {
  change_id: string;
  items: ChangeFileEntry[];
};

export type ChangeFileContent = {
  path: string;
  content: string | null;
  exists: boolean;
};

export type ChangeFileWriteRequest = {
  path: string;
  content: string;
};

export type ChangeFileWriteResponse = {
  status: "done" | "pending";
  task_id?: string | null;
};

export type PendingFileEntry = {
  path: string;
  status: "pending" | "claimed";
  created_at: string;
};

export type PendingFileList = {
  items: PendingFileEntry[];
};

export type ChangeFileTreeNode = {
  name: string;
  path: string;
  doc?: ChangeFileEntry;
  children: ChangeFileTreeNode[];
};

// ── API 封装 ──────────────────────────────────────────────────────────

export function listChangeFiles(workspaceId: string, changeId: string) {
  return apiFetch<ChangeFileList>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/files`,
  );
}

export function getChangeFileContent(
  workspaceId: string,
  changeId: string,
  path: string,
) {
  return apiFetch<ChangeFileContent>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/files/content?path=${encodeURIComponent(path)}`,
  );
}

export function saveChangeFileContent(
  workspaceId: string,
  changeId: string,
  path: string,
  content: string,
) {
  return apiFetch<ChangeFileWriteResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/files/content`,
    {
      method: "POST",
      json: { path, content } satisfies ChangeFileWriteRequest,
    },
  );
}

export function listPendingChangeFiles(workspaceId: string, changeId: string) {
  return apiFetch<PendingFileList>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/files/pending`,
  );
}

/**
 * 取变更文件原始字节（GET .../files/raw?path=）——裸 fetch 带 Bearer 头取
 * ``Blob``，401 单飞刷新重试一次，失败抛 ``ApiError``（范式对齐 explorer.ts
 * ``fetchDownload``：apiFetch 是 JSON 封装，不适用二进制流）。调用方按
 * ``blob.type`` 分发渲染器（预览恒走 raw 端点，design D-009）。
 */
export async function fetchChangeFileRaw(
  workspaceId: string,
  changeId: string,
  path: string,
): Promise<Blob> {
  const url =
    `/api/workspaces/${workspaceId}/changes/${changeId}/files/raw` +
    `?path=${encodeURIComponent(path)}`;
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
      code: "raw_fetch_failed",
      message: `文件拉取失败（HTTP ${resp.status}）`,
      request_id: safeUUID(),
      details: null,
    });
  }
  return resp.blob();
}

// ── 文件树构造（task-09 / FR-09）──────────────────────────────────────

/**
 * 将扁平文件清单按 path 构建为目录树。
 *
 * change 文件 path 相对变更目录（如 "tasks/task-01.md"），按 "/" split 建树，
 * 目录优先 + 字母序排序。
 */
export function buildChangeFileTree(items: ChangeFileEntry[]): ChangeFileTreeNode[] {
  const root: ChangeFileTreeNode = { name: "", path: "", children: [] };
  for (const doc of items) {
    const parts = doc.path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isFile = i === parts.length - 1;
      const existing = current.children.find((c) => c.name === part);
      if (existing) {
        current = existing;
      } else {
        const newNode: ChangeFileTreeNode = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          children: [],
        };
        current.children.push(newNode);
        current = newNode;
      }
      if (isFile) {
        current.doc = doc;
      }
    }
  }
  const sortNodes = (nodes: ChangeFileTreeNode[]): ChangeFileTreeNode[] =>
    nodes
      .sort((a, b) => {
        const af = a.doc !== undefined;
        const bf = b.doc !== undefined;
        if (af !== bf) return af ? 1 : -1; // 目录（无 doc）优先
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({ ...n, children: sortNodes(n.children) }));
  return sortNodes(root.children);
}

// ── 固定产物中文名（2026-09-29-change-detail-timeline-files-polish）─────

/**
 * SillySpec 变更目录固定产物文件名 → 中文名。按 basename 精确匹配（目录
 * 位置无关）；非固定名（截图、临时复现页等）返回 null 由调用方回落原名。
 * 名单依据近三日 49 个变更目录统计（≥7 次出现的固定件）。
 */
const CHANGE_FILE_CN: Record<string, string> = {
  "proposal.md": "变更提案",
  "requirements.md": "需求规格",
  "design.md": "设计方案",
  "tasks.md": "任务清单",
  "decisions.md": "决策记录",
  "flow-state.yaml": "流程状态",
  "change.patch": "代码补丁",
  "change-patch.json": "补丁清单",
  "review.json": "评审记录",
  "verify-result.md": "验证结果",
  "test-trace.json": "测试轨迹",
  "visual-evidence.md": "视觉证据",
  "watcher-events.jsonl": "观测事件流",
  "timeline.md": "时间线记录",
};

/** 文件名（或含路径）→ 中文名；非固定产物返回 null。 */
export function changeFileCnName(name: string): string | null {
  const basename = name.split("/").pop() ?? name;
  return CHANGE_FILE_CN[basename] ?? null;
}

