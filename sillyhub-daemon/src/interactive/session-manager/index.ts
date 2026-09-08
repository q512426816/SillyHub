/**
 * interactive/session-manager/index.ts —— SessionManager 拆包的聚合导出层。
 *
 * task-02（2026-09-07-arch-large-file-split / D-004@v1 / D-006@v1）：facade
 * （../session-manager.ts）经 ``export * from './session-manager/index.js'``
 * 转发。**只转发拆前原导出面的 5 个非类符号**（SessionManager 类本体在 facade
 * 声明）——子模块内部符号（SessionManagerCore 等）不进公共导出面，保持
 * ``grep -n "^export" src/interactive/session-manager.ts`` 拆分前后语义一致。
 *
 * @module interactive/session-manager/index
 */

export { RESUME_DAMAGE_PATTERNS } from './types.js';
export type {
  MainAgentMcpContext,
  OnTurnQueuedCallback,
  PermissionWsSender,
  SessionManagerOptions,
} from './types.js';
