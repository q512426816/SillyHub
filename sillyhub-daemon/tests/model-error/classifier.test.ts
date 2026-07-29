/**
 * model-error/classifier 单测（task-02 / FR-01 / D-003 / D-006）。
 *
 * 覆盖：
 *   - 8 类错误各至少 1 例（quota_exceeded / rate_limited / auth_failed / timeout /
 *     model_not_found / network / provider_error / unknown）；
 *   - 429 quota_exceeded 与 rate_limited 严格区分 + retryable 正确（D-006）；
 *   - 各 type 的 retryable 取值正确；
 *   - code 从文本提取（[1310] / HTTP 状态码 / EN* 网络码）；
 *   - 非模型错误（isError=false 且无错误文本）→ null；
 *   - 非 claude agent → unknown（D-001 扩展点）；
 *   - 多文本来源（resultText / apiRetryError / assistantStdout / stderrText）拼接后命中。
 *
 * @module model-error/classifier.test
 */

import { describe, it, expect } from 'vitest';
import { classifyModelError } from '../../src/model-error/classifier.js';

describe('classifyModelError — 8 类错误归类（task-02 / FR-01）', () => {
  it('quota_exceeded：真实 GLM 429 上限文本 → quota_exceeded + retryable=false + code=1310', () => {
    // 真实线上样本（design §1）：assistant stdout 的 "API Error" 行。
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      assistantStdout:
        'API Error: Request rejected (429) · [1310][您已达到每周/每月使用上限,您的限额将在 2026-07-29 10:26:02 重置。]',
    });
    expect(result).not.toBeNull();
    expect(result?.type).toBe('quota_exceeded');
    expect(result?.retryable).toBe(false);
    // code 取方括号里的业务码 "1310"，而非 HTTP 429。
    expect(result?.code).toBe('1310');
    expect(result?.message).toContain('额度');
    expect(result?.hint).toContain('充值');
    expect(result?.raw).toContain('使用上限');
  });

  it('quota_exceeded：HTTP 429 + 「额度」关键词，无方括号码时 code 回退为 HTTP 429', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: 'HTTP 429 您的额度已用尽，请充值后再试',
    });
    expect(result?.type).toBe('quota_exceeded');
    expect(result?.retryable).toBe(false);
    expect(result?.code).toBe('429');
  });

  it('rate_limited：429 + Too Many Requests → rate_limited + retryable=true + code=429', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: 'Too Many Requests (429)',
    });
    expect(result?.type).toBe('rate_limited');
    expect(result?.retryable).toBe(true);
    expect(result?.code).toBe('429');
  });

  it('rate_limited：429 + 中文「限流/频繁」', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      apiRetryError: '请求过于频繁，已被限流 (429)',
    });
    expect(result?.type).toBe('rate_limited');
    expect(result?.retryable).toBe(true);
  });

  it('429 严格区分：同样 429，含「上限」→ quota（非 rate）', () => {
    const quota = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: 'Request rejected (429) · 使用上限',
    });
    const rate = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: 'Request rejected (429) · Too Many Requests',
    });
    expect(quota?.type).toBe('quota_exceeded');
    expect(quota?.retryable).toBe(false);
    expect(rate?.type).toBe('rate_limited');
    expect(rate?.retryable).toBe(true);
  });

  it('auth_failed：401 Unauthorized → auth_failed + retryable=false', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: '401 Unauthorized: invalid api key',
    });
    expect(result?.type).toBe('auth_failed');
    expect(result?.retryable).toBe(false);
    expect(result?.code).toBe('401');
    expect(result?.hint).toContain('凭证');
  });

  it('auth_failed：403 / forbidden', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: 'Forbidden (403)',
    });
    expect(result?.type).toBe('auth_failed');
    expect(result?.retryable).toBe(false);
    expect(result?.code).toBe('403');
  });

  it('timeout：timed out → timeout + retryable=true', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: 'Request timed out after 60000ms',
    });
    expect(result?.type).toBe('timeout');
    expect(result?.retryable).toBe(true);
    expect(result?.code).toBeNull();
  });

  it('timeout：ETIMEDOUT 码被提取', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      stderrText: 'connect ETIMEDOUT 10.0.0.1:443',
    });
    expect(result?.type).toBe('timeout');
    expect(result?.code).toBe('ETIMEDOUT');
  });

  it('model_not_found：model not found → model_not_found + retryable=false', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: 'Error: model not found: glm-4.6-nonexistent',
    });
    expect(result?.type).toBe('model_not_found');
    expect(result?.retryable).toBe(false);
    expect(result?.hint).toContain('模型');
  });

  it('network：ECONNREFUSED → network + retryable=true + code=ECONNREFUSED', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      stderrText: 'fetch failed: connect ECONNREFUSED 127.0.0.1:8000',
    });
    expect(result?.type).toBe('network');
    expect(result?.retryable).toBe(true);
    expect(result?.code).toBe('ECONNREFUSED');
  });

  it('network：getaddrinfo ENOTFOUND（DNS 失败）', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      stderrText: 'getaddrinfo ENOTFOUND api.fake-host.example',
    });
    expect(result?.type).toBe('network');
    expect(result?.retryable).toBe(true);
    expect(result?.code).toBe('ENOTFOUND');
  });

  it('provider_error：5xx internal → provider_error + retryable=true + code=500', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: 'Internal Server Error (500)',
    });
    expect(result?.type).toBe('provider_error');
    expect(result?.retryable).toBe(true);
    expect(result?.code).toBe('500');
  });

  it('provider_error：502 Bad Gateway', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: '502 Bad Gateway',
    });
    expect(result?.type).toBe('provider_error');
    expect(result?.retryable).toBe(true);
    expect(result?.code).toBe('502');
  });

  it('unknown：无法识别的错误文本 → unknown + retryable=false + message 至少「运行失败」+ raw 存原文本', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: '发生了某些奇怪的事情 boom',
    });
    expect(result?.type).toBe('unknown');
    expect(result?.retryable).toBe(false);
    expect(result?.message).toBe('运行失败');
    expect(result?.code).toBeNull();
    expect(result?.raw).toContain('奇怪的事情');
  });
});

describe('classifyModelError — 非错误 / 非 claude（task-02 约束）', () => {
  it('isError=false 且无错误文本 → null（非模型错误）', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: false,
      resultText: '',
    });
    expect(result).toBeNull();
  });

  it('isError=false 且 resultText 为正常成功文本 → null', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: false,
      resultText: '任务已完成，所有文件已就绪。',
    });
    expect(result).toBeNull();
  });

  // task-11 回归补强（D-008 成功路径关键守卫）：
  // classifier.ts 注释明确——成功 turn 即便残留 api_retry / 429 / 上限文本也不算失败
  //（曾瞬时限流但最终 is_error=false 已恢复）。判定只看 isError，不能因文本含失败关键词
  // 就在成功 turn 产出 ModelError。这是「成功路径不产 error」的核心回归点：防止后续改动
  // 误把文本检测前置于 isError 守卫，导致成功 run 被错误标红。
  it('成功路径关键回归：isError=false 即便残留 429/上限/api_retry 文本也 → null', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: false,
      resultText: 'Request rejected (429) · [1310][您已达到每周/每月使用上限]',
      apiRetryError: 'api_retry: http=429 error=Too Many Requests',
      assistantStdout: 'API Error: Request rejected (429) · 使用上限',
    });
    expect(result).toBeNull();
  });

  it('成功路径：isError=false 且各文本来源全空 → null（不兜底 unknown）', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: false,
      resultText: '',
      apiRetryError: '',
      assistantStdout: '',
      stderrText: '',
    });
    // isError=false 优先于「文本为空兜底 unknown」分支，成功路径绝不产 error。
    expect(result).toBeNull();
  });

  it('isError=true 但文本为空 → 兜底 unknown（仍属运行失败）', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: '',
    });
    expect(result?.type).toBe('unknown');
    expect(result?.retryable).toBe(false);
  });

  it('非 claude agent（codex）有错误 → unknown（D-001 扩展点）', () => {
    const result = classifyModelError({
      agent: 'codex',
      isError: true,
      resultText: 'Request rejected (429) · 使用上限',
    });
    // 非 claude 不走 claude 规则，统一兜底 unknown（扩展点，后续 agent 各自实现）。
    expect(result?.type).toBe('unknown');
    expect(result?.retryable).toBe(false);
    expect(result?.raw).toContain('使用上限');
  });

  it('非 claude agent 且无错误 → null', () => {
    const result = classifyModelError({
      agent: 'opencode',
      isError: false,
      resultText: '',
    });
    expect(result).toBeNull();
  });
});

describe('classifyModelError — 多文本来源拼接（task-02）', () => {
  it('resultText 为空但 apiRetryError 命中限流 → rate_limited', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: '',
      apiRetryError: 'api_retry: http=429 error=Too Many Requests',
    });
    expect(result?.type).toBe('rate_limited');
    expect(result?.retryable).toBe(true);
  });

  it('裸 429（无 quota/rate 关键词）默认归 rate_limited（HTTP 429 语义=Too Many Requests）', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: 'Request rejected (429)',
    });
    expect(result?.type).toBe('rate_limited');
    expect(result?.retryable).toBe(true);
  });

  it('ModelError 字段完整性（全字段非 undefined）', () => {
    const result = classifyModelError({
      agent: 'claude',
      isError: true,
      resultText: '401 Unauthorized',
    });
    expect(result).not.toBeNull();
    if (!result) return;
    // expects_from task-01：必须含全字段 type/code/message/retryable/hint/raw。
    expect(typeof result.type).toBe('string');
    expect(result.code === null || typeof result.code === 'string').toBe(true);
    expect(typeof result.message).toBe('string');
    expect(typeof result.retryable).toBe('boolean');
    expect(result.hint === null || typeof result.hint === 'string').toBe(true);
    expect(result.raw === null || typeof result.raw === 'string').toBe(true);
  });
});
