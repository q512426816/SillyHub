/**
 * task-06 / 变更 2026-09-09-askuser-pi-cursor：cursor marker 型提问标记解析器。
 *
 * cursor 会话轮末可能以 ```askuser fenced JSON 块向用户提问（design §Wave B.2
 * marker 协议）；本模块把消息尾部的标记块宽容解析为提问载荷，供 AskUserMarkerCard
 * （task-07 时间线渲染）与群聊行渲染（task-11）消费的统一解析契约。
 *
 * 哲学对齐 parseAttachmentMarkers（runtime-session-helpers.tsx:532）：标记即数据，
 * 解析器只读不写——标记随文本原样持久化不剥离，textBefore 仅是渲染层展示正文
 * 的视图产物，落库内容不受影响。
 *
 * 宽容边界清单（design §Wave B.2 全量，测试逐条固化）：
 *   - 仅扫描文本尾部 8KB 窗口（8192 个 UTF-16 码元）：开栏围栏被顶出窗口
 *     （如 >8KB 尾随空白）不认；标记出现在文本中部（闭合围栏后还有正文）不认；
 *   - 围栏语言标注仅认 ```askuser（大小写敏感，```json 等其它标注不吞）；
 *     开栏 token 后只容忍行内空白（```askuser extra 不认）；
 *   - JSON 单行/多行均可；容忍闭合围栏后的尾随空白/换行、闭合围栏行行首空白、
 *     \r\n 行尾；载荷去首尾空白后计长；
 *   - 载荷超过 4KB（4096 字符）拒；
 *   - 非法 JSON / 顶层非对象 / 必填 kind 或 question 缺失（空/纯空白 question
 *     视为缺失）/ kind 不在 select|confirm|input|editor 枚举内 → 一律 null；
 *   - 防御性字段归一（不整体拒收）：options 条目须为 label 非空 string 的对象
 *     否则丢弃该条（数组保留可为空）；allowCustom 非 boolean、recommendResponders
 *     非数组时忽略该字段；responders 数组内非（非空）字符串条目丢弃；
 *   - 任何输入（含非字符串）不抛异常，非法一律返回 null（降级为普通文本，
 *     由渲染层兜底）。
 */

/** 标记提问载荷（design §Wave B.2 接口定义；字段词汇与 pi native 型 questions[] 同源） */
export interface AskUserMarkerPayload {
  kind: "select" | "confirm" | "input" | "editor";
  question: string;
  options?: Array<{ label: string }>;
  allowCustom?: boolean;
  recommendResponders?: string[];
}

/** 尾部扫描窗口：仅最后 8KB（UTF-16 码元）参与围栏识别 */
const TAIL_WINDOW_CHARS = 8 * 1024;

/** 载荷上限：去首尾空白后的 JSON 文本超过 4KB 拒（防超长块拖垮流式渲染） */
const MAX_PAYLOAD_CHARS = 4 * 1024;

/** 开栏围栏 token：仅认该语言标注（大小写敏感） */
const OPEN_TOKEN = "```askuser";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 非空字符串判定（trim 后计；值本身不 trim，原样保留） */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * 解析消息尾部的 ```askuser 标记块。
 *
 * 合法时返回 { payload, textBefore }：textBefore 为开栏围栏之前的全部原文
 * （含正文与围栏之间的换行，原样保留）；任何非法形态（见文件头清单）返回
 * null 当普通文本，不抛异常。
 */
export function parseAskUserMarker(
  text: string,
): { payload: AskUserMarkerPayload; textBefore: string } | null {
  // 任何输入不抛异常：非字符串（运行时脏数据）直接降级
  if (typeof text !== "string" || text.length === 0) return null;

  // 尾部 8KB 窗口 + 容忍尾随空白/换行（\s 含 \r）；窗口内索引换算回原文坐标见末尾
  const windowStart = Math.max(0, text.length - TAIL_WINDOW_CHARS);
  const tail = text.slice(windowStart).replace(/\s+$/, "");
  // 尾部标记的硬性特征：去尾随空白后必须以闭合围栏 ``` 收尾（中部标记在此被拦）
  if (!tail.endsWith("```")) return null;

  // 从后往前找最后一个合法开栏行（模型重试输出多块时，尾块覆盖前块）：
  // 合法 = 行首（前一个字符是 \n，或恰在窗口起点）+ token + 行内空白 + 换行
  let openIdx = -1;
  let openLineEnd = -1;
  let idx = tail.lastIndexOf(OPEN_TOKEN);
  while (idx !== -1) {
    const atLineStart = idx === 0 || tail.charAt(idx - 1) === "\n";
    if (atLineStart) {
      let j = idx + OPEN_TOKEN.length;
      while (j < tail.length && " \t\r".includes(tail.charAt(j))) j += 1;
      if (tail.charAt(j) === "\n") {
        openIdx = idx;
        openLineEnd = j + 1;
        break;
      }
    }
    if (idx === 0) break;
    idx = tail.lastIndexOf(OPEN_TOKEN, idx - 1);
  }
  if (openIdx === -1) return null;

  // 闭合围栏行：末尾 ```（closeStart）所在行的行首到围栏之间只允许空白，
  // 否则末尾 ``` 不是独立围栏行（如载荷与围栏同行），按非法处理
  const closeStart = tail.length - 3;
  const closeLineStart = tail.lastIndexOf("\n", Math.max(0, closeStart - 1)) + 1;
  if (closeLineStart < openLineEnd) return null;
  for (let k = closeLineStart; k < closeStart; k += 1) {
    if (!" \t\r".includes(tail.charAt(k))) return null;
  }

  // 载荷 = 开栏行之后到闭合行之前的全部内容（单/多行 JSON 均可，trim 去围栏间空白）
  const payloadText = tail.slice(openLineEnd, closeLineStart).trim();
  if (payloadText.length === 0 || payloadText.length > MAX_PAYLOAD_CHARS) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadText);
  } catch {
    return null; // 非法 JSON → 降级普通文本
  }
  if (!isPlainObject(parsed)) return null;

  const { kind, question, options, allowCustom, recommendResponders } = parsed;
  if (
    kind !== "select" &&
    kind !== "confirm" &&
    kind !== "input" &&
    kind !== "editor"
  ) {
    return null; // 必填枚举缺失/越界
  }
  if (!isNonEmptyString(question)) return null; // 必填 string（空/纯空白视为缺失）

  // 防御性归一：坏字段降级保留，不整体拒收（见文件头清单）
  const payload: AskUserMarkerPayload = { kind, question };
  if (Array.isArray(options)) {
    payload.options = options
      .filter(
        (entry): entry is { label: string } =>
          isPlainObject(entry) && isNonEmptyString(entry.label),
      )
      .map((entry) => ({ label: entry.label }));
  }
  if (typeof allowCustom === "boolean") payload.allowCustom = allowCustom;
  if (Array.isArray(recommendResponders)) {
    payload.recommendResponders = recommendResponders.filter(
      (name): name is string => isNonEmptyString(name),
    );
  }

  // textBefore = 开栏围栏之前的全部原文（窗口内索引换算回原文坐标）
  return { payload, textBefore: text.slice(0, windowStart + openIdx) };
}
