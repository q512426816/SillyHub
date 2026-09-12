/**
 * model-error/classifier.ts —— 模型调用错误归类器（task-02 / FR-01）。
 *
 * 职责（design §5 Phase 2 / §7.2）：把 turn 的失败信号
 *（is_error + resultText + api_retry.error + 最近 assistant stdout + stderr）
 * 按关键词/正则归类成结构化 {@link ModelError}，覆盖 8 类错误。
 *
 * 2026-09-12-chat-turn-auto-recovery：规则体 provider 无关化（原 D-001「仅
 * claude」废止——pi/codex/cursor 走同一套关键词规则；实证 pi 断流/429 全落
 * unknown 无恢复面）+ 断流关键词（Stream ended without finish_reason 主实证）
 * + resetAt 解析（GLM 中文格式，北京时间 +08:00）。
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
   * agent 类型（session provider 标识）。仅日志归因用——2026-09-12 起规则体
   * provider 无关（classifyBlob），全 agent 同一套关键词规则。
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

  // 3. HTTP 状态码：(429) / HTTP 429 / status: 429 / http=429 / 原因短语形态
  //    （"401 Unauthorized" / "502 Bad Gateway"）。2026-09-12-session-live-display-fixes
  //    （R2 / D-003）：原第 5 分支裸 \b[1-5]\d{2}\b 无任何上下文锚定，把 pi 静默断流
  //    合成文本里的 api_calls=116（本轮 API 调用计数）误抓为 HTTP 码展示成
  //    code:116——替换为「3 位数字 + 空白 + 大写开头词」的 reason phrase 锚定；
  //    '401 Unauthorized'/'502 Bad Gateway' 既有断言继续命中（正则整体 /i，大写
  //    锚定实为字母开头词的宽口径——保留既有断言语义，误报面从任意裸数字收窄
  //    到「数字后紧跟空白+词」形态）。
  const http =
    /\((\d{3})\)|HTTP[\s/]*(\d{3})|status[^\d]{0,3}(\d{3})|http[^\d]{0,3}(\d{3})|\b(\d{3})\s+[A-Za-z]/i.exec(
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
 *   7. 5xx/internal server error/断流关键词 → provider_error
 *   8. 兜底 → unknown
 *
 * 2026-09-12：classifyClaude 更名 classifyBlob（规则体 provider 无关化）；
 * 第 7 条补断流关键词——pi 上游「Stream ended without finish_reason」主实证
 * （2026-09-11 会话 d4c29d95 ×8）原先八类均不命中落 unknown/retryable=false，
 * 自动恢复面拿不到可重试信号。
 */
function classifyBlob(blob: string): ModelErrorType {
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

  // 7. provider_error：5xx / internal server error / bad gateway / overloaded /
  //    断流（2026-09-12-chat-turn-auto-recovery D-011：pi 上游「Stream ended
  //    without finish_reason」主实证原先八类均不命中落 unknown；pi driver 静默
  //    中断合成文本 [silent stream truncation] 亦经此处，必须确定性命中）。
  if (/\b5\d{2}\b|internal[\s_-]?server[\s_-]?error|server[\s_-]?error|internal[\s_-]?error|bad[\s_-]?gateway|service[\s_-]?unavail|upstream|overloaded|供应商[\s\S]{0,5}(异常|错误)|stream[\s_-]?(ended|truncat)|without[\s_-]?finish[\s_-]?reason|silent[\s_-]?stream|输出流中断|流中断/i.test(blob)) {
    return 'provider_error';
  }

  // 8. 兜底。
  return 'unknown';
}

/**
 * 从 quota 错误文本解析额度重置时间（ISO-8601，含 +08:00 偏移；失败 → null）。
 *
 * 2026-09-12-chat-turn-auto-recovery D-002@v2：只解析 GLM 中文实证格式
 * 「…将于 2026-09-12 10:03:59 重置」（1308 错误体，北京时间，固定标注
 * +08:00）；英文变体（resets at / will reset）无时区信息不做猜测，返回
 * null（后端退化为不排期，仅提示）。仅 quota_exceeded 命中时调用。
 */
function extractResetAt(blob: string): string | null {
  // 「将在/将于 … 重置」双介词兼容——实证 1308 文案为「将在」（2026-09-11
  // 会话 d4c29d95），「将于」留作同构变体兜底。
  const m = /将[在于]\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*重置/.exec(
    blob,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  // 显式字符串拼接（不走 new Date 解析——ES 实现相关时区处理不可移植）。
  return `${y}-${mo}-${d}T${h}:${mi}:${se}+08:00`;
}

/**
 * 把模型调用失败信号归类为结构化 {@link ModelError}。
 *
 * @param input turn 的失败信号（is_error + 各文本来源；agent 仅日志归因）
 * @returns ModelError（失败时）或 null（非模型错误：is_error=false，成功路径不产生 error）
 *
 * 判定顺序：
 *   1. isError=false → null（非模型错误，成功路径不产生 error，D-008；蓝图 acceptance）。
 *      成功 turn 即便残留 api_retry 文本也不算失败（曾瞬时限流但已恢复）。
 *   2. 按规则体 classifyBlob 归类（2026-09-12 起 provider 无关，全 agent 同
 *      规则；含 unknown 兜底，R-01）。
 *   3. quota_exceeded → 附加 resetAt（extractResetAt，解析失败 null）。
 */
export function classifyModelError(input: ClassifyModelInput): ModelError | null {
  // 1. 非模型错误：turn 未失败。成功路径一律不产生 ModelError（D-008）。
  if (!input.isError) {
    return null;
  }

  const blob = buildBlob(input);
  const raw = blob.length > 0 ? blob : null;

  // 2026-09-12-session-live-display-fixes（R2 / D-003）：pi 静默断流签名——
  // pi driver 合成的「[silent stream truncation] …（api_calls=N, …）」不是供应商
  // 返回的业务错误（api_calls 计数曾被 extractCode 裸数字兜底误抓为 code:116
  // 展示在失败卡上误导用户），message/hint 覆写为断流专属中文归因；type 仍走
  // classifyBlob（规则 7 断流关键词确定性命中 provider_error，auto-recovery
  // TRANSIENT_ERROR_TYPES 判定零变更）；code 对该签名恒 null。
  const silentTruncation = /\[silent[\s_-]?stream[\s_-]?truncation\]/i.test(blob);
  const code = silentTruncation ? null : extractCode(blob);

  // 2. 归类（provider 无关：pi/codex/cursor 与 claude 同一规则体）。
  const type = classifyBlob(blob);
  const info = ERROR_INFO[type];
  if (silentTruncation) {
    return {
      type,
      code: null,
      message: '上游输出流中断，本轮未产生收尾回复',
      retryable: info.retryable,
      hint: '上游输出流中断，已支持自动续跑；若未自动续跑可重试或切换供应商',
      raw,
      resetAt: null,
    };
  }
  return {
    type,
    code,
    message: info.message,
    retryable: info.retryable,
    hint: info.hint,
    raw,
    resetAt: type === 'quota_exceeded' ? extractResetAt(blob) : null,
  };
}
