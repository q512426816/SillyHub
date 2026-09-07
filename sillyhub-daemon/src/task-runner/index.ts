/**
 * task-runner/index.ts —— TaskRunner 拆包的聚合导出层。
 *
 * task-03（2026-09-07-arch-large-file-split / D-004@v1 / D-006@v1）：facade
 * （../task-runner.ts）经 ``export * from './task-runner/index.js'`` 转发。
 * **只转发拆前原导出面的 26 个非类符号**（TaskRunner 类本体在 facade 声明）
 * ——子模块内部符号（TaskRunnerCore / SpawnAttemptResult / pickStr 等）不进
 * 公共导出面，保持拆分前后导出符号集合语义一致（task-01 基线 §2 共 27 条）。
 *
 * @module task-runner/index
 */

// ── runner-types：类型 + SILLYSPEC 工具映射 ──────────────────────────────────
export { SILLYSPEC_VALID_TOOLS, mapDetectedToSillyspecTools } from './runner-types.js';
export type {
  RunnerCredentialManager,
  RunnerHubClient,
  RunnerWorkspaceManager,
  TaskRunnerResult,
  TaskStatus,
} from './runner-types.js';

// ── file-mcp：worker 临时 .mcp.json 常量与清扫 ───────────────────────────────
export {
  FILE_MCP_TMP_MAX_AGE_MS,
  FILE_MCP_TMP_PREFIX,
  cleanupStaleFileMcpConfigs,
  fileMcpTmpPathFor,
} from './file-mcp.js';

// ── change-write：轻量分支类型与路径校验 ─────────────────────────────────────
export { validateChangeWritePath } from './change-write.js';
export type {
  ChangeWriteCtx,
  ChangeWriteFile,
  ChangeWriteResult,
} from './change-write.js';

// ── skill-prompt：超时/重试/技能 prompt/stats 纯函数 ─────────────────────────
export {
  attachBatchModelStats,
  buildSkillPrompt,
  detectSkillInvoked,
  extractBudgetUsageTokens,
  isSpawnLevelFailure,
  mergeAdapterUsage,
  resolveMaxRetries,
  resolveTimeout,
} from './skill-prompt.js';

// ── render：本地终端 echo / 观察日志渲染 ─────────────────────────────────────
export {
  echoTaskBoundary,
  renderAgentEvent,
  renderTaskBoundary,
} from './render.js';
