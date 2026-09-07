/**
 * `agent-log/liveness/registry.ts` —— liveness 推导器注册表（format → deriver 映射）。
 *
 * task-01（2026-09-07-agent-liveness-states / FR-01 + D-003@v1）：daemon
 * liveness 子层的格式分发层，仿既有 `agent-log/registry.ts`（PARSERS
 * ReadonlyMap + getAgentLogParser）的扩展点模式。key 是 CLI 上报落库的
 * format 串（与 platform_agent_logs.format 落库串逐字一致，design §6），
 * value 是对应推导器（LivenessDeriver 纯函数，IO 契约见 ./types.ts）。
 *
 * 本任务注册表为空：'zcode-model-io-jsonl' 的 deriver 注册归 task-02
 * （derive-zcode-model-io.ts），codex / claude 等推导器由后续 task 经此 Map
 * 扩展、调用方零改动。未注册 format 查询返回 null，由调用方回落 L0 mtime
 * 兜底（design §5.1：mtime ≤120s → working；120s–15min → idle；>15min 或
 * 文件不存在 → ended）——"L0 only" 是本层的判定，deriver 自身只产 L1
 * 事件级状态，两个职责不混。
 *
 * 纯函数约束（与 parse-zcode-model-io.ts 同源）：deriver 不读文件系统 / 时钟，
 * tail / prev / now 全部经 DeriverInput 注入。本模块不 import node:fs /
 * RpcError / ws-client（文件 IO 与错误通道是 tailer / host-fs-handler 的
 * 职责，注册表只做纯映射查询，与既有 agent-log/registry.ts 同构零副作用）。
 *
 * @module agent-log/liveness/registry
 */

import type { LivenessDeriver } from './types.js';
import { deriveZcodeModelIo } from './derive-zcode-model-io.js';
import { deriveCodexRollout } from './derive-codex-rollout.js';
import { deriveClaudeCode } from './derive-claude-code.js';

// ── 注册表（task-02 起逐任务扩展：zcode→02 / codex→10 / claude→11）────────────

/**
 * format → deriver 静态注册表。key 与 platform_agent_logs.format 落库串逐字
 * 一致；task-02 注册 zcode-model-io-jsonl（E-03 实证规则）、task-10 注册
 * codex-rollout-jsonl（E-02 词汇表规则）——均 working/idle/unknown 永不产
 * blocked；task-11 注册 claude-code-jsonl（E-01 证伪定稿：仅 working/idle，blocked 归第一方 D-012）。
 */
const DERIVERS: ReadonlyMap<string, LivenessDeriver> = new Map<string, LivenessDeriver>([
  ['zcode-model-io-jsonl', deriveZcodeModelIo],
  ['codex-rollout-jsonl', deriveCodexRollout],
  ['claude-code-jsonl', deriveClaudeCode],
]);

/**
 * 按 format 查询 liveness 推导器。
 *
 * @returns 已注册返回对应 deriver；未注册返回 null，由调用方回落 L0 mtime
 *          兜底（design §5.1：mtime ≤120s → working；120s–15min → idle；
 *          >15min 或文件不存在 → ended）——"L0 only" 是本层的判定，deriver
 *          自身只产 L1 事件级状态，两个职责不混。
 */
export function getDeriver(format: string): LivenessDeriver | null {
  return DERIVERS.get(format) ?? null;
}
