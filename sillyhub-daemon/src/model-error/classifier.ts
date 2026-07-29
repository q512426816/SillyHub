/**
 * model-error/classifier.ts —— claude 模型调用错误归类器（task-02 / FR-01）。
 *
 * 职责（design §5 Phase 2 / §7.2）：把 claude turn 的失败信号
 *（is_error + resultText + api_retry.error + 最近 assistant stdout + stderr）
 * 按关键词/正则归类成结构化 {@link ModelError}，覆盖 8 类错误。
 *
 * 数据来源对齐真实数据流（design §1 / claude-sdk-driver.ts / stream-json.ts）：
 *   - isError        ← stream-json.parseResult 的 msg.is_error（=lastResultInfo.isError）/ SDK result.is_error
 *   - resultText     ← stream-json lastResultInfo.resultText（result.result 文本）
 *   - apiRetryError  ← stream-json api_retry 事件的 error 文本（含 http= 状态/供应商码）
 *   - assistantStdout← 最近 [ASSISTANT] stdout（含 "API Error: Request rejected (429) · ..." 行）
 *   - stderrText     ← spawn 层报错（ECONNREFUSED / ETIMEDOUT 等）
 *
 * 关键决策：
 *   - D-001 仅 claude 归类；非 claude agent 预留扩展点，直接返回 unknown。
 *   - D-003 细分类型 + 针对性中文 hint（quota→充值/切换，auth→凭证配置…）。
 *   - D-006 429 区分 quota_exceeded（不可重试）与 rate_limited（可重试）。
 *   - R-01 无法识别时兜底 unknown，message 至少「运行失败」+ raw 存原始文本。
 *
 * 本模块纯函数，无副作用，便于单测。归类器**不**接入 stream-json adapter
 *（那是 task-03 的接线工作，见 design §6）。
 *
 * @module model-error/classifier
 */

import type { ModelError, ModelErrorType } from './types.js';

/**
 * 归类器输入。字段对齐 claude 真实产出（design §7.2 + 真实数据流）。
 */
export interface ClassifyModelInput {
  /**
   * agent 类型，决定走哪套归类规则（D-001：本次仅 claude；其他 agent 预留扩展点，
   * 一律兜底 unknown，等各自实现）。task-03 接线时传入 session 的 provider 标识。
   */
  agent: 'claude' | string;
  /** turn result 是否失败（stream-json lastResultInfo.isError / SDK result.is_error）。 */
  isError: boolean;
  /** result.subtype（如 error_during_execution），仅作辅助信号，可不传。 */
  subtype?: string;
  /** result.result 文本（is_error=true 时通常含失败原因）。 */
  resultText?: string;
  /** api_retry 事件的 error 字段（常含 HTTP 状态/供应商业务码）。 */
  apiRetryError?: string;
  /** 最近 [ASSISTANT] stdout 文本（可能含 "API Error: ..." 行）。 */
  assistantStdout?: string;
  /** stderr 文本（spawn 层报错，如 ECONNREFUSED / ETIMEDOUT）。 */
  stderrText?: string;
}

/** 各错误类型的可读文案 + 重试语义 + 针对性建议（D-003）。 */
const ERROR_INFO: Record<
  ModelErrorType,
  { message: string; hint: string | null; retryable: boolean }
> = {
  quota_exceeded: {
    message: '额度或配额已耗尽',
    hint: '额度耗尽，需充值或切换供应商',
    retryable: false,
  },
  rate_limited: {
    message: '请求被限流',
    hint: '请求过于频繁，请稍候重试或降低并发',
    retryable: true,
  },
  auth_failed: {
    message: '凭证无效或已失效',
    hint: '凭证失效，请检查或更换供应商配置',
    retryable: false,
  },
  timeout: {
    message: '请求超时',
    hint: '请求超时，请稍后重试',
    retryable: true,
  },
  model_not_found: {
    message: '模型不存在或不可用',
    hint: '模型不存在，请检查模型配置',
    retryable: false,
  },
  network: {
    message: '网络连接失败',
    hint: '网络连接失败，请检查网络或供应商地址',
    retryable: true,
  },
  provider_error: {
    message: '供应商服务异常',
    hint: '供应商服务异常，请稍后重试或切换供应商',
    retryable: true,
  },
  unknown: {
    message: '运行失败',
    hint: null,
    retryable: false,
  },
};

/** 把多个文本来源拼成一整段用于关键词匹配（顺序无所谓，全部纳入）。 */
function buildBlob(input: ClassifyModelInput): string {
  return [input.resultText, input.apiRetryError, input.assistantStdout, input.stderrText]
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .join(' | ')
    .trim();
}

/**
 * 从错误文本提取原始错误码（D-003 code 字段）。
 * 优先级：方括号业务码（如 [1310]） > EN* 网络码 > HTTP 状态码。
 * 提取不到返回 null。
 */
function extractCode(blob: string): string | null {
  // 1. 方括号里的数字码（供应商业务码，如 GLM 的 [1310]）。
  const bracket = /\[(\d+)\]/.exec(blob);
  if (bracket?.[1]) return bracket[1];

  // 2. EN* / EAI* 网络错误码（ECONNREFUSED / ENOTFOUND / ETIMEDOUT …）。
  const enErr =
    /\b(ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EAI_NONAME|EACCES|EPIPE)\b/.exec(
      blob,
    );
  if (enErr?.[1]) return enErr[1];

  // 3. HTTP 状态码：(429) / HTTP 429 / status: 429 / http=429 / 裸 4xx|5xx。
  const http =
    /\((\d{3})\)|HTTP[\s/]*(\d{3})|status[^\d]{0,3}(\d{3})|http[^\d]{0,3}(\d{3})|\b([1-5]\d{2})\b/i.exec(
      blob,
    );
  if (http) {
    const code = http[1] ?? http[2] ?? http[3] ?? http[4] ?? http[5];
    if (code) return code;
  }

  return null;
}

/**
 * 把多个文本来源拼起来后，按优先级从上到下匹配第一条命中的规则。
 * 返回 ModelErrorType；都不命中返回 'unknown'。
 *
 * 规则优先级（design §7.2，429 必须先于其他 4xx/5xx 判定）：
 *   1. 429 + 额度/上限/quota 关键词 → quota_exceeded
 *   2. 其余 429（含 Too Many Requests/限流/频繁，或裸 429）→ rate_limited
 *   3. 401/403/unauthorized/凭证 → auth_failed
 *   4. timeout/timed out/ETIMEDOUT → timeout
 *   5. model not found/模型不存在 → model_not_found
 *   6. ECONNREFUSED/ENOTFOUND/网络 → network
 *   7. 5xx/internal server error → provider_error
 *   8. 兜底 → unknown
 */
function classifyClaude(blob: string): ModelErrorType {
  const has429 = /\b429\b/.test(blob);

  // 1. quota_exceeded：429 + 额度/配额/上限语义。
  if (
    has429 &&
    /上限|额度|配额|quota|使用上限|limit reached|limit has been reached|usage[\s_-]{0,5}limit|exceeded[\s\S]{0,15}(quota|limit|usage)/i.test(
      blob,
    )
  ) {
    return 'quota_exceeded';
  }

  // 2. rate_limited：其余所有 429（HTTP 429 语义即 Too Many Requests）。
  //    含明确的限流关键词（too many requests/rate limit/限流/频繁/throttle）或裸 429。
  if (has429) {
    return 'rate_limited';
  }

  // 3. auth_failed：401/403/unauthorized/forbidden/invalid api key/凭证失效。
  if (
    /\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid[\s_-]{0,5}(api[\s_-]?key|token|credential|auth)|api[\s_-]?key[\s_-]{0,5}(invalid|missing|wrong|revoked)|auth(?:entication|orization)?[\s_-]{0,5}(failed|error|denied)|凭证|认证失败|授权失败/i.test(
      blob,
    )
  ) {
    return 'auth_failed';
  }

  // 4. timeout：timeout/timed out/ETIMEDOUT。
  if (/timeout|timed[\s_-]?out|ETIMEDOUT|请求超时/i.test(blob)) {
    return 'timeout';
  }

  // 5. model_not_found：model not found / 模型不存在。
  if (
    /model[\s\S]{0,25}(not[\s_-]?found|does[\s_-]?not[\s_-]?exist|不存在|未找到|unknown|unavailable|invalid)|模型[\s\S]{0,10}(不存在|未找到|未知|无效|不可用)|unknown[\s_-]?model|no[\s_-]?such[\s_-]?model/i.test(
      blob,
    )
  ) {
    return 'model_not_found';
  }

  // 6. network：ECONN*/ENOTFOUND/getaddrinfo/connection refused/fetch failed。
  if (
    /ECONNREFUSED|ECONNRESET|ECONNABORTED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EAI_NONAME|getaddrinfo|connection[\s_-]?refused|connect[\s_-]?ECONN|network[\s_-]?error|fetch[\s_-]?failed|socket[\s_-]?hang[\s_-]?up|无法连接|连接失败|连接被拒绝/i.test(
      blob,
    )
  ) {
    return 'network';
  }

  // 7. provider_error：5xx / internal server error / bad gateway / overloaded。
  if (/\b5\d{2}\b|internal[\s_-]?server[\s_-]?error|server[\s_-]?error|internal[\s_-]?error|bad[\s_-]?gateway|service[\s_-]?unavail|upstream|overloaded|供应商[\s\S]{0,5}(异常|错误)/i.test(blob)) {
    return 'provider_error';
  }

  // 8. 兜底。
  return 'unknown';
}

/**
 * 把模型调用失败信号归类为结构化 {@link ModelError}。
 *
 * @param input claude turn 的失败信号（is_error + 各文本来源）
 * @returns ModelError（失败时）或 null（非模型错误：is_error=false，成功路径不产生 error）
 *
 * 判定顺序：
 *   1. isError=false → null（非模型错误，成功路径不产生 error，D-008；蓝图 acceptance）。
 *      成功 turn 即便残留 api_retry 文本也不算失败（曾瞬时限流但已恢复）。
 *   2. agent 非 claude → 兜底 unknown（D-001 扩展点，等各自 agent 实现）。
 *   3. claude 按规则归类（含 unknown 兜底，R-01）。
 */
export function classifyModelError(input: ClassifyModelInput): ModelError | null {
  // 1. 非模型错误：turn 未失败。成功路径一律不产生 ModelError（D-008）。
  if (!input.isError) {
    return null;
  }

  const blob = buildBlob(input);
  const raw = blob.length > 0 ? blob : null;
  const code = extractCode(blob);

  // 2. 非 claude agent：预留扩展点，统一兜底 unknown（D-001）。
  if (input.agent !== 'claude') {
    const info = ERROR_INFO.unknown;
    return {
      type: 'unknown',
      code,
      message: info.message,
      retryable: info.retryable,
      hint: info.hint,
      raw,
    };
  }

  // 3. claude 归类。
  const type = classifyClaude(blob);
  const info = ERROR_INFO[type];
  return {
    type,
    code,
    message: info.message,
    retryable: info.retryable,
    hint: info.hint,
    raw,
  };
}
