/**
 * `agent-log/read-zcode-sqlite.ts` —— zcode 本地 SQLite 会话库读取（task-01 落
 * sess id 提取纯函数 + fixture 造库构造器两块地基）。
 *
 * task-01（2026-09-10-zcode-session-sqlite-read / FR-01，依据模块文档 daemon.md
 * 「契约摘要（sillyhub-daemon Node 侧）」agent-log/ 节）：「本地活动」zcode 会话
 * 读取恒走 `~/.zcode/cli/db/db.sqlite`（design Phase 1，D-001@v1），rollout 短命
 * 文件仅作扫描上报发现。本文件现阶段只含：
 *   - extractZcodeSessId(path)：纯函数，上报 log_path 文件名 → session.id；
 *   - createZcodeFixtureDb(options)：测试 helper，node:sqlite DatabaseSync 按
 *     真实 schema 建三表造场景全集（供 task-02 归一化读取器注入式测试复用）。
 * 开库（惰性只读 DatabaseSync + URI mode=ro）与 message×part 归一化由 task-02
 * 在本文件续写，本 task 不实现。
 *
 * session id 形态实证（2026-09-10 对本机真实库 `file:...?mode=ro` 只读核对 +
 * rollout 目录文件名交叉比对）：
 *   - session.id：主会话 `sess_<uuid>`，子代理 `sess_subagent_agent_<uuid>`
 *     （parent_id 指向所属主会话）；
 *   - rollout 上报文件名：`model-io-sess_<uuid>.jsonl` /
 *     `model-io-sess_subagent_agent_<uuid>.jsonl`；
 *   - ⇒ 提取规则统一为 `model-io-sess_<rest>.jsonl` → `sess_<rest>`（磁盘文件
 *     `model-io-sess_20a74368-….jsonl` 与库行 `sess_20a74368-…` 已核对存在，
 *     subagent_agent 前缀完整保留进 session id，不剥）。
 * 三表列名按 PRAGMA table_info 核对（fixture 取必要列，类型/可空性镜像真实库）：
 *   session(id TEXT PK, title TEXT NOT NULL, directory TEXT NOT NULL, parent_id
 *   TEXT NULL) / message(id TEXT PK, session_id TEXT NOT NULL, sequence INTEGER,
 *   data TEXT NOT NULL——JSON 含 role / time{created[,completed]} / semantics
 *   {uiVisibility, transcriptVisibility,…} / 顶层 visibility) / part(id TEXT PK,
 *   message_id TEXT NOT NULL, session_id TEXT NOT NULL, sequence INTEGER,
 *   data TEXT NOT NULL——JSON 含 type: text|tool{tool, callID, state{status,
 *   input, output|error}}|reasoning|step-start|step-finish|timeline|file|
 *   compaction；真实库 type 分布实测八类 + 未知类型防御式忽略）。
 *
 * @module agent-log/read-zcode-sqlite
 */

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── sess id 提取（纯函数）─────────────────────────────────────────────────────

/** rollout 上报文件名形态：`model-io-sess_<rest>.jsonl` → session.id `sess_<rest>`。 */
const ZCODE_MODEL_IO_FILENAME_RE = /^model-io-sess_(.+)\.jsonl$/;

/**
 * 从上报 log_path 提取 zcode 本地库 session.id（纯函数）。
 *
 * 取 basename（兼容 Windows `\` 与 POSIX `/` 两种分隔符）后匹配
 * `model-io-sess_<rest>.jsonl`，返回 `sess_<rest>`——主会话得 `sess_<uuid>`、
 * 子代理得 `sess_subagent_agent_<uuid>`（形态实证见模块头）。不匹配（非 zcode
 * 命名 / 无 .jsonl 后缀 / 空 id）一律返回 null。
 *
 * 纯函数约束（task-01 constraints）：不读 fs / env / 时钟，不抛异常（仅字符串
 * 与正则操作，结构上不可抛）。
 */
export function extractZcodeSessId(path: string): string | null {
  const lastSeparator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const basename = lastSeparator === -1 ? path : path.slice(lastSeparator + 1);
  const matched = ZCODE_MODEL_IO_FILENAME_RE.exec(basename);
  const rest = matched?.[1];
  return rest === undefined ? null : `sess_${rest}`;
}

// ── node:sqlite 接入（类型层 + 加载层）────────────────────────────────────────
// 两层绕行（task-01 执行期实证，均因 node:sqlite 是 Node 22.5+ 新内建）：
//   类型层：当前 devDep @types/node 20.14 无 node:sqlite 模块声明（design Phase 1
//   已列 bump 至 22.13+ 的 devDep 变更，不在本 task 文件清单内）——静态 import 与
//   字面量 import() 在 NodeNext 下报 TS2307，改经下方最小结构类型收窄；
//   加载层：vite 5（vitest 底座）内建外部化清单不含 node:sqlite，静态 import 与
//   动态 import()（含非字面量 specifier，SSR 包装后同样重写）均解析失败——改经
//   createRequire 走 Node CJS 加载器直取内建，vite 不改写普通函数调用。
// 两个绕行对 @types/node bump 后与真实 API 形状一致，无需回改（Node ≥22.13 去
// 实验 flag 的稳定内建；旧 Node 上 require 抛 ERR_MODULE_NOT_FOUND 即调用方降级）。

/** node:sqlite StatementSync 最小结构（fixture 用到的成员）。 */
interface SqliteStatementLike {
  run(...anonymousParameters: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...anonymousParameters: unknown[]): unknown;
  all(...anonymousParameters: unknown[]): unknown[];
}

/** node:sqlite DatabaseSync 最小结构（fixture 用到的成员）。 */
interface SqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
}

/** node:sqlite 模块最小结构（仅 DatabaseSync 构造器）。 */
interface NodeSqliteModuleLike {
  DatabaseSync: new (location: string, options?: { readOnly?: boolean }) => SqliteDatabaseLike;
}

/** node:sqlite 模块名（存入变量，require 调用侧统一引用）。 */
const NODE_SQLITE_MODULE_SPECIFIER = 'node:sqlite';

/** ESM 上下文的 require（经 Node CJS 加载器直取内建模块，绕开 vite import 分析）。 */
const requireFromHere = createRequire(import.meta.url);

/** 加载 node:sqlite 的 DatabaseSync 构造器（不可用则此处抛错，由调用方暴露）。 */
function loadNodeSqliteDatabaseSync(): NodeSqliteModuleLike['DatabaseSync'] {
  const mod = requireFromHere(NODE_SQLITE_MODULE_SPECIFIER) as NodeSqliteModuleLike;
  return mod.DatabaseSync;
}

// ── fixture 造库构造器（测试 helper，供 task-02 复用）──────────────────────────

/** fixture 造数时间基准（毫秒，取自真实库抽样 message.data.time.created）。 */
const FIXTURE_TIME_BASE = 1787149622901;

/** 坏 JSON 行：截断的 JSON 文本（供 task-02 归一化 skippedLines 容错计数）。 */
const BAD_PART_DATA = '{"type":"text","text":"这条 part.data 是非法 JSON';

/** fixture 场景全集的确定性 id（测试按 session_id / 具体行断言用）。 */
export const ZCODE_FIXTURE_IDS = {
  /** 主会话（承载 hidden 三判据 / 忽略类型 / tool 四态 / 未知类型 / 坏 JSON 行）。 */
  mainSession: 'sess_a1b2c3d4-0001-4000-8000-000000000001',
  /** 子代理会话（parent_id → mainSession）。 */
  subagentSession: 'sess_subagent_agent_b2c3d4e5-0002-4000-8000-000000000002',
  /** 空会话（仅 session 行，零 message / 零 part）。 */
  emptySession: 'sess_c3d4e5f6-0003-4000-8000-000000000003',
  messages: {
    /** 可见 user 消息（task-02 应产出 user_input 段）。 */
    visibleUser: 'msg_main_1',
    /** 隐藏判据一：semantics.uiVisibility == 'hidden'。 */
    hiddenUiVisibility: 'msg_main_2',
    /** 隐藏判据二：semantics.transcriptVisibility == 'hidden'。 */
    hiddenTranscriptVisibility: 'msg_main_3',
    /** 隐藏判据三：顶层 visibility == 'model-only'。 */
    hiddenModelOnly: 'msg_main_4',
    /** assistant 消息（reasoning + text + 五种忽略类型 part）。 */
    assistantText: 'msg_main_5',
    /** assistant 消息（tool 四态 + 未知类型 + 坏 JSON 行 part）。 */
    assistantTools: 'msg_main_6',
    /** 子代理 user 消息。 */
    subagentUser: 'msg_sub_1',
    /** 子代理 assistant 消息。 */
    subagentAssistant: 'msg_sub_2',
  },
  parts: {
    /** data 为非法 JSON 的 part 行（全库唯一坏行）。 */
    badJson: 'part_main_6_badjson',
  },
} as const;

/** 三表 DDL：列名 / 类型 / 可空性按真实库 PRAGMA table_info 镜像（必要列）；索引按真实库 index_list 镜像。 */
const ZCODE_FIXTURE_DDL = `
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  directory TEXT NOT NULL,
  parent_id TEXT
);
CREATE INDEX session_parent_idx ON session (parent_id);
CREATE TABLE message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  sequence INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX message_session_sequence_idx ON message (session_id, sequence);
CREATE TABLE part (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX part_session_message_sequence_idx ON part (session_id, message_id, sequence);
CREATE INDEX part_message_sequence_idx ON part (message_id, sequence);
CREATE INDEX part_session_idx ON part (session_id);
`;

// ── 造数行（data JSON 形状逐字段对齐真实库抽样）───────────────────────────────

/** session 种子行。 */
interface SeedSession {
  id: string;
  title: string;
  directory: string;
  parentId: string | null;
}

/** message 种子行（data 为序列化前的对象，统一 JSON.stringify 落库）。 */
interface SeedMessage {
  id: string;
  sessionId: string;
  sequence: number;
  data: unknown;
}

/** part 种子行（data 为最终落库字符串——坏 JSON 行需跳过 stringify 直写原文）。 */
interface SeedPart {
  id: string;
  messageId: string;
  sessionId: string;
  sequence: number;
  data: string;
}

const MAIN = ZCODE_FIXTURE_IDS.mainSession;
const SUB = ZCODE_FIXTURE_IDS.subagentSession;
const EMPTY = ZCODE_FIXTURE_IDS.emptySession;
const M = ZCODE_FIXTURE_IDS.messages;

/** 可见消息的 semantics（真实库抽样：uiVisibility/transcriptVisibility 均 'visible'）。 */
const visibleSemantics = { origin: 'user', uiVisibility: 'visible', transcriptVisibility: 'visible' };

/** JSON 序列化落库（种子构造统一出口）。 */
const j = (value: unknown): string => JSON.stringify(value);

const SEED_SESSIONS: SeedSession[] = [
  { id: MAIN, title: '主会话——SQLite fixture', directory: 'C:\\repo\\main', parentId: null },
  { id: SUB, title: '子代理会话——SQLite fixture', directory: 'C:\\repo\\main', parentId: MAIN },
  { id: EMPTY, title: '空会话——SQLite fixture', directory: 'C:\\repo\\empty', parentId: null },
];

const SEED_MESSAGES: SeedMessage[] = [
  // 主会话 seq 1-4：可见 user + 隐藏三判据各一条（互不重叠，供过滤判据单测）。
  {
    id: M.visibleUser,
    sessionId: MAIN,
    sequence: 1,
    data: { role: 'user', time: { created: FIXTURE_TIME_BASE + 1000 }, semantics: visibleSemantics },
  },
  {
    id: M.hiddenUiVisibility,
    sessionId: MAIN,
    sequence: 2,
    data: {
      role: 'user',
      time: { created: FIXTURE_TIME_BASE + 2000 },
      semantics: { origin: 'system', uiVisibility: 'hidden', transcriptVisibility: 'visible' },
    },
  },
  {
    id: M.hiddenTranscriptVisibility,
    sessionId: MAIN,
    sequence: 3,
    data: {
      role: 'user',
      time: { created: FIXTURE_TIME_BASE + 3000 },
      semantics: { origin: 'system', uiVisibility: 'visible', transcriptVisibility: 'hidden' },
    },
  },
  {
    id: M.hiddenModelOnly,
    sessionId: MAIN,
    sequence: 4,
    data: {
      role: 'user',
      time: { created: FIXTURE_TIME_BASE + 4000 },
      semantics: visibleSemantics,
      visibility: 'model-only', // 判据三在 message.data 顶层（真实库实测字段位）
    },
  },
  // 主会话 seq 5-6：assistant（user 无 completed、assistant 的 time 双键——真实库实证）。
  {
    id: M.assistantText,
    sessionId: MAIN,
    sequence: 5,
    data: {
      role: 'assistant',
      time: { created: FIXTURE_TIME_BASE + 5000, completed: FIXTURE_TIME_BASE + 9000 },
      semantics: { origin: 'agent_runtime', kind: 'assistant_response', uiVisibility: 'visible', transcriptVisibility: 'visible' },
    },
  },
  {
    id: M.assistantTools,
    sessionId: MAIN,
    sequence: 6,
    data: {
      role: 'assistant',
      time: { created: FIXTURE_TIME_BASE + 10000, completed: FIXTURE_TIME_BASE + 15000 },
      semantics: { origin: 'agent_runtime', kind: 'assistant_response', uiVisibility: 'visible', transcriptVisibility: 'visible' },
    },
  },
  // 子代理会话 seq 1-2。
  {
    id: M.subagentUser,
    sessionId: SUB,
    sequence: 1,
    data: { role: 'user', time: { created: FIXTURE_TIME_BASE + 20000 }, semantics: visibleSemantics },
  },
  {
    id: M.subagentAssistant,
    sessionId: SUB,
    sequence: 2,
    data: {
      role: 'assistant',
      time: { created: FIXTURE_TIME_BASE + 21000, completed: FIXTURE_TIME_BASE + 25000 },
      semantics: { origin: 'agent_runtime', kind: 'assistant_response', uiVisibility: 'visible', transcriptVisibility: 'visible' },
    },
  },
];

const SEED_PARTS: SeedPart[] = [
  // msg_main_1 可见 user：text part。
  { id: 'part_main_1_text', messageId: M.visibleUser, sessionId: MAIN, sequence: 1, data: j({ type: 'text', text: '帮我排查这个构建失败' }) },
  // msg_main_2/3/4：隐藏判据消息各一条 text part（正文即判据注记）。
  { id: 'part_main_2_text', messageId: M.hiddenUiVisibility, sessionId: MAIN, sequence: 1, data: j({ type: 'text', text: '系统注入——uiVisibility 隐藏' }) },
  { id: 'part_main_3_text', messageId: M.hiddenTranscriptVisibility, sessionId: MAIN, sequence: 1, data: j({ type: 'text', text: '系统注入——transcriptVisibility 隐藏' }) },
  { id: 'part_main_4_text', messageId: M.hiddenModelOnly, sessionId: MAIN, sequence: 1, data: j({ type: 'text', text: '系统注入——顶层 visibility=model-only' }) },
  // msg_main_5 assistant：reasoning + text + 五种应忽略类型（task-02 映射表边界段）。
  { id: 'part_main_5_step_start', messageId: M.assistantText, sessionId: MAIN, sequence: 1, data: j({ type: 'step-start' }) },
  { id: 'part_main_5_reasoning', messageId: M.assistantText, sessionId: MAIN, sequence: 2, data: j({ type: 'reasoning', text: '先看构建日志定位报错行…' }) },
  { id: 'part_main_5_text', messageId: M.assistantText, sessionId: MAIN, sequence: 3, data: j({ type: 'text', text: '构建失败原因是依赖版本冲突。' }) },
  { id: 'part_main_5_step_finish', messageId: M.assistantText, sessionId: MAIN, sequence: 4, data: j({ type: 'step-finish' }) },
  { id: 'part_main_5_timeline', messageId: M.assistantText, sessionId: MAIN, sequence: 5, data: j({ type: 'timeline', title: '构建排查' }) },
  { id: 'part_main_5_file', messageId: M.assistantText, sessionId: MAIN, sequence: 6, data: j({ type: 'file', path: 'src/index.ts' }) },
  { id: 'part_main_5_compaction', messageId: M.assistantText, sessionId: MAIN, sequence: 7, data: j({ type: 'compaction' }) },
  // msg_main_6 assistant：tool 四态（completed 带 output / error 带 error 无 output /
  // running、pending 无 output）+ 未知类型 + 坏 JSON 行。
  {
    id: 'part_main_6_tool_completed',
    messageId: M.assistantTools,
    sessionId: MAIN,
    sequence: 1,
    data: j({ type: 'tool', tool: 'Bash', callID: 'call_c1', state: { status: 'completed', input: { command: 'pnpm test' }, output: '3 passed' } }),
  },
  {
    id: 'part_main_6_tool_error',
    messageId: M.assistantTools,
    sessionId: MAIN,
    sequence: 2,
    data: j({ type: 'tool', tool: 'Bash', callID: 'call_c2', state: { status: 'error', input: { command: 'exit 1' }, error: 'Command failed with exit code 1' } }),
  },
  {
    id: 'part_main_6_tool_running',
    messageId: M.assistantTools,
    sessionId: MAIN,
    sequence: 3,
    data: j({ type: 'tool', tool: 'Grep', callID: 'call_c3', state: { status: 'running', input: { pattern: 'TODO' } } }),
  },
  {
    id: 'part_main_6_tool_pending',
    messageId: M.assistantTools,
    sessionId: MAIN,
    sequence: 4,
    data: j({ type: 'tool', tool: 'WebSearch', callID: 'call_c4', state: { status: 'pending', input: { query: 'node sqlite' } } }),
  },
  { id: 'part_main_6_unknown', messageId: M.assistantTools, sessionId: MAIN, sequence: 5, data: j({ type: 'hologram', text: '未来新增的未知 part 类型' }) },
  // 坏 JSON 行：直写非法 JSON 原文（不经 stringify）。
  { id: ZCODE_FIXTURE_IDS.parts.badJson, messageId: M.assistantTools, sessionId: MAIN, sequence: 6, data: BAD_PART_DATA },
  // 子代理会话两条。
  { id: 'part_sub_1_text', messageId: M.subagentUser, sessionId: SUB, sequence: 1, data: j({ type: 'text', text: '调查这个已知问题的实现现状' }) },
  { id: 'part_sub_2_text', messageId: M.subagentAssistant, sessionId: SUB, sequence: 1, data: j({ type: 'text', text: '调查结论：问题出在读取层。' }) },
];

/** fixture 构造选项。 */
export interface ZcodeFixtureDbOptions {
  /** 库文件绝对路径（注入式测试用，父目录须已存在）；缺省 os.tmpdir() 下唯一临时文件。 */
  dbPath?: string;
}

/** fixture 构造结果。 */
export interface ZcodeFixtureDb {
  /** 库文件绝对路径（造库后开只读连接 / 断言用）。 */
  dbPath: string;
  /**
   * 关闭内部写连接（幂等；DatabaseSync 双 close 会抛 ERR_INVALID_STATE）。
   * 只释放句柄不删库文件——Windows 上句柄未释放时外部 rmSync 会抛 EBUSY/EPERM，
   * 测试可借 rmSync 成功与否断言无句柄泄漏；文件清理由测试侧自理。
   */
  close(): void;
}

/**
 * 造 zcode 本地库 fixture：在注入路径（默认 os.tmpdir() 下唯一临时文件）按真实
 * schema 建三表并落场景全集（主会话 / 子代理 / 空会话 / 隐藏三判据 / tool 四态 /
 * 未知 part 类型 / 坏 JSON 行——行清单见 SEED_* 常量，确定性 id 见
 * ZCODE_FIXTURE_IDS）。每用例独立调用即独立路径，可重复构造。
 */
export async function createZcodeFixtureDb(options: ZcodeFixtureDbOptions = {}): Promise<ZcodeFixtureDb> {
  // 加载失败（Node <22.5 无 node:sqlite）在此抛出——测试环境即失败暴露；task-02
  // 的读取器开库沿用同一加载入口但改为「抛不可用 → 调用方文件回落」语义。
  const DatabaseSync = loadNodeSqliteDatabaseSync();
  const dbPath = options.dbPath ?? join(tmpdir(), `zcode-fixture-${process.pid}-${randomUUID()}.sqlite`);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(ZCODE_FIXTURE_DDL);
    const insertSession = db.prepare('INSERT INTO session (id, title, directory, parent_id) VALUES (?, ?, ?, ?)');
    const insertMessage = db.prepare('INSERT INTO message (id, session_id, sequence, data) VALUES (?, ?, ?, ?)');
    const insertPart = db.prepare('INSERT INTO part (id, message_id, session_id, sequence, data) VALUES (?, ?, ?, ?, ?)');
    for (const row of SEED_SESSIONS) insertSession.run(row.id, row.title, row.directory, row.parentId);
    for (const row of SEED_MESSAGES) insertMessage.run(row.id, row.sessionId, row.sequence, j(row.data));
    for (const row of SEED_PARTS) insertPart.run(row.id, row.messageId, row.sessionId, row.sequence, row.data);
  } catch (error) {
    db.close();
    throw error;
  }
  let closed = false;
  return {
    dbPath,
    close: () => {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
}
