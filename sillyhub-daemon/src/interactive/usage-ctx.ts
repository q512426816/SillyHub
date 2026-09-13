// src/interactive/usage-ctx.ts
// 2026-09-13-ctx-usage-all-providers task-01（FR-05 / D-001@v1 / design「接口定义」）：
// ctx_tokens（上下文环分子）派生口径**单源** helper——净值三和（claude / pi /
// cursor）与毛值直取（codex）两个纯函数。Wave 2 各归一化器（task-02 pi /
// task-03 cursor / task-04 codex / task-05 claude-events 重构引用）统一
// import './usage-ctx.js' 复用，口径永远一处定义。
//
// 模块零依赖（不 import 任何其他源文件）：只做数值派生，不做事件对象组装 /
// ctx_tokens 键挂载（挂载归各归一化器）；不引入运行时依赖。

/**
 * 净值口径派生（claude / pi / cursor 同式）：
 * ctx = input + cacheRead + cacheCreation（三和）。
 *
 * input 为**未命中缓存的净输入**（Anthropic 系 usage 语义：该次调用的
 * 全提示词 = 净 input + 命中缓存读取 cacheRead + 本轮新写缓存 cacheCreation，
 * 三分量互斥，求和即该次调用的全提示词大小）。与毛值口径
 * （{@link ctxTokensFromGrossInput}）的差异：净值三分量互斥需求和，
 * 毛值 input 本身已含 cached + cacheWrite、直取不再加分量。
 *
 * 语义（与 claude-events startInput ?? 0 同口径）：
 *   - 三分量全缺 → 返回 undefined（不伪造 0）——事件不携带 ctx_tokens 键，
 *     消费侧缺键即跳过（与 claude 子桶同契约，未知态而非零值）。
 *   - 任一分量存在 → 缺失分量按 0 计求和（有部分数据即派生）；
 *     入参 0 是有效数据不视作缺失（参与求和，走非 undefined 分支）。
 *
 * pi 口径特记（Grill D-1）：pi 路径 numOr0 归一使三入参恒为 number，
 * 全缺分支对 pi 恒不触发——错误轮全零 usage 将携带 ctx_tokens=0，
 * 环显示 0.0% 而非未知态。这是**有意口径**：全零是该轮真实用量事实
 * （pi 归一化器原样上报哲学），与 claude「事件缺键」的未知态语义并列
 * 成立；cursor / codex 路径走 undefined 分支不受影响。
 */
export function ctxTokensFromNetInput(
  input?: number,
  cacheRead?: number,
  cacheCreation?: number,
): number | undefined {
  if (
    input === undefined &&
    cacheRead === undefined &&
    cacheCreation === undefined
  ) {
    return undefined;
  }
  return (input ?? 0) + (cacheRead ?? 0) + (cacheCreation ?? 0);
}

/**
 * 毛值口径派生（codex）：ctx = grossInput 原值直取。
 *
 * grossInput **已含 cached + cacheWrite**——对应 codex
 * `thread/tokenUsage/updated` 通知的 `last.inputTokens`（单调用毛值：
 * 实测 `totalTokens = inputTokens + outputTokens`，即 inputTokens 本身
 * 就是该次调用的全提示词大小，与净值口径不同，**不能再加 cache 分量**，
 * 否则重复计数）。
 *
 * 语义：undefined → undefined（不伪造 0，该引擎 ctx 保持未知态）；
 * number → 原值返回（0 是有效值，不视作缺失）。
 */
export function ctxTokensFromGrossInput(
  grossInput?: number,
): number | undefined {
  return grossInput;
}
