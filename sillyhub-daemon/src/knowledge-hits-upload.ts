// sillyhub-daemon/src/knowledge-hits-upload.ts
// 2026-09-20-knowledge-effect-panel task-02 / D-003@v1（daemon 上行通道）+ D-007@v1
//（幂等交服务端 hash 去重）：daemon 知识命中遥测增量上报。
//
// 数据源：spec 目录 `.runtime/knowledge-hits.jsonl`（sillyspec CLI 注入命中时
// append 的原始 jsonl 行）。仅本地读取——UPLOAD_EXCLUDE_TOP_BASE 已把 .runtime/
// 整体排除出 spec 上传链路（task-07），本模块不动该排除语义，hits 不随 spec tar 上行。
//
// 断点（R-01）：offset 记「已上行的完整行数」，存 daemon 家目录状态文件
// `~/.sillyhub/daemon/.hits-upload-state-{wsId}.json`（不落 spec 树——pull 的整树
// 交换会清掉 specDir，对齐 manifests/{ws}.json 移出 specDir 的 BL-4/R-03 先例；
// SILLYHUB_DAEMON_DIR 隔离时随 daemonStateDir() 一并重定向）。只报**以 \n 结尾的
// 完整行**——上报窗口内 CLI 正 append 的尾行（无换行）留下轮补，防半行截断。
//
// 分批（R-06）：每批 ≤2000 行（backend HitsBatchIn HITS_BATCH_MAX_LINES 同值），
// 每批成功即原子写 offset（writeFileAtomic），后续批次失败时前批进度不丢。
//
// best-effort（R-05）：全程 try/catch，任何失败 warn 一次即 return（不抛、不动
// offset——失败批下轮重试，重报由 backend (workspace_id, line_hash) 唯一约束
// DO NOTHING 去重兜底）。挂点在 spec-sync postSpecSync 成功汇聚点，失败不阻塞
// 同步主流程。
//
// mock/旧客户端容错：client 未实现 postKnowledgeHitsBatch（hub-client task-02
// 前的旧实例 / 测试部分 mock）→ 静默 no-op（对齐 spec-sync `typeof client.postSpecSync
// !== 'function'` 先例，不产日志噪音）。

import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { HubClient } from './hub-client.js';
import { daemonStateDir } from './config.js';
import { writeFileAtomic } from './atomic-write.js';

/** hits 遥测文件相对 spec 目录路径（CLI append 端点，只读不改）。 */
const HITS_REL_PATH = join('.runtime', 'knowledge-hits.jsonl');

/** 单批最大行数（backend HitsBatchIn 上限同值，422 越界由服务端兜底校验）。 */
const HITS_BATCH_MAX_LINES = 2000;

/** offset 状态文件结构（daemon 家目录，schema version 0 起即此形态）。 */
interface HitsUploadState {
  /** 已成功上行的完整行数（下次从此处继续）。 */
  uploadedLines: number;
  /** 最近一次前进时间（ISO，诊断用，不参与逻辑）。 */
  updated_at: string;
}

/**
 * 上报客户端最小结构面（duck-type）。真实 HubClient task-02 起自带
 * postKnowledgeHitsBatch；mock / 旧实例缺该方法时 uploadKnowledgeHitsIfNeeded
 * 静默 no-op。单列 interface 而非直接引用 HubClient 方法签名，测试可注入
 * `{ postKnowledgeHitsBatch: vi.fn() }` 形态的最小替身（照 spec-sync makeClient 先例）。
 */
interface KnowledgeHitsPoster {
  postKnowledgeHitsBatch(
    wsId: string,
    lines: string[],
  ): Promise<{ ingested: number; skipped_bad: number; duplicates: number }>;
}

/**
 * offset 状态文件路径（daemon 家目录 `.hits-upload-state-{wsId}.json`）。
 * 导出供测试断言；wsId 含路径分隔符时由调用侧守卫（见 uploadKnowledgeHitsIfNeeded）。
 */
export function hitsUploadStatePath(wsId: string): string {
  return join(daemonStateDir(), `.hits-upload-state-${wsId}.json`);
}

/**
 * 读 offset 状态；不存在 / 坏 JSON / 形状不符 → 0（视为从未上报，全量重报由
 * 服务端 hash 去重兜底，不因状态文件损坏永久卡死增量）。
 */
async function readUploadedLines(wsId: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(hitsUploadStatePath(wsId), 'utf-8');
  } catch {
    return 0; // 首轮（ENOENT）或不可读
  }
  try {
    const obj = JSON.parse(raw) as { uploadedLines?: unknown };
    if (typeof obj.uploadedLines === 'number' && Number.isInteger(obj.uploadedLines) && obj.uploadedLines >= 0) {
      return obj.uploadedLines;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * 原子写 offset 状态（tmp+rename，见 atomic-write.ts）。失败上抛由调用方
 * best-effort catch（状态写失败但批已上行——本轮 warn，下轮重报该批，hash 去重兜底）。
 */
async function writeUploadedLines(wsId: string, n: number): Promise<void> {
  const state: HitsUploadState = { uploadedLines: n, updated_at: new Date().toISOString() };
  const p = hitsUploadStatePath(wsId);
  // 建父目录（对齐 writeLocalManifest 先例；daemonStateDir 常态已存在，防御首写）。
  await mkdir(dirname(p), { recursive: true });
  await writeFileAtomic(p, JSON.stringify(state, null, 2) + '\n');
}

/**
 * 把 jsonl 文件原文拆成**完整行**数组：末尾无 \n 的尾行（CLI 正在 append 的半行）
 * 不计入（R-01）。`"a\nb\n"` → `["a","b"]`；`"a\nb"` → `["a"]`；空文件 → `[]`。
 * 纯函数。
 */
export function splitCompleteLines(raw: string): string[] {
  if (raw.length === 0) return [];
  const parts = raw.split('\n');
  // split 尾元素：文件以 \n 结尾时是空串（丢弃），否则是未写完的半行（留下轮）。
  return parts.slice(0, -1);
}

/**
 * daemon 知识命中增量上报（postSpecSync 成功汇聚点 best-effort 钩子调用）。
 *
 * 流程：
 *   1. mock/旧客户端容错：无 postKnowledgeHitsBatch 方法 → 静默 return。
 *   2. 读 `${specDir}/.runtime/knowledge-hits.jsonl`；不存在 → 静默 return
 *      （无命中数据的工作区是常态，零日志噪音）。
 *   3. 读 offset（家目录状态文件）；拆完整行；offset ≥ 完整行数 → return（无新行）。
 *   4. 分批 ≤2000 行 POST hits/batch（body 的 daemon_local_id 由 client 自带
 *      ——register/heartbeat 记住的 config.runtime_id）；每批成功原子写新 offset。
 *
 * 失败语义：任何一步抛错（读盘/网络/HTTP 非 2xx/状态写失败）→ warn 一次并 return，
 * **不抛**（同步主流程不受影响，R-05）；offset 只在批成功后前进，失败批下轮重试，
 * 服务端 (workspace_id, line_hash) 去重兜底幂等（D-007）。
 *
 * @param client  HubClient（或 duck-type 最小替身；缺 postKnowledgeHitsBatch 即 no-op）
 * @param wsId    workspace id（同时是状态文件名段；含路径分隔符时防御性拒绝）
 * @param specDir 本地 spec 目录（resolveSpecDir(wsId)；repo-native junction 同样适用）
 */
export async function uploadKnowledgeHitsIfNeeded(
  client: HubClient,
  wsId: string,
  specDir: string,
): Promise<void> {
  try {
    // mock/旧客户端容错（spec-sync 同款惯例）：无方法 → 静默 no-op。
    const poster = client as unknown as Partial<KnowledgeHitsPoster>;
    if (typeof poster.postKnowledgeHitsBatch !== 'function') return;

    // 防御：wsId 进状态文件名，拒绝路径分隔符（正常是 UUID，同 resolveSpecDir E-07）。
    if (!wsId || /[\\/]/.test(wsId)) {
      console.warn('knowledge_hits_upload: invalid_ws_id', JSON.stringify(wsId));
      return;
    }

    // 读 hits 文件；不存在 → 静默 no-op（常态路径，零噪音）。
    let raw: string;
    try {
      raw = await readFile(join(specDir, HITS_REL_PATH), 'utf-8');
    } catch {
      return;
    }

    const completeLines = splitCompleteLines(raw);
    let uploadedLines = await readUploadedLines(wsId);
    // 外部截断/替换 hits 文件（如手动清理）时状态可能超前——钳到当前行数并**立即
    // 固化**，否则每轮都空转在钳位上、append 后增量永久卡死；固化后从文件现行数
    // 续走（钳位轮无上行，append 的新行下轮正常报）。
    if (uploadedLines > completeLines.length) {
      uploadedLines = completeLines.length;
      await writeUploadedLines(wsId, uploadedLines);
    }

    let pending = completeLines.length - uploadedLines;
    while (pending > 0) {
      const batch = completeLines.slice(
        uploadedLines,
        uploadedLines + HITS_BATCH_MAX_LINES,
      );
      await poster.postKnowledgeHitsBatch(wsId, batch);
      // 批成功才前进 offset（原子写）；失败抛出 → 下方 catch，本批下轮重试。
      uploadedLines += batch.length;
      await writeUploadedLines(wsId, uploadedLines);
      pending = completeLines.length - uploadedLines;
    }
  } catch (e) {
    // best-effort：warn 一次即返回，不抛（不阻塞同步主流程）、offset 不进。
    console.warn(
      'knowledge_hits_upload: upload_failed_will_retry_next_sync',
      wsId,
      specDir,
      e,
    );
  }
}
