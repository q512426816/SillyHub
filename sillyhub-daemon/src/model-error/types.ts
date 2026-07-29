// 模型调用失败的标准错误协议（三端同构）。
// 详见 .sillyspec/changes/2026-07-29-model-error-visibility/design.md §7.1
// 字段与 backend/app/modules/daemon/model_error.py 的 ModelErrorDTO 同构。

/**
 * 模型错误类型。
 * - quota_exceeded 与 rate_limited 都是 429，但语义不同：
 *   quota_exceeded = 额度/配额耗尽（不可重试，等重置或换额度）；
 *   rate_limited  = 瞬时限流（可重试，稍后再试）。依据错误文本区分（D-006）。
 */
export type ModelErrorType =
  | 'auth_failed'      // 凭证失效/无效（401/403）
  | 'quota_exceeded'   // 额度/配额耗尽（429，不可重试）
  | 'rate_limited'     // 瞬时限流（429，可重试）
  | 'timeout'
  | 'model_not_found'
  | 'network'          // 连接失败/DNS
  | 'provider_error'   // 供应商其他错误（5xx）
  | 'unknown';         // 兜底

/**
 * 结构化模型错误。daemon 归类器（task-02）产出，随 run result 回传 backend。
 * 仅当 run 失败（is_error=true）时产生；成功路径不产生（D-008）。
 */
export interface ModelError {
  type: ModelErrorType;
  /** 原始错误码（如 "1310" / "429" / null） */
  code: string | null;
  /** 可读原因（中文） */
  message: string;
  /** 是否可重试（影响重发 action 与 hint） */
  retryable: boolean;
  /** 针对性建议（中文，可空） */
  hint: string | null;
  /** 原始错误文本（查看详情用，可空） */
  raw: string | null;
}
