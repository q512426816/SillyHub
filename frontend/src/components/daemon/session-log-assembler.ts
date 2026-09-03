/**
 * task-01 + task-02（2026-08-19-session-stream-ux / FR-01 / FR-03 / FR-05 / D-002@v1）：
 * 会话流共享装配器（纯函数，无 React 依赖、无副作用，时间一律取自输入 timestamp）。
 *
 * 把归一后的单条日志（AssemblerLogInput：实时 SSE envelope 与 attach 历史 log 由
 * 调用方归一成此形状）分类并装配为 TurnSegment 结构化段模型——一轮回复按真实到达
 * 顺序形成有序段序列（文本/思考/工具/stderr），子代理日志按 parent_tool_use_id
 * 嵌套归属到对应工具段的 children（design §5 Phase1）。
 *
 * 导出 API（design §7）：
 *   - applyLogToSegments(turn, input)：实时 SSE 增量（替代 sessions 页 / runtimes
 *     弹窗两处 applyLogToTurn 副本）；
 *   - logsToSegments(logs, options?)：历史批量。具体形状：单序列 TurnSegment[]——
 *     run 分组 / prompt 提取 / realRunId 等 turn 级胶水归调用方（logsToTurns，
 *     Grill X-05 形状澄清）；内容级去重（seenTextDedup，默认开启）在本函数内做，
 *     与 SSE 实时路径的 log_id 去重是两路独立语义，不合并（§9.4 / Grill X-08）；
 *   - finishTurn(turn)：turn 终态辅助（消费方在 turn_completed 事件时调用）——
 *     清除全部 text / thinking 段的 streaming 标记（§5 Phase3）；
 *   - segmentsToLegacy(segments)：兼容投影（§9.4）——output（文本段按序拼接）+
 *     processItems（平铺：tool.startedAt→ts、thinking/stderr.ts→ts），形状对齐
 *     turn-timeline.tsx 的 SessionProcessItem / SessionToolEvent（逐字段一致，
 *     结构化类型兼容），过渡期外围消费方（重发 prompt / AskUser 穿插排序 / 孤儿
 *     turn）零改动。
 *
 * task-02（本版）补齐 task-01 留白（撤回 / 去重 / streaming）：
 *   - override 撤回：segmentId 前缀路由（`main:` → 顶层；`<tool_use_id>:` → 匹配
 *     容器 children；三段格式 `main:<msg_id>:<seq>` / `<tool_use_id>:<seq>`，前缀取
 *     第一段，Grill X-06），variant 决定撤回 text 段（assistant，文本截断语义）或
 *     thinking 段（thinking，思考项移除语义）——同一 segmentId 派生的分裂段（被工具
 *     段打断 / 与异源段交错产生 -2/-3 后缀链）一并撤回（R-06 跨段撤回），撤回后重算
 *     投影；规则平移自 applyLogToTurn 的 partialSegmentsRef（page.tsx:1078-1192）；
 *   - log_id 去重（SSE 实时路径，seenLogIds）：重复 input 原引用返回；历史批量路径
 *     走 logsToSegments 的 seenText 内容级去重（kind+文本为键）；
 *   - streaming 置位 = text/thinking 段收到带 segmentId 的 partial 追加（新建或续接）；
 *     清除 = 该 segmentId 收到 override（派生段已移除）或 turn 终态（finishTurn）。
 *
 * 不可变更新约定（FR-06 渲染经济性的数据层基础）：每次装配只克隆从根到被改段的
 * 路径（path-copy），未触及的段保持原对象引用稳定，供 task-05 段级 React.memo 依赖。
 *
 * F7（2026-08-25 frontend 第二轮优化）：applyLogToSegments 尾部「每条日志全量重投影
 * （segmentsToLegacy 全树 DFS）+ 每条复制整个 seenLogIds Set + 每新段全树收集 id」
 * 在流式 partial 逐条到达时累计 O(n²)。改为增量维护，导出 API 与产出值零变化：
 *   - 兼容投影（output / processItems）仍是每次返回的急切 plain 字段（消费方
 *     spread / 解构零改动——session-panel 有 16+ 处 `{...turn}` 展开，getter 方案
 *     会被 displayTurns 每 render 强制求值，故弃用）；内部以 symbol 键 enumerable
 *     的「投影 cell」（含 DFS 末位 text 段 / 末位过程项锚点）随 turn 链流转：
 *     热路径（同源 partial 续接末位 text/thinking 段）O(1) 增量（output 尾接、
 *     processItems 引用复用或尾项替换），结构变更 / 撤回 / 无 cell 才全量重投影；
 *   - seenLogIds 改 turn 链共享同一可变 Set（turn 对象仍每条新建）；React 18
 *     StrictMode（本项目已开）double-invoke setState updater 时，入口按 Set 身份
 *     记忆「上次 (Set, logId) → 产物」直接复返，防共享 Set 被首次调用 add 后二次
 *     重查误判重复而丢内容（真正迟到重放走集合命中原引用返回，语义不变）；
 *   - 新段 id 唯一化走链内共享 id 索引 Set（O(1) has/add），撤回时同步移除，替代
 *     每新段全树收集；索引缺失（外部构造 turn / 视图）回退全树收集，行为不变。
 *
 * task-11（2026-08-27-background-subagent-progress / FR-03·07 前端半）：[TASK_*]
 * 后台任务生命周期行解析——classifySessionLog 识别 [TASK_STARTED]/[TASK_PROGRESS]/
 * [TASK_NOTIFICATION] 前缀（与 [TOOL_USE]/[SYSTEM:] 同级的前缀方言），JSON.parse
 * 容错（坏行降级普通文本，R-07 不抛错）；applyLogToSegments 按行级
 * parent_tool_use_id 路由（复用既有归属路由的容器定位）把解析结果写入派发
 * tool 段元数据：taskStatus（STARTED→running；NOTIFICATION→其 status）/
 * taskElapsedMs / taskAsync / taskSummary / taskToolName（tool 段可选字段，
 * task_segment_metadata 契约）。行本身消费后不产生正文文本段（不显示为普通
 * 文本行）；无路由目标的历史孤儿行丢弃不崩（不建 stub 空壳，取更安全者）。
 */

/* ───────────────── 分类（自 session-log-sanitize.ts 平移，语义不变） ───────────────── */
/**
 * ql-20260729-005：会话日志分类（对话 / 过程信息分流）。
 * ql-20260730-003：tool 拆回 tool_use / tool_result，恢复 use↔result 配对 + 状态徽章。
 *
 * 与 sanitizeSessionLogContent 同一套丢弃规则，但返回结构化分类而非拼接字符串，
 * 供会话面板把「答复正文（reply）」与「过程信息（thinking/tool_use/tool_result/stderr）」分流：
 * 默认对话视图只渲染 reply，过程信息经「对话/进度」切换后再展示。
 *
 * 分类规则：
 *   - 丢弃（返回 null）：AskUserQuestion 卡片协议行 / [TOOL_RESULT] User answered /
 *     [SYSTEM…] / [RESULT…] 与空内容（丢弃优先于 channel 分流）
 *   - kind=thinking：[THINKING] 前缀行（剥前缀）
 *   - kind=tool_use：channel=tool_call（daemon 上报的工具 JSON，含 tool_use_id/success，
 *     权威源）。stdout 的 [TOOL_USE] 文本行与该 JSON 重复 → 丢弃（双发去重，否则 tool_use
 *     翻倍、result 仅够配一半，余下永显「执行中 ⏳」）
 *   - kind=file：channel=tool_call 且 tool_kind=FileUpload（task-08 /
 *     2026-08-23-agent-file-upload-mcp / FR-01 / D-007@v1），content JSON
 *     {file_id, original_name, size, mime_type, description} 可解析 → file 段
 *     （design §7.3，优先于通用 tool_use 映射——聊天流渲染文件卡片而非工具行）；
 *     解析失败 / 缺 file_id → 回退通用 tool_use 映射不丢行；未知 / 缺省 tool_kind
 *     一律走原 tool_use 映射（零回归）
 *   - kind=tool_result：[TOOL_RESULT] 前缀的 stdout 文本行（剥前缀，供配对最近 tool_use）
 *   - kind=task：[TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION] 前缀行（task-11 /
 *     2026-08-27-background-subagent-progress，daemon task-03 落库的后台任务生命周期
 *     协议行——解析为 tool 段元数据载荷，不进正文；坏 JSON 降级普通文本，R-07）
 *   - kind=skill：[ASSISTANT] Base directory for this skill: 前缀行（ql-20260824-017，
 *     Claude Code 技能装载注入——SKILL.md 全文以 assistant 文本块注入，属技能协议
 *     载荷非用户答复，剥前缀后由装配器挂到最近 Skill 工具段 result，不进对话正文）
 *   - kind=stderr：channel=stderr
 *   - kind=reply：其余（剥 [ASSISTANT]/[LOG:\w+] 前缀）
 *
 * 2026-08-19-session-stream-ux / task-01：自 session-log-sanitize.ts 迁入装配器
 * （design §6 分类函数迁为装配器内部依赖），原文件保留同名导出垫片，规则零改动。
 */
export type SessionLogSegmentKind =
  | "reply"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "skill"
  | "stderr"
  | "override"
  | "file"
  | "task";

export interface SessionLogSegment {
  kind: SessionLogSegmentKind;
  text: string;
  /**
   * 2026-08-03-session-stream-partial-revoke / FR-04：override kind 专有——
   * 被撤回的 partial segmentId（取自 [*_OVERRIDE] 前缀后第一段非空白 token，
   * 形如 "main:msg_abc:1" / "tu_xyz:2"）。供撤回逻辑查目标段精确撤回。
   */
  segmentId?: string;
  /**
   * override kind 专有——区分撤回的是 reply（"assistant"）还是 thinking（"thinking"），
   * 撤回实现（task-02）据此决定截断文本段还是移除思考段。
   */
  variant?: "assistant" | "thinking";
  /**
   * file kind 专有（task-08 / design §7.3）——FileUpload 日志行 content JSON 解析
   * 产物五字段（file 段的唯一数据源；其余 kind 恒缺省）。text 对 file 恒为空串。
   */
  fileId?: string;
  name?: string;
  size?: number;
  mime?: string;
  description?: string;
  /**
   * task kind 专有（task-11 / 2026-08-27-background-subagent-progress / FR-03·07）：
   * [TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION] stdout 行（daemon task-03
   * 落库形状：前缀 + 单行 JSON）的分类解析产物——applyLogToSegments 按行级
   * parent_tool_use_id 路由写入派发 tool 段的同名元数据字段（正文不渲染）。字段
   * 按行类型可选（其余 kind 恒缺省）：
   *   - STARTED → taskStatus="running" + taskAsync（JSON async 布尔守卫）；
   *   - PROGRESS → taskElapsedMs / taskSummary / taskToolName（不动状态）；
   *   - NOTIFICATION → taskStatus=终态（completed/failed/stopped）+ taskElapsedMs /
   *     taskSummary（终态覆盖 STARTED 的 running）。
   * text 保留剥前缀后的 JSON 原文——仅供 logsToSegments 内容级去重做键，不进
   * 对话正文与任何投影。
   */
  taskStatus?: "running" | "completed" | "failed" | "stopped";
  taskElapsedMs?: number;
  taskAsync?: boolean;
  taskSummary?: string;
  taskToolName?: string;
}

/**
 * 2026-08-03-session-stream-partial-revoke / FR-04 / D-002@v1：override 撤回令箭前缀正则。
 * 命中 `[ASSISTANT_OVERRIDE]` / `[THINKING_OVERRIDE]` 前缀，第 1 捕获组是 OVERRIDE 类型
 * （决定 variant），第 2 捕获组是被撤回的 segmentId（\S+，不含空白）。
 *
 * classifySessionLog 用捕获组解析 segmentId + variant；sanitizeSessionLogContent 只判
 * 命中丢弃——同一常量避免两处规则漂移（2026-08-03 变更 task-05 constraints）。
 * task-01 迁入本文件后导出，session-log-sanitize.ts（sanitizeSessionLogContent）
 * 继续同源引用。
 */
export const OVERRIDE_RE = /^\[(ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s+(\S+)/;

/** FileUpload 日志行 content JSON 解析产物（design §7.2 / task-03 契约五字段）。 */
interface FileUploadContent {
  fileId: string;
  name: string;
  size: number;
  mime: string;
  description: string;
}

/**
 * task-08（2026-08-23-agent-file-upload-mcp / D-007@v1）：解析 FileUpload 日志行的
 * content JSON（{file_id, original_name, size, mime_type, description}）。
 * 非 JSON / 非对象 / file_id / original_name 缺失 → null（调用方回退通用 tool_use
 * 映射，不丢行，R-07 容错）；size / mime_type / description 类型异常时按 0 / 空串
 * 兜底（后端契约恒为合法 JSON，此处防御截断行与旧数据）。
 */
function parseFileUploadContent(raw: string): FileUploadContent | null {
  try {
    const obj = JSON.parse(raw) as {
      file_id?: unknown;
      original_name?: unknown;
      size?: unknown;
      mime_type?: unknown;
      description?: unknown;
    } | null;
    if (!obj || typeof obj !== "object") return null;
    const fileId = typeof obj.file_id === "string" ? obj.file_id.trim() : "";
    const name = typeof obj.original_name === "string" ? obj.original_name.trim() : "";
    if (!fileId || !name) return null;
    return {
      fileId,
      name,
      size: typeof obj.size === "number" && Number.isFinite(obj.size) ? obj.size : 0,
      mime: typeof obj.mime_type === "string" ? obj.mime_type : "",
      description: typeof obj.description === "string" ? obj.description : "",
    };
  } catch {
    return null;
  }
}

/**
 * task-11（2026-08-27-background-subagent-progress）：[TASK_*] 后台任务生命周期行
 * 前缀正则（与 [TOOL_USE]/[SYSTEM:] 同级的前缀方言，daemon task-03 落库）。
 * 命中三前缀之一；捕获组区分行类型（STARTED/PROGRESS/NOTIFICATION 的元数据
 * 映射不同）。
 */
const TASK_LINE_RE = /^\[(TASK_STARTED|TASK_PROGRESS|TASK_NOTIFICATION)\]\s?/;

/** parseTaskLine 产物：tool 段任务元数据五字段的可选子集（task_segment_metadata 契约）。 */
type TaskLineMeta = Pick<
  SessionLogSegment,
  "taskStatus" | "taskElapsedMs" | "taskAsync" | "taskSummary" | "taskToolName"
>;

/**
 * task-11：解析 [TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION] 行的 JSON 载荷，
 * 归一为 tool 段任务元数据（task_log_line_format 契约，daemon session-manager
 * _writeTaskLine 落库形状：前缀 + 单行 JSON；行级 parent_tool_use_id 由归一化
 * 输入携带，不在本函数处理）。字段映射：
 *   - STARTED → taskStatus="running"（async 布尔守卫 → taskAsync；daemon 恒写
 *     async:true，守卫防旧数据/异常形态）；
 *   - PROGRESS → taskElapsedMs（elapsed_ms）/ taskSummary / taskToolName
 *     （last_tool_name）；不动 taskStatus——进行中行不携带状态语义，不误覆盖
 *     STARTED 的 running 或已到达的终态；
 *   - NOTIFICATION → taskStatus=终态（status 三值，daemon 类型契约）+
 *     taskElapsedMs / taskSummary（终态覆盖，到达顺序即权威）。
 *
 * 坏行容错（R-07）：非 JSON / 非对象 / NOTIFICATION 缺合法 status → null，调用方
 * 降级为普通文本行（不抛错不丢行）；未知字段（task_id/total_tokens/tool_uses 等）
 * 忽略——路由走行级 parent_tool_use_id，token 计数走 SSE 卡片通道，均不在此消费。
 */
function parseTaskLine(trimmed: string): TaskLineMeta | null {
  const match = TASK_LINE_RE.exec(trimmed);
  if (!match) return null;
  try {
    const obj = JSON.parse(trimmed.slice(match[0].length)) as {
      status?: unknown;
      elapsed_ms?: unknown;
      summary?: unknown;
      last_tool_name?: unknown;
      async?: unknown;
    } | null;
    if (!obj || typeof obj !== "object") return null;
    const elapsedMs =
      typeof obj.elapsed_ms === "number" && Number.isFinite(obj.elapsed_ms)
        ? obj.elapsed_ms
        : undefined;
    const summary = typeof obj.summary === "string" ? obj.summary : undefined;
    if (match[1] === "TASK_STARTED") {
      return {
        taskStatus: "running",
        ...(typeof obj.async === "boolean" ? { taskAsync: obj.async } : {}),
      };
    }
    if (match[1] === "TASK_PROGRESS") {
      return {
        ...(elapsedMs !== undefined ? { taskElapsedMs: elapsedMs } : {}),
        ...(summary !== undefined ? { taskSummary: summary } : {}),
        ...(typeof obj.last_tool_name === "string" ? { taskToolName: obj.last_tool_name } : {}),
      };
    }
    // TASK_NOTIFICATION：status 必须是三值终态，缺失/非法视为坏行降级文本（防御
    // 运行时异常形态，daemon 侧已有同款守卫）。
    if (obj.status !== "completed" && obj.status !== "failed" && obj.status !== "stopped") {
      return null;
    }
    return {
      taskStatus: obj.status,
      ...(elapsedMs !== undefined ? { taskElapsedMs: elapsedMs } : {}),
      ...(summary !== undefined ? { taskSummary: summary } : {}),
    };
  } catch {
    return null;
  }
}

export function classifySessionLog(
  content: string,
  channel?: string | null,
  toolKind?: string | null,
): SessionLogSegment | null {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("AskUserQuestion")) return null;
  if (/^\[TOOL_RESULT\]\s*User answered/.test(trimmed)) return null;
  if (/^\[(SYSTEM|RESULT)[^\]]*\]/.test(trimmed)) return null;
  // 2026-08-03-session-stream-partial-revoke / FR-04：override 撤回令箭识别。必须在
  // [THINKING] 分支之前——否则 [THINKING_OVERRIDE] 会被 [THINKING] 前缀正则误吞前缀、
  // 丢了 _OVERRIDE 语义。text 留空（override 不渲染正文）。
  const overrideMatch = OVERRIDE_RE.exec(trimmed);
  if (overrideMatch) {
    return {
      kind: "override",
      segmentId: overrideMatch[2],
      variant: overrideMatch[1] === "ASSISTANT_OVERRIDE" ? "assistant" : "thinking",
      text: "",
    };
  }
  if (channel === "stderr") return { kind: "stderr", text: trimmed };
  if (channel === "tool_call") {
    // task-08 / R-07：tool_kind=FileUpload 的行优先映射 file 段（五字段取自 content
    // JSON，design §7.3）——不再误渲染通用 tool_use 段；解析失败回退通用映射不丢行；
    // 未知 / 缺省 tool_kind（含旧调用两参形态）一律走原 tool_use 映射，零回归。
    if (toolKind === "FileUpload") {
      const file = parseFileUploadContent(trimmed);
      if (file) return { kind: "file", text: "", ...file };
    }
    return { kind: "tool_use", text: trimmed };
  }
  // ql-20260730-003 修正：stdout [TOOL_USE] 文本行与 channel=tool_call JSON 是同一工具的
  // 重复记录（daemon 双发），丢弃文本行、以 tool_call JSON 为权威源——否则 tool_use 翻倍、
  // result 仅够配一半，余下永显「执行中 ⏳」（已结束会话也假运行）。
  if (/^\[TOOL_USE\]\s?/.test(trimmed)) {
    return null;
  }
  if (/^\[TOOL_RESULT\]\s?/.test(trimmed)) {
    return { kind: "tool_result", text: trimmed.replace(/^\[TOOL_RESULT\]\s?/, "") };
  }
  // task-11：[TASK_*] 后台任务生命周期行 → kind=task（tool 段元数据载荷，非正文）。
  // 剥前缀的 JSON 原文留在 text（仅供 logsToSegments 内容级去重做键，不进对话正文
  // 与任何投影——applyLogToSegments 按 parent_tool_use_id 路由写入 tool 段后消费）。
  // 坏 JSON / 非法形态 → parseTaskLine 返回 null，落到下方 reply 降级为普通文本
  // 行（R-07 容错不抛错）。
  const taskMeta = parseTaskLine(trimmed);
  if (taskMeta) {
    return { kind: "task", text: trimmed.replace(TASK_LINE_RE, ""), ...taskMeta };
  }
  if (/^\[THINKING\]\s?/.test(trimmed)) {
    return { kind: "thinking", text: trimmed.replace(/^\[THINKING\]\s?/, "") };
  }
  // ql-20260824-017：Claude Code 技能装载注入行。Skill 工具的 tool_result 只有
  // 「Launching skill: X」，SKILL.md 全文随后以 assistant 文本块注入（DB run
  // d01bd6d2 实证）。该行是技能协议载荷而非给用户的答复，归过程信息（装配器挂到
  // 最近 Skill 工具段 result），不进对话正文。仅匹配 [ASSISTANT] 前缀形态——
  // 裸文本（用户手打 / codex 无前缀流）不误吞。
  if (/^\[ASSISTANT\]\s*Base directory for this skill:/i.test(trimmed)) {
    return { kind: "skill", text: trimmed.replace(/^\[ASSISTANT\]\s?/, "") };
  }
  return {
    kind: "reply",
    text: trimmed.replace(/^\[(ASSISTANT|THINKING|LOG:\w+)\]\s?/, ""),
  };
}

/**
 * ql-20260730-003：判断 tool_result 文本是否表示工具执行失败/被拒（→ deny 状态徽章 ✗）。
 * ql-20260801-004：收紧关键词——去掉 error/fail（成功输出正文常含这些字样会误判，如
 *   grep 命中 "fail"、测试报告 "0 errors"），改为只匹配明确拒绝/失败信号。
 *
 * 配对逻辑让 result 拒绝**覆盖** tool_use 的 success（daemon task-runner.ts:1895 把
 * tool_call JSON 的 success 硬编码为 true，语义是「已放行执行」而非「执行成功」，不可作
 * 最终结果权威；真正的 Runtime Policy 拒绝只体现在 result 文本）。故关键词必须精准，
 * 宁可漏判（success 仍兜底 ok）不可误判成功输出正文。
 *
 * 命中「拒绝|denied|失败|禁止写入|not allowed」任一（大小写不敏感）即判 deny。
 * 实时（applyLogToSegments）与历史（logsToSegments）共用，避免两处正则不一致。
 */
export function isToolResultDenied(text: string): boolean {
  return /拒绝|denied|失败|禁止写入|not allowed/i.test(text ?? "");
}

/**
 * ql-20260730-003 修正：从 tool_call JSON raw 解析工具执行状态（状态徽章权威源）。
 *
 * daemon 上报的 tool_call JSON 形如
 *   {"tool":"Bash","args":{...},"tool_use_id":"call_xxx","success":true}
 * 含 `success` 布尔字段——工具执行结果真值。以此定状态徽章，不靠 [TOOL_RESULT] 文本
 * 关键词猜测（避免结果正文里出现 "error"/"fail" 字样误判 ✗）。
 *
 *   - success: true  → "ok"（✓）
 *   - success: false → "deny"（✗）
 *   - 解析失败 / 无 success 字段 → "running"（回退靠后续 result 配对兜底）
 */
export function statusFromToolUseRaw(raw: string): "ok" | "deny" | "running" {
  try {
    const obj = JSON.parse((raw ?? "").trim());
    if (obj && typeof obj.success === "boolean") {
      return obj.success ? "ok" : "deny";
    }
  } catch {
    // 非 JSON（人类可读摘要等），回退 running
  }
  return "running";
}

/* ───────────────────── 接口定义（design §7） ───────────────────── */

/** 归一化日志输入（SSE envelope 与历史 log 统一形状）。 */
export interface AssemblerLogInput {
  logId: string | null;
  channel: string | null;
  content: string | null;
  timestamp: string | null;
  /** partial 半截标识（daemon 协议，三段格式 `main:<msg_id>:<seq>` / `<tool_use_id>:<seq>`）。
   *  task-02 消费：文本/思考段 id 派生 + streaming 置位 + override 撤回前缀路由。 */
  segmentId?: string | null;
  /** override 撤回令箭行的伴随标记。装配不依赖——override 识别走 content 的
   *  [*_OVERRIDE] 前缀（classifySessionLog，平移现有 applyLogToTurn 语义），本字段
   *  仅作为 envelope 附加信息随输入形状保留。 */
  stale?: boolean | null;
  /** 子代理归属三字段（主 agent / 旧数据 → null/undefined → 顶层平铺，depth 视 0）。 */
  parentToolUseId?: string | null;
  subagentType?: string | null;
  depth?: number | null;
  /** 工具种类（AgentRunLog.tool_kind，归一层填入）。task-08：'FileUpload' 的
   *  tool_call 行经 classifySessionLog 第三参优先映射为 file 段。 */
  toolKind?: string | null;
  /** ql-20260824-020：Edit 工具结果 structuredPatch JSON 串（backend 落库透传，
   *  hunks 含真实文件行号）。仅 Edit tool_result 行携带；配对时写到 tool 段
   *  editPatch，展开区优先于 LCS 自算。 */
  editPatch?: string | null;
}

/** 结构化段模型（渲染与派生统计的唯一数据源，design §7）。 */
export type TurnSegment =
  | { kind: "text"; id: string; text: string; streaming: boolean; startedAt: number | null; segId?: string | null }
  | { kind: "thinking"; id: string; text: string; streaming: boolean; ts: number | null; segId?: string | null }
  | {
      /** 工具段：id = 解析自 tool_call JSON 的 tool_use_id（result 配对定位 +
       * 子代理归属路由 key）；解析失败用 logId 兜底（toolName=null 原样显示 raw，R-07）。 */
      kind: "tool";
      id: string;
      /** [TOOL_USE] / tool_call JSON 原文（解析失败原样显示）。 */
      raw: string;
      /** 归属桶内位置配对的 [TOOL_RESULT]（已剥前缀；undefined=尚未配对）。 */
      result?: string;
      /** ql-20260824-020：Edit 结果 structuredPatch JSON（随 result 配对写入；
       *  undefined=无 patch / 非 Edit，展开区回退 LCS 自算行号）。 */
      editPatch?: string;
      status: "running" | "ok" | "deny";
      /** 解析自 raw 的工具名；解析失败 null。 */
      toolName: string | null;
      /** 主参数摘要（命令/路径/描述），规则平移自 turn-timeline parseToolRaw。 */
      primary: string | null;
      startedAt: number | null;
      endedAt: number | null;
      /** 子代理归属段（parent_tool_use_id === 本段 id）。 */
      children: TurnSegment[];
      /** 有子代理归属时记录（子代理目录展示）。 */
      subagentType: string | null;
      /**
       * task-11（2026-08-27-background-subagent-progress / FR-03·07）：后台异步
       * 子代理任务生命周期元数据——[TASK_*] stdout 行按 parent_tool_use_id 路由
       * 写入（刷新/历史回放重建状态；实时卡片另有 agent_task_status SSE 通道）。
       * 全部可选：无 [TASK_*] 行的段恒缺省（前台阻塞式子代理零影响）。
       *   - taskStatus：STARTED→"running"；NOTIFICATION→completed/failed/stopped
       *     （终态覆盖，到达顺序即权威）；
       *   - taskElapsedMs：服务端权威时长（usage.duration_ms，PROGRESS/NOTIFICATION
       *     覆盖式刷新）；
       *   - taskAsync：异步派发标记（STARTED 行 JSON async）；
       *   - taskSummary：进行中/终态摘要（截断展示归渲染层）；
       *   - taskToolName：最近在用的工具名（PROGRESS 行 last_tool_name）。
       * 消费方（turn-status-bar collectSubagents / subagent-catalog 等）对 async
       * 段不再因 result 存在判 done（启动回执 0.1s 配对不是完成信号，design §1）。
       */
      taskStatus?: "running" | "completed" | "failed" | "stopped";
      taskElapsedMs?: number;
      taskAsync?: boolean;
      taskSummary?: string;
      taskToolName?: string;
    }
  | {
      /**
       * 兜底段（design §9.5 / Grill X-05）：子代理消息先于 / 无对应 tool_use 段到达时
       * 的临时容器（顶层平铺位置）；后续 tool 段到达且 id 匹配 → children 合并迁入
       * 该 tool 段后本段移除。
       */
      kind: "subagent_stub";
      /** parent_tool_use_id（此刻已知的唯一 key）。 */
      id: string;
      subagentType: string | null;
      children: TurnSegment[];
    }
  | { kind: "stderr"; id: string; text: string; ts: number | null }
  | {
      /**
       * 上下文前导段（2026-08-25-unified-floating-session task-11）：首轮注入的
       * 【变更上下文】/【页面上下文】/【团队任务简报】前导，从 transcript 中
       * daemon 回传的完整 dispatch_prompt 首条 user_input 提取（与该 user_input
       * 的用户消息部分分离——对话视图保持干净，「全部（进度）」视图显示来源，
       * 解决"注入完全黑盒"问题）。装配器内不主动构造（条目在装配器前即被
       * user_input 通道分流），仅作类型成员由 session-panel 显式构建。
       */
      kind: "preamble";
      id: string;
      /** 前导全文（含"【…上下文】"标题块，"---" 之前的部分）。 */
      text: string;
      ts: number | null;
    }
  | {
      /**
       * 文件段（task-08 / 2026-08-23-agent-file-upload-mcp / design §7.3 / D-001@v1）：
       * tool_kind=FileUpload 日志行（D-007@v1）的分类映射产物——聊天流文件卡片
       * （FileMessageCard）的数据源，task-09 run 详情产出文件区复用同字段。
       * 五字段取自 content JSON；id 走 logId/segmentId 派生 + 唯一后缀；ts 取 log
       * timestamp；兼容投影（segmentsToLegacy）产出 kind:"file" 过程项（历史回放
       * 路径渲染文件卡片，「对话」「全部」两视图均显示）。
       */
      kind: "file";
      id: string;
      /** 文件 id（File 表主键；blob 拉取与下载均经此）。 */
      fileId: string;
      /** 原始文件名。 */
      name: string;
      /** 大小（字节）。 */
      size: number;
      /** MIME（isImageMime 判定缩略图/通用形态）。 */
      mime: string;
      /** 上传描述（agent 填写，可空串）。 */
      description: string;
      ts: number | null;
      segId?: string | null;
    };

export type ToolTurnSegment = Extract<TurnSegment, { kind: "tool" }>;
export type StubTurnSegment = Extract<TurnSegment, { kind: "subagent_stub" }>;
type ContainerTurnSegment = ToolTurnSegment | StubTurnSegment;

/**
 * 兼容投影的工具事件（design §9.4）——形状与 turn-timeline.tsx 的 SessionToolEvent
 * 逐字段一致（结构化类型兼容；task-05 渲染层收编后统一从此 import）。
 */
export interface SessionToolEvent {
  raw: string;
  result?: string;
  status: "running" | "ok" | "deny";
}

/**
 * 兼容投影的过程项（design §9.4）——形状与 turn-timeline.tsx 的 SessionProcessItem
 * 逐字段一致（tool.startedAt → ts；thinking/stderr.ts → ts，AskUser 穿插排序依赖
 * 时间戳字段）。投影不含 text 段（文本走 output 拼接）。
 */
export type SessionProcessItem =
  | { kind: "thinking"; text: string; ts?: number }
  | ({ kind: "tool" } & SessionToolEvent & { ts?: number })
  | { kind: "stderr"; text: string; ts?: number }
  // agent-file-upload-mcp：file 段的历史回放投影项（与 turn-timeline 同名类型逐字段一致）
  | {
      kind: "file";
      fileId: string;
      name: string;
      size: number;
      mime: string;
      description?: string | null;
      ts?: number;
    };

/** 装配产物（单 turn）：段序列 + 兼容投影 + 计时锚点（design §7）。 */
export interface AssembledTurn {
  segments: TurnSegment[];
  /** 兼容投影（§9.4）：output = 文本段按序拼接（DFS 序，含子代理文本——与现状
   *  全量 concat 等价）；processItems = 平铺投影。 */
  output: string;
  processItems: SessionProcessItem[];
  /** 计时锚点（§7.5）：live = 调用方本地发送占位时刻；attach = run.started_at；
   *  两者皆缺 = 首条 log timestamp（applyLogToSegments 兜底写入）。 */
  turnStartedAt: number | null;
  /** log_id 去重集合（task-02 填充）：SSE 实时路径——log 事件携带 log_id 时记入，
   *  重复 input 原引用返回（R-01 重连 / 事件重放）；历史批量路径不用本集合去重，
   *  另走 logsToSegments 的 seenText 内容级去重（两路语义不合并，Grill X-08）。 */
  seenLogIds: Set<string>;
}

/* ───────────────────── 内部工具 ───────────────────── */

/** ISO timestamp → ms；缺失 / 非法 → null（时间一律取自输入，不读本地时钟）。 */
function parseLogTs(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}

/** 空白归一：null/undefined/纯空白 → null，其余 trim 后返回。 */
function nonEmptyString(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

/* ───────────────── F7 增量装配内部状态（symbol 键、enumerable，随 spread 流转） ───────────────── */

/**
 * 兼容投影增量 cell（F7）：output / processItems 的当前值 + DFS 末位锚点，供
 * applyLogToSegments 判定「partial 续接末位段」走 O(1) 增量。不变式：turn 携带
 * cell 时，cell 值恒等于 segmentsToLegacy(turn.segments)（全量重算对拍测试锁定）。
 */
interface LegacyCell {
  output: string;
  processItems: SessionProcessItem[];
  /** DFS 序最后一个 text 段 id（text partial 续接的增量判定锚）。 */
  lastTextSegId: string | null;
  /** DFS 平铺投影最后一个过程项的所属段 id（thinking partial 续接的增量判定锚）。 */
  lastItemSegId: string | null;
}

const LEGACY_CELL: unique symbol = Symbol("assemblerLegacyCell");
const SEGMENT_ID_INDEX: unique symbol = Symbol("assemblerSegmentIds");
/**
 * quick-9f86d2c3（会话 e87622aa）：已被完整行覆盖（收编 / 封存）的 partial segmentId
 * 集合——同 segmentId 的后续 partial 窗口（重放增量）一律跳过。turn 链共享同一可变
 * Set（语义同 seenLogIds：对象展开随行、原地记入）。
 */
const SUPERSEDED_SEG_IDS: unique symbol = Symbol("assemblerSupersededSegIds");

interface AssemblerInternalsCarrier {
  [LEGACY_CELL]?: LegacyCell;
  [SEGMENT_ID_INDEX]?: Set<string>;
  [SUPERSEDED_SEG_IDS]?: Set<string>;
}

/**
 * 全量重投影 + 末位锚点扫描（增量不适用时的兜底，值与急切投影逐字节一致）。
 * legacyProjectionBuildCount 仅测试观测用（性质回归：partial 流不触发全量重投影）。
 */
let legacyProjectionBuildCount = 0;
export function legacyProjectionBuildsForTest(): number {
  return legacyProjectionBuildCount;
}

function buildLegacyCell(segments: TurnSegment[]): LegacyCell {
  legacyProjectionBuildCount += 1;
  const legacy = segmentsToLegacy(segments);
  let lastTextSegId: string | null = null;
  let lastItemSegId: string | null = null;
  // 锚点扫描与 segmentsToLegacy 同一 DFS 顺序（tool 自身项先于 children 项）
  const walk = (list: TurnSegment[]) => {
    for (const s of list) {
      switch (s.kind) {
        case "text":
          lastTextSegId = s.id;
          break;
        case "thinking":
          lastItemSegId = s.id;
          break;
        case "tool":
          lastItemSegId = s.id;
          walk(s.children);
          break;
        case "subagent_stub":
          walk(s.children);
          break;
        case "stderr":
        case "file":
          lastItemSegId = s.id;
          break;
      }
    }
  };
  walk(segments);
  return {
    output: legacy.output,
    processItems: legacy.processItems,
    lastTextSegId,
    lastItemSegId,
  };
}

/** 把 cell / id 索引 / 封存集合以 enumerable symbol 键挂到 target（对象展开自动随行）。 */
function attachInternals(
  target: AssembledTurn,
  cell: LegacyCell,
  idIndex: Set<string> | null,
  superseded: Set<string> | null = null,
): void {
  Object.defineProperty(target, LEGACY_CELL, {
    value: cell,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  if (idIndex) {
    Object.defineProperty(target, SEGMENT_ID_INDEX, {
      value: idIndex,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (superseded) {
    Object.defineProperty(target, SUPERSEDED_SEG_IDS, {
      value: superseded,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}

/** 惰性取 / 建 turn 链共享的封存 segmentId 集合（quick-9f86d2c3）。 */
function supersededSegIdsOf(turn: AssembledTurn): Set<string> {
  const carrier = turn as AssembledTurn & AssemblerInternalsCarrier;
  let set = carrier[SUPERSEDED_SEG_IDS];
  if (!set) {
    set = new Set<string>();
    Object.defineProperty(turn, SUPERSEDED_SEG_IDS, {
      value: set,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return set;
}

/**
 * 把 source 携带的装配器内部状态（投影 cell / 段 id 索引）转移到 segments 同源的
 * target——消费方（session-panel asAssembled / assembledViewOf）构造收窄视图时
 * 调用，保持增量链不断（symbol 键 enumerable，对象展开自动随行，直传视图除外）。
 * source 未携带（外部构造 turn）时无副作用，applyLog 回退全量重投影。
 */
export function transferAssemblerInternals(target: AssembledTurn, source: AssembledTurn): void {
  const carrier = source as AssembledTurn & AssemblerInternalsCarrier;
  const cell = carrier[LEGACY_CELL];
  const index = carrier[SEGMENT_ID_INDEX];
  if (cell) attachInternals(target, cell, index ?? null, carrier[SUPERSEDED_SEG_IDS] ?? null);
}

/**
 * 双调幂等记忆（F7，按 seenLogIds 身份单槽）：React StrictMode double-invoke
 * updater 时第二次调用直接复返首次产物。见文件头 F7 注记。
 */
const applyResultMemo = new WeakMap<Set<string>, { logId: string; next: AssembledTurn }>();

/**
 * log_id 记入（F7）：turn 链共享同一可变 Set（turn 对象仍每条新建，引用沿链传递；
 * 无消费方依赖 Set 身份判等做 memo，已核实）。无 logId 时不动集合。
 */
function recordSeenLogId(seen: Set<string>, logId: string | null | undefined): Set<string> {
  if (logId) seen.add(logId);
  return seen;
}

/** 递归收集树内全部段 id（id 索引缺失时的回退收集）。 */
function collectSegmentIds(segments: TurnSegment[], ids: Set<string>): void {
  for (const s of segments) {
    ids.add(s.id);
    if (s.kind === "tool" || s.kind === "subagent_stub") {
      collectSegmentIds(s.children, ids);
    }
  }
}

/**
 * 新段 id 派生（F7：链内共享 id 索引 O(1)，替代全树收集）：优先 segmentId / logId
 * （design §7「tool id / segmentId / logId 派生」），均缺用 时间戳+内容长度 兜底；
 * 与索引内既有 id 冲突时追加 -2/-3… 后缀（同一 segmentId 的 partial 文本被工具段
 * 打断会分裂多段——R-06，段 id 必须按段唯一）。
 */
function makeUniqueSegmentId(index: Set<string>, base: string): string {
  if (!index.has(base)) {
    index.add(base);
    return base;
  }
  let n = 2;
  while (index.has(`${base}-${n}`)) n += 1;
  const id = `${base}-${n}`;
  index.add(id);
  return id;
}

function segmentIdBase(input: AssemblerLogInput, kind: string, ts: number | null): string {
  const key =
    nonEmptyString(input.segmentId) ??
    nonEmptyString(input.logId) ??
    `t${ts ?? "x"}-l${(input.content ?? "").length}`;
  return `${kind}:${key}`;
}

/**
 * 段 id 是否由该 segmentId 派生（task-02 撤回定位 / partial 续接判定）：直接派生
 * id 为 `<kind>:<segmentId>`；被工具段打断或与异源段交错分裂出的后续段经
 * makeUniqueSegmentId 追加 `-2`/`-3`…（可链式）后缀——按前缀一网打尽（R-06 跨段
 * 撤回）。注：segmentId 本身以 `-<数字>` 结尾时与他段派生 id 存在理论歧义，这是
 * id 派生方案的固有限度（daemon segmentId 用 `:` 分段、序号在尾段，实践不撞）。
 */
function derivesFromSegmentId(
  id: string,
  kind: "text" | "thinking",
  segmentId: string,
): boolean {
  const base = `${kind}:${segmentId}`;
  return id === base || id.startsWith(`${base}-`);
}

/** DFS 全树找 id 匹配的 tool 段（子代理路由目标；嵌套 children 一并搜）。 */
function findToolById(segments: TurnSegment[], id: string): ToolTurnSegment | null {
  for (const s of segments) {
    if (s.kind === "tool") {
      if (s.id === id) return s;
      const inner = findToolById(s.children, id);
      if (inner) return inner;
    } else if (s.kind === "subagent_stub") {
      const inner = findToolById(s.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

/** DFS 全树找 id 匹配的 subagent_stub 段（stub 只在顶层创建，DFS 为防御兜底）。 */
function findStubById(segments: TurnSegment[], id: string): StubTurnSegment | null {
  for (const s of segments) {
    if (s.kind === "subagent_stub") {
      if (s.id === id) return s;
      const inner = findStubById(s.children, id);
      if (inner) return inner;
    } else if (s.kind === "tool") {
      const inner = findStubById(s.children, id);
      if (inner) return inner;
    }
  }
  return null;
}

function treeContainsContainerWithId(segments: TurnSegment[], id: string): boolean {
  for (const s of segments) {
    if (s.kind === "tool" || s.kind === "subagent_stub") {
      if (s.id === id) return true;
      if (treeContainsContainerWithId(s.children, id)) return true;
    }
  }
  return false;
}

/**
 * path-copy 更新：把 id 匹配的 tool / stub 容器替换为 update(container) 的产物，
 * 只克隆根到该容器的路径，未触及的兄弟段保持原引用（FR-06 段引用稳定）。
 * 未找到匹配（防御：路由已保证存在）原样返回。
 */
function updateContainerById(
  segments: TurnSegment[],
  id: string,
  update: (c: ContainerTurnSegment) => ContainerTurnSegment,
): TurnSegment[] {
  const out = segments.slice();
  for (let i = 0; i < out.length; i += 1) {
    const s = out[i];
    if (s && (s.kind === "tool" || s.kind === "subagent_stub")) {
      if (s.id === id) {
        out[i] = update(s);
        return out;
      }
      if (treeContainsContainerWithId(s.children, id)) {
        out[i] = { ...s, children: updateContainerById(s.children, id, update) };
        return out;
      }
    }
  }
  return out;
}

/**
 * 从树上摘除 id 匹配的 subagent_stub（兜底合并用），返回摘除后的树与 stub 本体
 * （children / subagentType 随迁到新 tool 段）。未找到原样返回。
 */
function extractStubById(
  segments: TurnSegment[],
  id: string,
): { segments: TurnSegment[]; stub: StubTurnSegment | null } {
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    if (s && s.kind === "subagent_stub" && s.id === id) {
      return { segments: [...segments.slice(0, i), ...segments.slice(i + 1)], stub: s };
    }
    if (s && (s.kind === "tool" || s.kind === "subagent_stub")) {
      const inner = extractStubById(s.children, id);
      if (inner.stub) {
        return {
          segments: [
            ...segments.slice(0, i),
            { ...s, children: inner.segments },
            ...segments.slice(i + 1),
          ],
          stub: inner.stub,
        };
      }
    }
  }
  return { segments, stub: null };
}

/**
 * 往装配桶应用一次变换：bucketId=null → 顶层段数组；否则 → id 匹配容器的 children。
 * 顺带在容器尚无 subagentType 且本条 log 携带时补记（子代理目录展示，FR-03）。
 */
function applyToBucket(
  segments: TurnSegment[],
  bucketId: string | null,
  subagentType: string | null,
  op: (children: TurnSegment[]) => TurnSegment[],
): TurnSegment[] {
  if (bucketId === null) return op(segments);
  return updateContainerById(segments, bucketId, (c) => {
    const children = op(c.children);
    if (subagentType && !c.subagentType) {
      return { ...c, children, subagentType };
    }
    return { ...c, children };
  });
}

/**
 * task-11（2026-08-27-background-subagent-progress）：把 [TASK_*] 行解析出的任务
 * 元数据合并进派发 tool 段（path-copy，仅覆盖本行携带的字段——PROGRESS 不动
 * 状态、NOTIFICATION 终态覆盖 STARTED 的 running，到达顺序即权威）。元数据不
 * 参与兼容投影（segmentsToLegacy 不读这些字段），投影值不变。
 */
function applyTaskMeta(tool: ToolTurnSegment, meta: TaskLineMeta): ToolTurnSegment {
  return {
    ...tool,
    ...(meta.taskStatus !== undefined ? { taskStatus: meta.taskStatus } : {}),
    ...(meta.taskElapsedMs !== undefined ? { taskElapsedMs: meta.taskElapsedMs } : {}),
    ...(meta.taskAsync !== undefined ? { taskAsync: meta.taskAsync } : {}),
    ...(meta.taskSummary !== undefined ? { taskSummary: meta.taskSummary } : {}),
    ...(meta.taskToolName !== undefined ? { taskToolName: meta.taskToolName } : {}),
  };
}

/**
 * override 撤回（task-02 / R-06 / Grill X-06）：按 segmentId 前缀路由目标桶——
 * `main:` → 顶层段；`<tool_use_id>:` → 该 id 匹配容器（tool / stub，DFS 含嵌套）的
 * children；无 `:` 视同 main（顶层）。桶内移除该 segmentId 派生的全部同类段：
 * - variant=assistant → 撤 text 段（文本截断语义：派生段内文本全部来自该 partial，
 *   整段移除即从 output 投影截断其贡献，前后他段文本保留拼接——同现有
 *   partialSegmentsRef 的 outputStart/length 范围截断，段模型跨段版）；
 * - variant=thinking → 撤 thinking 段（思考项移除语义，跨段派生一并移除）。
 * 段移除即 streaming 随段消失（清除语义）。无匹配段 / 无匹配容器 → null（调用方
 * 静默 no-op，对齐现有 partialSegments.get 未命中即 return 的行为）。
 */
function revokePartialSegments(
  segments: TurnSegment[],
  segmentId: string,
  variant: "assistant" | "thinking",
  removedIds: Set<string>,
): TurnSegment[] | null {
  const colon = segmentId.indexOf(":");
  const prefix = colon > 0 ? segmentId.slice(0, colon) : "main";
  const kind: "text" | "thinking" = variant === "assistant" ? "text" : "thinking";
  const removeAll = (children: TurnSegment[]): TurnSegment[] =>
    children.filter((s) => {
      const hit = s.kind === kind && derivesFromSegmentId(s.id, kind, segmentId);
      if (hit) removedIds.add(s.id);
      return !hit;
    });

  if (prefix === "main") {
    const next = removeAll(segments);
    return next.length === segments.length ? null : next;
  }
  if (!treeContainsContainerWithId(segments, prefix)) return null;
  let changed = false;
  const next = updateContainerById(segments, prefix, (c) => {
    const children = removeAll(c.children);
    changed = children.length !== c.children.length;
    return { ...c, children };
  });
  return changed ? next : null;
}

/** 解析 tool_call JSON 的产物：toolUseId（配对 / 路由 key）+ 展示摘要。 */
interface ParsedToolUse {
  toolUseId: string | null;
  toolName: string | null;
  primary: string | null;
}

function stringArg(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * 主参数摘要提取——规则平移自 turn-timeline.tsx parseToolRaw（design §12：解析规则
 * 平移不重造）：Bash→command；Write/Edit/Read→file_path；Agent→description??prompt；
 * 通用→description??command??file_path??prompt??pattern??query??url??raw 前 120 字符。
 * ql-20260820-008：通用链补 pattern（Grep/Glob）/query（WebSearch/WebFetch）/url——
 * 此前不认识的工具落到「整个 JSON 截前 120 字符」，列表/状态条显示半截 JSON。
 */
function extractPrimaryArg(
  tool: string | null,
  args: Record<string, unknown>,
  raw: string,
): string {
  if (tool === "Bash") return stringArg(args.command) ?? "";
  if (tool === "Write" || tool === "Edit" || tool === "Read") {
    return stringArg(args.file_path) ?? "";
  }
  if (tool === "Agent") {
    return stringArg(args.description) ?? stringArg(args.prompt) ?? "";
  }
  return (
    stringArg(args.description) ??
    stringArg(args.command) ??
    stringArg(args.file_path) ??
    stringArg(args.prompt) ??
    stringArg(args.pattern) ??
    stringArg(args.query) ??
    stringArg(args.url) ??
    raw.slice(0, 120)
  );
}

/** 解析 tool_call JSON：tool_use_id / 工具名 / 主参数摘要；解析失败全 null（R-07 容错）。 */
function parseToolUseRaw(raw: string): ParsedToolUse {
  try {
    const obj = JSON.parse((raw ?? "").trim()) as {
      tool?: unknown;
      tool_use_id?: unknown;
      args?: unknown;
    } | null;
    if (!obj || typeof obj !== "object") {
      return { toolUseId: null, toolName: null, primary: null };
    }
    const toolName = stringArg(obj.tool);
    const toolUseId = stringArg(obj.tool_use_id);
    const args = (obj.args && typeof obj.args === "object" ? obj.args : {}) as Record<
      string,
      unknown
    >;
    return { toolUseId, toolName, primary: extractPrimaryArg(toolName, args, raw) };
  } catch {
    return { toolUseId: null, toolName: null, primary: null };
  }
}

/* ───────────────────── 导出 API ───────────────────── */

/** 空装配产物构造（实时路径 turn 初始值；turnStartedAt 由调用方传发送占位时刻）。 */
export function createEmptyAssembledTurn(turnStartedAt: number | null = null): AssembledTurn {
  return {
    segments: [],
    output: "",
    processItems: [],
    turnStartedAt,
    seenLogIds: new Set(),
  };
}

/** partial 续接上报（F7 增量投影判定用）：merge 目标段 id / kind / 合并后全文 / ts。 */
interface StreamMergeReport {
  id: string;
  kind: "text" | "thinking";
  text: string;
  ts: number | null;
}

/**
 * SSE 增量：单条 log 落到 turn（替代现有两处 applyLogToTurn 副本，design §7）。
 *
 * 纯函数：不修改入参 turn（path-copy 产出新树），无内容变化（分类丢弃 / override
 * 无匹配段 / 重复 log_id / user_input）时原引用返回。内容变更路径记入 log_id 去重
 * 集合（task-02）；override 撤回（有匹配段）与各分段追加均维护 output / processItems
 * 投影（F7：热路径 partial 续接走 O(1) 增量，结构变更全量重投影，值与改前逐字节
 * 一致），无归属字段（parentToolUseId 空）时与现有 applyLogToTurn / logsToTurns
 * 产出等价（§9.1）。
 */
export function applyLogToSegments(
  turn: AssembledTurn,
  input: AssemblerLogInput,
): AssembledTurn {
  // channel=user_input 是用户消息（prompt）——归调用方 turn 级胶水（logsToTurns 分组
  // 提取 / 页面发送占位），不装配进段（design §7 logsToSegments 注 / Grill X-05）。
  if (input.channel === "user_input") return turn;

  // F7 双调幂等（React StrictMode double-invoke setState updater）：同 (Set 身份,
  // logId) 的立即重放直接复返首次产物——共享 seenLogIds 已被首次调用 add，重查会
  // 被误判为重复事件而丢内容。真正的迟到重放（prev 已含该 log 内容）不在此列：
  // 记忆为单槽，后续任何新 log 都会覆盖槽位，落回下方集合命中原引用返回。
  const memo = applyResultMemo.get(turn.seenLogIds);
  if (input.logId && memo && memo.logId === input.logId) return memo.next;

  // log_id 去重（SSE 实时路径，task-02）：重复事件原引用返回（R-01 重连 / 事件重放），
  // 对齐现有 applyLogToTurn 的 seenLogIds 入口检查。
  if (input.logId && turn.seenLogIds.has(input.logId)) return turn;

  const seg = classifySessionLog(input.content ?? "", input.channel, input.toolKind);
  if (!seg) return turn;

  // 段 id 索引（F7）：链内共享 Set 惰性物化——纯 partial 续接不建新段，全程不触发
  // 收集；索引随 turn 链流转（spread 自动复制），缺失时首条建新段的 log 全树收集一次。
  const turnIndex = (turn as AssembledTurn & AssemblerInternalsCarrier)[SEGMENT_ID_INDEX];
  let idIndex: Set<string> | null = turnIndex ?? null;
  const ids = (): Set<string> => {
    if (!idIndex) {
      idIndex = new Set<string>();
      collectSegmentIds(turn.segments, idIndex);
    }
    return idIndex;
  };

  // override 撤回令箭（task-02）：撤回信号非内容，不渲染进段——按 segmentId 前缀路由
  // 定位桶，移除该 segmentId 派生的全部分裂段（R-06 跨段撤回；assistant 文本截断 /
  // thinking 项移除，语义平移自 applyLogToTurn 的 partialSegmentsRef），重算投影。
  // segmentId / variant 由 classifySessionLog 的 OVERRIDE_RE 捕获组保证；类型上可选，
  // 缺失属畸形令箭——静默 no-op 原引用返回（对齐现有 Map 未命中即 return）。
  if (seg.kind === "override") {
    if (!seg.segmentId || !seg.variant) return turn;
    const removedIds = new Set<string>();
    const revoked = revokePartialSegments(turn.segments, seg.segmentId, seg.variant, removedIds);
    if (!revoked) return turn;
    removedIds.forEach((id) => ids().delete(id));
    // quick-9f86d2c3：override 撤回 = 该 segment 已被完整行覆盖 → 封存 segmentId，
    // 后续同源重放 partial 一并免疫（共享 Set 原地记入，随链流转）。
    const superseded = supersededSegIdsOf(turn);
    superseded.add(seg.segmentId);
    const cell = buildLegacyCell(revoked);
    const next: AssembledTurn = {
      segments: revoked,
      output: cell.output,
      processItems: cell.processItems,
      turnStartedAt: turn.turnStartedAt,
      seenLogIds: recordSeenLogId(turn.seenLogIds, input.logId),
    };
    attachInternals(next, cell, idIndex, superseded);
    if (input.logId) applyResultMemo.set(turn.seenLogIds, { logId: input.logId, next });
    return next;
  }

  // task-11（2026-08-27-background-subagent-progress / FR-03·07 前端半）：[TASK_*]
  // 后台任务生命周期行 → 按行级 parent_tool_use_id 路由写入派发 tool 段元数据
  // （刷新/历史回放重建状态；实时卡片状态另有 agent_task_status SSE 通道）。
  // 与 override 同属「信号非内容」提前路径：
  //   - 行本身不产生任何正文/过程段（消费后折叠进段元数据，不显示为普通文本行）；
  //   - 路由目标 = parent_tool_use_id 匹配的 tool 段（复用既有归属路由的容器定位
  //     DFS，含嵌套 children）。找不到（历史孤儿 / 行级归属缺失 / 目标仅为
  //     subagent_stub 的极端时序——stub 无元数据槽，tool_call JSON 到达合并后由
  //     后续 [TASK_*] 行补写）→ 丢弃该行原引用返回，不建 stub 空壳、不落顶层
  //     （硬约束：找不到段时不崩，取更安全者）；
  //   - 元数据不参与兼容投影（output/processItems 值不变）→ 投影 cell 原样复用，
  //     不触发全量重投影（F7 增量链不断；外部构造 turn 无 cell 时全量建一次，
  //     维持「携带 cell 则恒等全量投影」不变式）。
  if (seg.kind === "task") {
    const parent = nonEmptyString(input.parentToolUseId);
    if (parent && findToolById(turn.segments, parent)) {
      const next = updateContainerById(turn.segments, parent, (c) =>
        c.kind === "tool" ? applyTaskMeta(c, seg) : c,
      );
      const prevCell = (turn as AssembledTurn & AssemblerInternalsCarrier)[LEGACY_CELL];
      const cell = prevCell ?? buildLegacyCell(next);
      const nextTurn: AssembledTurn = {
        segments: next,
        output: cell.output,
        processItems: cell.processItems,
        // 计时锚点兜底同主路径（§7.5）：live/attach 均缺时取本行 timestamp。
        turnStartedAt: turn.turnStartedAt ?? parseLogTs(input.timestamp),
        seenLogIds: recordSeenLogId(turn.seenLogIds, input.logId),
      };
      attachInternals(nextTurn, cell, idIndex);
      if (input.logId) {
        applyResultMemo.set(turn.seenLogIds, { logId: input.logId, next: nextTurn });
      }
      return nextTurn;
    }
    return turn;
  }

  const ts = parseLogTs(input.timestamp);
  const subagentType = nonEmptyString(input.subagentType);
  let segments = turn.segments;
  let mergedInto: StreamMergeReport | null = null;

  // 1. tool_use 兜底合并（§9.5）：同 tool_use_id 的 subagent_stub 已存在（子消息先
  //    到）→ 摘除 stub，其 children / subagentType 随迁到即将创建的 tool 段。
  const parsedTool = seg.kind === "tool_use" ? parseToolUseRaw(seg.text) : null;
  let adoptedChildren: TurnSegment[] = [];
  let adoptedSubagentType: string | null = null;
  if (parsedTool && parsedTool.toolUseId) {
    const extracted = extractStubById(segments, parsedTool.toolUseId);
    if (extracted.stub) {
      segments = extracted.segments;
      adoptedChildren = extracted.stub.children;
      adoptedSubagentType = extracted.stub.subagentType;
    }
  }

  // 2. 归属路由（§5 Phase1.3）：parent_tool_use_id 非空 → 装配桶 = 匹配 tool 段或
  //    stub 段的 children；均无 → 顶层新建 subagent_stub 兜底段（平铺位置，§9.5，
  //    后续 tool 段到达时由步骤 1 合并迁入）。空 / 缺省 → 顶层平铺（主 agent /
  //    Codex / 旧数据，depth 视 0——嵌套关系由 parent 链表达，不依赖 depth 字段）。
  const parent = nonEmptyString(input.parentToolUseId);
  let bucketId: string | null = null;
  let routeSubagentType = subagentType;
  if (parent) {
    if (findToolById(segments, parent) || findStubById(segments, parent)) {
      bucketId = parent;
    } else {
      segments = [
        ...segments,
        { kind: "subagent_stub", id: parent, subagentType, children: [] },
      ];
      ids().add(parent);
      bucketId = parent;
      // stub 创建时已写入 subagentType，容器无需再补。
      routeSubagentType = null;
    }
  }

  // 3. 分段装配（§5 Phase1.4）。
  switch (seg.kind) {
    case "reply":
    case "thinking":
      // 裸前缀行（剥后空文本）不产生空段（净效果同现有 applyLogToTurn 追加空串——
      // output 不变）；log_id 照记（去重语义不受影响，走尾部统一路径）。
      if (seg.text === "") break;
      {
        // quick-9f86d2c3（会话 e87622aa 重复段+光标常闪）：终态轮迟到 partial 兜底。
        // 事件序：full 先落段（实时 SSE），partial（同内容前缀）因 Redis 发布丢失/
        // 延迟在 turn_completed 后经轮后对账/断线重放到达——原 dropPrefixPartialReply
        // 只收编「partial 先到、full 后到」正向序，反序时 partial 以 streaming=true
        // 新段落地且 finishTurn 已跑过永不再清。此处反向收编：归属桶内已有完整行
        // （segId 空 text 段）的文本是该 partial 的前缀超集 → 该 segment 已被覆盖，
        // 封存 segmentId 并跳过落段（同 segmentId 后续重放窗口一并免疫）。
        const partialSegId = seg.kind === "reply" ? nonEmptyString(input.segmentId) : null;
        if (partialSegId) {
          const superseded = supersededSegIdsOf(turn);
          if (superseded.has(partialSegId)) break;
          if (bucketCoveredByFullText(segments, bucketId, seg.text)) {
            superseded.add(partialSegId);
            break;
          }
        } else if (seg.kind === "reply") {
          // 用户反馈⑥防御：完整回复行 + 遗留 partial（override 丢失）前缀命中 →
          // 先移除 partial（ql-20260820-011 的 override 协同不受影响：override 正常
          // 到达时 partial 已被撤走，此处为空操作）。quick-9f86d2c3：吸收成功时封存
          // 该 segmentId，后续同源重放窗口不再复活。
          const superseded = supersededSegIdsOf(turn);
          segments = dropPrefixPartialReply(
            segments,
            bucketId,
            routeSubagentType,
            seg.text,
            (sealedSegId) => superseded.add(sealedSegId),
          );
        }
        const appended = appendStreamText(
          segments,
          bucketId,
          routeSubagentType,
          seg.kind === "reply" ? "text" : "thinking",
          seg.text,
          ts,
          input,
          ids,
        );
        segments = appended.segments;
        mergedInto = appended.mergedInto;
      }
      break;
    case "tool_use": {
      const toolSegId =
        (parsedTool && parsedTool.toolUseId) ||
        makeUniqueSegmentId(ids(), segmentIdBase(input, "tool", ts));
      if (parsedTool && parsedTool.toolUseId) ids().add(parsedTool.toolUseId);
      segments = applyToBucket(segments, bucketId, routeSubagentType, (children) => [
        ...children,
        {
          kind: "tool",
          // 段 id = tool_use_id（result 配对 + 子代理路由 key）；解析失败用
          // logId 等兜底（toolName=null，渲染原样显示 raw，R-07）。
          id: toolSegId,
          raw: seg.text,
          // 初始状态取 tool_call JSON 的 success（权威源）；running 靠后续
          // result 配对兜底（statusFromToolUseRaw 注）。
          status: statusFromToolUseRaw(seg.text),
          toolName: (parsedTool && parsedTool.toolName) || null,
          primary: parsedTool ? parsedTool.primary : null,
          startedAt: ts,
          endedAt: null,
          children: adoptedChildren,
          subagentType: adoptedSubagentType,
        },
      ]);
      break;
    }
    case "skill":
      // ql-20260824-017：技能装载注入行——挂到同桶最近 Skill 工具段 result（过程
      // 信息，Skill 工具卡展开可见全文），无匹配段时退化文本段兜底（见函数注）。
      {
        const attached = attachSkillInjection(
          segments,
          bucketId,
          routeSubagentType,
          seg.text,
          ts,
          input,
          ids,
        );
        segments = attached.segments;
        mergedInto = attached.mergedInto;
      }
      break;
    case "tool_result":
      // 归属桶内位置配对（§5 Phase1.4 / Grill X-02）：tool_result 行（SSE/DB）不携带
      // 自身 tool_use_id，沿用「最后一个未配对 tool 项」位置规则，但配对范围限定
      // 同一归属桶（本 log 的 parent_tool_use_id），支撑主/子代理工具交错场景。
      segments = applyToBucket(segments, bucketId, routeSubagentType, (children) => {
        for (let i = children.length - 1; i >= 0; i -= 1) {
          const t = children[i];
          if (t && t.kind === "tool" && t.result === undefined) {
            return [
              ...children.slice(0, i),
              {
                ...t,
                result: seg.text,
                // ql-20260824-020：structuredPatch 随配对写入（仅 Edit tool_result
                // 行携带；undefined 不影响其他工具）。
                editPatch: input.editPatch ?? undefined,
                // result 拒绝优先覆盖 use 的 success（daemon success 恒 true 不可信，
                // isToolResultDenied 注）；仅 running（success 未解析出）时兜底 ok。
                status: isToolResultDenied(seg.text)
                  ? "deny"
                  : t.status === "running"
                    ? "ok"
                    : t.status,
                endedAt: ts,
              },
              ...children.slice(i + 1),
            ];
          }
        }
        // 孤儿 result（桶内无未配对 tool 段）：raw 空串的 tool 段兜底，不丢数据
        // （同 legacy processItems 孤儿项；拒绝孤儿也判 deny，不硬编码 ok）。
        return [
          ...children,
          {
            kind: "tool",
            id: makeUniqueSegmentId(ids(), segmentIdBase(input, "tool", ts)),
            raw: "",
            result: seg.text,
            editPatch: input.editPatch ?? undefined,
            status: isToolResultDenied(seg.text) ? "deny" : "ok",
            toolName: null,
            primary: null,
            startedAt: ts,
            endedAt: ts,
            children: [],
            subagentType: null,
          },
        ];
      });
      break;
    case "stderr":
      segments = applyToBucket(segments, bucketId, routeSubagentType, (children) => [
        ...children,
        {
          kind: "stderr",
          id: makeUniqueSegmentId(ids(), segmentIdBase(input, "stderr", ts)),
          text: seg.text,
          ts,
        },
      ]);
      break;
    case "file": {
      // task-08（design §7.3）：FileUpload 行的结构化产物按归属桶原位追加——主
      // agent 上传落顶层、子代理上传（parent_tool_use_id 非空）落父工具段 children。
      // id 走 logId/segmentId 派生 + 唯一后缀；ts 取 log timestamp；五字段由
      // classifySessionLog 的 file 分支保证非空（?? 兜底仅类型收窄）；segId 按既有
      // 段派生规则仅在输入携带时写入（FileUpload 行为完整行，实践不带）。
      const fileSegId = nonEmptyString(input.segmentId);
      segments = applyToBucket(segments, bucketId, routeSubagentType, (children) => [
        ...children,
        {
          kind: "file",
          id: makeUniqueSegmentId(ids(), segmentIdBase(input, "file", ts)),
          fileId: seg.fileId ?? "",
          name: seg.name ?? "",
          size: seg.size ?? 0,
          mime: seg.mime ?? "",
          description: seg.description ?? "",
          ts,
          ...(fileSegId ? { segId: fileSegId } : {}),
        },
      ]);
      break;
    }
    default:
      // classifySessionLog 仅产上述七类 + override / task（两者已在 switch 前的
      // 提前路径消费返回），防御分支。
      break;
  }

  // 4. 兼容投影（§9.4，F7 增量维护）+ 计时锚点兜底（§7.5：live / attach 锚点由调用
  //    方置入 turnStartedAt，均缺时取首条有效 log timestamp）+ log_id 记入（内容变更
  //    路径，task-02）。增量规则（消费方调研结论：投影在热路径只被透传/展开，无逐条
  //    读取，增量值与全量重算逐字节一致，对拍测试锁定）：
  //    - text partial 续接 DFS 末位 text 段 → output 尾接增量，processItems 引用复用；
  //    - thinking partial 续接 DFS 末位过程项段 → 末项文本替换（数组浅拷贝）；
  //    - 无结构变更（裸前缀空文本行）→ cell 原样；
  //    - 其余（新建段 / 配对 / 撤回 / 无 cell 外部构造 turn）→ 全量重投影重建 cell。
  const prevCell = (turn as AssembledTurn & AssemblerInternalsCarrier)[LEGACY_CELL];
  let cell: LegacyCell;
  if (
    prevCell &&
    mergedInto &&
    mergedInto.kind === "text" &&
    prevCell.lastTextSegId === mergedInto.id
  ) {
    cell = {
      output: prevCell.output + seg.text,
      processItems: prevCell.processItems,
      lastTextSegId: prevCell.lastTextSegId,
      lastItemSegId: prevCell.lastItemSegId,
    };
  } else if (
    prevCell &&
    mergedInto &&
    mergedInto.kind === "thinking" &&
    prevCell.lastItemSegId === mergedInto.id
  ) {
    const items = prevCell.processItems.slice();
    items[items.length - 1] = {
      kind: "thinking",
      text: mergedInto.text,
      ts: mergedInto.ts ?? undefined,
    };
    cell = {
      output: prevCell.output,
      processItems: items,
      lastTextSegId: prevCell.lastTextSegId,
      lastItemSegId: prevCell.lastItemSegId,
    };
  } else if (prevCell && segments === turn.segments) {
    cell = prevCell;
  } else {
    cell = buildLegacyCell(segments);
  }
  const next: AssembledTurn = {
    segments,
    output: cell.output,
    processItems: cell.processItems,
    turnStartedAt: turn.turnStartedAt ?? ts,
    seenLogIds: recordSeenLogId(turn.seenLogIds, input.logId),
  };
  attachInternals(
    next,
    cell,
    idIndex,
    (turn as AssembledTurn & AssemblerInternalsCarrier)[SUPERSEDED_SEG_IDS] ?? null,
  );
  if (input.logId) applyResultMemo.set(turn.seenLogIds, { logId: input.logId, next });
  return next;
}

/**
 * turn 终态辅助（task-02 / design §5 Phase3 / §7.5 turn_completed 行）：清除全部
 * text / thinking 段的 streaming 标记——消费方在收到 turn_completed 事件时调用
 * （completed / failed / killed 均清，流式光标与状态条随之收起）。
 * 纯函数 path-copy：树内无 streaming 段时原引用返回（FR-06 引用稳定）；投影
 * （output / processItems）与 seenLogIds / turnStartedAt 不含 streaming，原样透传。
 */
export function finishTurn(turn: AssembledTurn): AssembledTurn {
  const clear = (list: TurnSegment[]): { list: TurnSegment[]; changed: boolean } => {
    let changed = false;
    const out = list.map((s) => {
      if ((s.kind === "text" || s.kind === "thinking") && s.streaming) {
        changed = true;
        return { ...s, streaming: false };
      }
      if (s.kind === "tool" || s.kind === "subagent_stub") {
        const inner = clear(s.children);
        if (inner.changed) {
          changed = true;
          return { ...s, children: inner.list };
        }
      }
      return s;
    });
    return { list: changed ? out : list, changed };
  };
  const cleared = clear(turn.segments);
  // 用户反馈⑥续（会话 e3b86010：直播重复、刷新正常）：终态收敛去重——同桶内
  // 两条 text 段互为前缀（流式残段与完整行任意到达顺序，含乱序 full→partial）
  // 时丢弃较短者，保证「直播结束态 == 刷新（attach）视图」；相等文本（对账
  // 重放同内容异 id 的极端情形）同样收敛。非前缀（真实多段回复）不动。
  const dedup = (list: TurnSegment[]): { list: TurnSegment[]; changed: boolean } => {
    const texts = list.filter(
      (s): s is Extract<TurnSegment, { kind: "text" }> => s.kind === "text" && s.text !== "",
    );
    const drop = new Set<TurnSegment>();
    for (const a of texts) {
      for (const b of texts) {
        if (a === b || drop.has(a)) continue;
        if (a.text.startsWith(b.text)) drop.add(b);
      }
    }
    if (drop.size === 0) return { list, changed: false };
    return {
      list: list.filter((s) => !drop.has(s)),
      changed: true,
    };
  };
  const dd = dedup(cleared.list);
  const changed = cleared.changed || dd.changed;
  if (!changed) return turn;
  // 去重改变了段序列 → 重算兼容投影（output/processItems），否则页面胶水读到
  // 去重前的旧投影（含已丢弃段的内容）。
  const legacy = segmentsToLegacy(dd.list);
  return { ...turn, segments: dd.list, output: legacy.output, processItems: legacy.processItems };
}

/**
 * ql-20260824-017：技能装载注入行装配——把 SKILL.md 全文挂到归属桶内**最近的**
 * Skill 工具段 result（追加在「Launching skill: X」之后，进度视图 Skill 工具卡
 * 展开可见全文），并把该段 endedAt 更新为注入时刻；状态不重判（保持配对 result
 * 时的 ok/deny）。从桶尾向前找（同轮多次技能装载各自挂最近的，不串段）。
 *
 * 桶内无 Skill 工具段（tool_call JSON 丢失 / 注入先到的旧数据）→ 退化为普通
 * 文本段追加（与修复前 reply 行为一致：宁进对话不丢内容）。
 */
function attachSkillInjection(
  segments: TurnSegment[],
  bucketId: string | null,
  subagentType: string | null,
  text: string,
  ts: number | null,
  input: AssemblerLogInput,
  ids: () => Set<string>,
): { segments: TurnSegment[]; mergedInto: StreamMergeReport | null } {
  let attached = false;
  const next = applyToBucket(segments, bucketId, subagentType, (children) => {
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const t = children[i];
      if (t && t.kind === "tool" && t.toolName === "Skill") {
        attached = true;
        return [
          ...children.slice(0, i),
          { ...t, result: t.result ? `${t.result}\n\n${text}` : text, endedAt: ts },
          ...children.slice(i + 1),
        ];
      }
    }
    return children;
  });
  if (attached) return { segments: next, mergedInto: null };
  return appendStreamText(segments, bucketId, subagentType, "text", text, ts, input, ids);
}

/**
 * 文本 / 思考段追加：桶内末尾是同类段则续接，否则开新段（§5 Phase1.4）。
 * - text 续接直接 concat（不加 \n，保留 markdown 连续结构——同 legacy output 语义）；
 *   被非文本段（tool/stderr/stub…）打断则开新段（多段文本投影时按序拼接，结果等价）。
 * - thinking 连续合并用 \n（同 TurnDetailsList 连续思考合并格式）；被打断则新段。
 * - 续接纯度（task-02 / R-06 撤回精度）：带 segmentId 的 partial 只与「同 segmentId
 *   派生」的同类段续接——partial 与异源段（整段消息 / 另一 segmentId）交错时开新段
 *   （id 经 makeUniqueSegmentId 追加 -2/-3 后缀，均属该 segmentId 的派生链），保证
 *   override 按 id 前缀撤回时恰好覆盖该 segmentId 的全部贡献。无 segmentId（整段
 *   消息 / 历史行）维持无条件续接——同现有 output concat / 连续思考合并语义。
 * - streaming（task-02 / §5 Phase3）：带 segmentId 的 partial 追加（新建或续接）置
 *   true；无 segmentId 追加不改变原值（续接保留 / 新建为 false）；清除走 override
 *   （派生段移除）或 finishTurn（turn 终态）。
 */
/**
 * 用户反馈⑥防御（2026-08-25）：完整回复行（无 segmentId）到达时，直播 partial
 * 派生段仍在（override 撤回丢失/未发）且其文本是全文前缀 → 先移除该 partial
 * 段再落全文，避免「partial（可能截断）+ 全文」双气泡重复显示。partial 非前缀
 * （内容已分叉）时保守保留双方。仅处理同桶尾部单个 text partial——partial 链
 * 按源合并恒为一段（appendStreamText 语义）。
 * quick-9f86d2c3：吸收成功时经 onSeal 回调封存该 segmentId——同 segmentId 的
 * 后续重放窗口（轮后对账 / 断线 resync 增量）不再以 streaming 新段复活。
 */
function dropPrefixPartialReply(
  segments: TurnSegment[],
  bucketId: string | null,
  subagentType: string | null,
  fullText: string,
  onSeal?: (segId: string) => void,
): TurnSegment[] {
  return applyToBucket(segments, bucketId, subagentType, (children) => {
    const last = children[children.length - 1];
    if (
      last != null &&
      last.kind === "text" &&
      last.segId != null &&
      fullText.startsWith(last.text)
    ) {
      if (onSeal && last.segId) onSeal(last.segId);
      return children.slice(0, -1);
    }
    return children;
  });
}

/**
 * quick-9f86d2c3（会话 e87622aa）：反向前缀覆盖判定——归属桶内是否存在完整行
 * （segId 空的 text 段）的文本以 partialText 为前缀（partial 内容 ⊆ 完整行）。
 * 覆盖只看完整行段（segId 空）：partial 与 partial 之间的前缀关系不构成覆盖
 * （同源流式窗口本就增量递进）。桶定位对齐 applyToBucket 的容器路由（DFS 嵌套）。
 */
function bucketCoveredByFullText(
  segments: TurnSegment[],
  bucketId: string | null,
  partialText: string,
): boolean {
  let list: readonly TurnSegment[] | null = segments;
  if (bucketId !== null) {
    const container = findToolById(segments, bucketId) ?? findStubById(segments, bucketId);
    list = container ? container.children : null;
  }
  if (!list) return false;
  return list.some(
    (s) => s.kind === "text" && s.segId == null && s.text.startsWith(partialText),
  );
}

function appendStreamText(
  segments: TurnSegment[],
  bucketId: string | null,
  subagentType: string | null,
  kind: "text" | "thinking",
  text: string,
  ts: number | null,
  input: AssemblerLogInput,
  ids: () => Set<string>,
): { segments: TurnSegment[]; mergedInto: StreamMergeReport | null } {
  const segId = nonEmptyString(input.segmentId);
  let mergedInto: StreamMergeReport | null = null;
  const next = applyToBucket(segments, bucketId, subagentType, (children) => {
    const last = children[children.length - 1];
    // ql-20260820-011：merge 按派生源对齐——partial（segId 非空）只续接同源派生段；
    // 完整行（segId 空）只 merge 进普通段（segId 空）。完整行若 merge 进 partial
    // 派生段，daemon 在完整行**之后** emit 的 override 撤回（session-manager
    // fire-and-forget）会按 segmentId 把派生段连同 merge 进去的全文一并移除——
    // 长文本直播消失、重进（历史无 partial）正常的根因。
    // 用户反馈⑥续：partial（segId 非空）只并入携带**相同 segId** 的派生段——
    // 原 derivesFromSegmentId 前缀判定会把 logId 派生的全文段 id（text:<logId>）
    // 误判为同源（-<数字> 后缀歧义），乱序到达的残段被拼进全文段内造成段内
    // 文本翻倍（会话 e3b86010 直播重复根因）。同源分裂续段均携带原 segId
    // （appendStreamText 建段规则），严格相等不破坏 R-06 续接。
    const canMerge =
      last != null &&
      last.kind === kind &&
      (segId ? (last.segId ?? null) === segId : (last.segId ?? null) === null);
    if (last && canMerge) {
      const merged = kind === "text" ? last.text + text : `${last.text}\n${text}`;
      // F7：上报续接目标（增量投影判定；ts 取 merge 保留的段 ts——thinking 项用）
      mergedInto = {
        id: last.id,
        kind,
        text: merged,
        ts: last.kind === "thinking" ? last.ts : null,
      };
      return [
        ...children.slice(0, -1),
        { ...last, text: merged, streaming: segId ? true : last.streaming },
      ];
    }
    const seg: TurnSegment =
      kind === "text"
        ? {
            kind: "text",
            id: makeUniqueSegmentId(ids(), segmentIdBase(input, "text", ts)),
            text,
            // 带 segmentId 的 partial 追加 → streaming（§5 Phase3 置位规则）。
            streaming: !!segId,
            startedAt: ts,
            // ql-20260820-011：仅 partial 携带派生源键（普通段不带，段对象形状
            // 与既有消费方/测试期望保持兼容）。
            ...(segId ? { segId } : {}),
          }
        : {
            kind: "thinking",
            id: makeUniqueSegmentId(ids(), segmentIdBase(input, "thinking", ts)),
            text,
            streaming: !!segId,
            ts,
            ...(segId ? { segId } : {}),
          };
    return [...children, seg];
  });
  return { segments: next, mergedInto };
}

/**
 * 历史批量：logs → 段序列（design §7 / Grill X-05 形状澄清：单序列 TurnSegment[]，
 * run 分组 / prompt / realRunId 等 turn 级胶水归调用方 logsToTurns）。逐条复用
 * applyLogToSegments，保证历史与实时同一装配语义。
 *
 * task-02 内容级去重（seenTextDedup，默认开启）：kind+文本为键过滤重复行——语义平移
 * 自 logsToTurns 的 seenText（runtime-session-helpers.tsx：分类丢弃行不记键；键含
 * kind，异 kind 同文本不去重；user_input 行也占键——其分类键与 reply 同池，防 user /
 * agent 同文重复显示）。与 SSE 实时路径 applyLogToSegments 内的 log_id 去重是两路
 * 独立语义，不合并（Grill X-08）；需要保留逐条原文（如调试）时传
 * `{ seenTextDedup: false }` 关闭。
 */
export function logsToSegments(
  logs: AssemblerLogInput[],
  options?: { seenTextDedup?: boolean },
): TurnSegment[] {
  const dedup = options?.seenTextDedup !== false;
  const seenText = new Set<string>();
  let turn = createEmptyAssembledTurn();
  for (const log of logs) {
    if (dedup) {
      const seg = classifySessionLog(log.content ?? "", log.channel, log.toolKind);
      // 分类丢弃行（协议卡 / SYSTEM 等）不记键（对齐 logsToTurns 的 continue 位置）。
      if (!seg) continue;
      // task-08：file 段 text 恒空——键改用 fileId，两份不同文件不得误去重；
      // 同 file_id 重复行为内容级去重兜底（后端另有 (run_id, dedup_key) 唯一索引）。
      // task-11：task 段 text 为剥前缀的 JSON 原文——不同行/不同阶段天然异键，
      // 重复行（重放）内容级去重且元数据写入幂等，无双丢风险。
      // quick-0e56260f：override 令箭 text 也恒空——键含 segmentId，同轮多条令箭
      // （backend 每条完整行合成一枚，quick-0e56260f）各自生效；否则第二条起被
      // 同键跳过，刷新路径 raced partial 撤不干净。
      const key =
        seg.kind === "file"
          ? `file:${seg.fileId ?? ""}`
          : seg.kind === "override"
            ? `override:${seg.segmentId ?? ""}`
            : `${seg.kind}:${seg.text}`;
      if (seenText.has(key)) continue;
      seenText.add(key);
    }
    turn = applyLogToSegments(turn, log);
  }
  return turn.segments;
}

/**
 * 兼容投影（§9.4）：segments → { output, processItems }。
 * - output：全部 text 段文本按 DFS 序直接拼接（无分隔符，同 legacy concat 语义；
 *   含子代理文本段——与现状把子代理 reply 一并 concat 的行为等价）。
 * - processItems：DFS 平铺——tool 段先出自身项再出 children 项（tool.startedAt →
 *   ts）；thinking/stderr 段出各自项（.ts → ts）；stub 不出项只展开 children
 *   （legacy 无 stub 概念，子代理项平铺在其位置）。无归属数据下与现有产出逐项等价。
 */
export function segmentsToLegacy(segments: TurnSegment[]): {
  output: string;
  processItems: SessionProcessItem[];
} {
  let output = "";
  const processItems: SessionProcessItem[] = [];
  const walk = (list: TurnSegment[]) => {
    for (const s of list) {
      switch (s.kind) {
        case "text":
          output += s.text;
          break;
        case "thinking":
          processItems.push({ kind: "thinking", text: s.text, ts: s.ts ?? undefined });
          break;
        case "tool":
          processItems.push({
            kind: "tool",
            raw: s.raw,
            result: s.result,
            status: s.status,
            ts: s.startedAt ?? undefined,
          });
          walk(s.children);
          break;
        case "subagent_stub":
          walk(s.children);
          break;
        case "stderr":
          processItems.push({ kind: "stderr", text: s.text, ts: s.ts ?? undefined });
          break;
        case "file":
          // ql 修复（agent-file-upload-mcp 部署验证发现）：原实现跳过 file 段，
          // 但会话面板历史回放（runtime-session-helpers attach 路径）正是经
          // segmentsToLegacy 投影渲染的「旧消费方」——跳过导致文件卡片只在实时
          // SSE 可见、刷新后消失（违反 FR-01「刷新后仍在原位」）。改为投影
          // kind:"file" 过程项，由 TurnDetailsList 渲染 FileMessageCard。
          processItems.push({
            kind: "file",
            fileId: s.fileId,
            name: s.name,
            size: s.size,
            mime: s.mime,
            description: s.description,
            ts: s.ts ?? undefined,
          });
          break;
      }
    }
  };
  walk(segments);
  return { output, processItems };
}

/**
 * 上下文前导检测（2026-08-25-unified-floating-session task-11 / FR-7）：
 * daemon transcript 会把完整 dispatch_prompt（含服务端注入的前导）同步为
 * 首条 user_input 日志。识别其前导块（"---" 之前部分）供「全部（进度）」
 * 视图显示注入来源；对话视图保持干净（prompt 气泡用原文，本工具不消费）。
 *
 * 判定：内容以已知前导标题开头且含 "\n\n---\n\n" 分隔 → 返回分隔前文本；
 * 否则 null（普通用户消息不误伤；仅同标题开头但无分隔的消息是用户自己
 * 输入的原文，不算前导）。
 */
const PREAMBLE_HEADS = ["【变更上下文】", "【页面上下文】", "【团队任务简报", "【群聊上下文】", "【影子直聊】"];
export function extractPreambleText(content: string): string | null {
  const trimmed = content.trim();
  // quick（2026-09-03 系统注入刷屏修复）：[GROUP_CHAIN ...] 首行标记是排队
  // 透传的内部标记（派发侧剥离，直入/历史路径可能残留）——展示层兜底剥掉。
  // 多行时只剥首行、其余按正常逻辑递归判定。
  if (trimmed.startsWith("[GROUP_CHAIN ")) {
    const nl = trimmed.indexOf("\n");
    const rest = nl < 0 ? "" : trimmed.slice(nl + 1).trim();
    return rest ? extractPreambleText(rest) : null;
  }
  // [后台任务通知] 类注入：整条都是系统通知（无用户正文），整体进 preamble
  // 折叠——对话视图不再被任务唤醒通知刷屏（无分隔符，特判整条）。
  if (trimmed.startsWith("[后台任务通知]")) return trimmed;
  if (!PREAMBLE_HEADS.some((h) => trimmed.startsWith(h))) return null;
  const sep = trimmed.indexOf("\n\n---\n\n");
  if (sep <= 0) return null;
  return trimmed.slice(0, sep);
}

/**
 * ql-20260825-011：剥掉前导块，返回纯用户消息部分（与 extractPreambleText 同
 * 判定）。历史回灌路径的 prompt 气泡用本函数——上下文注入信息只在「进度」
 * 视图的 preamble 段展示（默认收起），对话视图不再重复显示前导全文。非前导
 * 内容原样返回。
 */
export function stripPreambleText(content: string): string {
  const trimmed = content.trim();
  // quick（2026-09-03 系统注入刷屏修复）：与 extractPreambleText 同款特判——
  // [GROUP_CHAIN] 标记行剥首行后递归；[后台任务通知] 整条是系统通知，strip
  // 后为空（无用户正文可显示，对话视图不渲染该轮 prompt 气泡）。
  if (trimmed.startsWith("[GROUP_CHAIN ")) {
    const nl = trimmed.indexOf("\n");
    if (nl < 0) return "";
    return stripPreambleText(trimmed.slice(nl + 1));
  }
  if (trimmed.startsWith("[后台任务通知]")) return "";
  if (!PREAMBLE_HEADS.some((h) => trimmed.startsWith(h))) return content;
  const sep = trimmed.indexOf("\n\n---\n\n");
  if (sep <= 0) return content;
  return trimmed.slice(sep + "\n\n---\n\n".length);
}
