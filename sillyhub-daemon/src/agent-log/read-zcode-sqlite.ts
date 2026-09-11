/**
 * `agent-log/read-zcode-sqlite.ts` —— zcode 本地 SQLite 会话库读取（task-01 落
 * sess id 提取纯函数 + fixture 造库构造器两块地基）。
 *
 * task-01（2026-09-10-zcode-session-sqlite-read / FR-01，依据模块文档 daemon.md
 * 「契约摘要（sillyhub-daemon Node 侧）」agent-log/ 节）：「本地活动」zcode 会话
 * 读取恒走 `~/.zcode/cli/db/db.sqlite`（design Phase 1，D-001@v1），rollout 短命
 * 文件仅作扫描上报发现。本文件含：
 *   - extractZcodeSessId(path)：纯函数，上报 log_path 文件名 → session.id；
 *   - createZcodeFixtureDb(options)：测试 helper，node:sqlite DatabaseSync 按
 *     真实 schema 建三表造场景全集（读取器注入式测试复用）。
 *
 * task-02（同变更 / FR-01 + D-003@v1 + D-004@v1 + D-006@v1）：readZcodeSqliteMessages
 * 读取器主体——惰性 node:sqlite 只读开库（默认库路径 `~/.zcode/cli/db/db.sqlite`，
 * opts.dbPath / 模块级工厂可覆写）、message（按 sequence）×part（按
 * message_id+sequence）双层遍历归一化为 NormalizedLogMessage[]（映射表见
 * design Phase 1 实证表）、beforeSeq 切片 + 200 段窗口与 truncated/totalSegments
 * 语义逐字对齐 parse-zcode-model-io。错误不吞：node:sqlite 不可导入 / 库文件
 * 缺失 → 抛「读取器不可用」；会话不在库 / 查询异常 → 原样抛出（调用方回落，
 * 不伪造空结果）。
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
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_MAX_CONTENT_BYTES,
  DEFAULT_MAX_SEGMENTS,
  type NormalizedLogMessage,
} from './parse-zcode-model-io.js';
import type { AgentLogMessagesResult } from './registry.js';

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

/**
 * fixture 造数时间基准（毫秒，取自真实库抽样 message.data.time.created）。
 * task-02 起导出：读取器测试断言 ts（毫秒 → ISO）与期望值同源，免测试侧硬编码。
 */
export const FIXTURE_TIME_BASE = 1787149622901;

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

// ── 读取器主体（task-02）──────────────────────────────────────────────────────

/** tool_input 摘要截断：JSON.stringify 后首 2KB（与 parse-zcode-model-io 同口径）。 */
const ZCODE_TOOL_INPUT_MAX_CHARS = 2048;

/** tool_result 摘要截断：首 4KB（与 parse-zcode-model-io 同口径）。 */
const ZCODE_TOOL_RESULT_MAX_CHARS = 4096;

/** 「读取器不可用」错误文案（含此前缀的错误 = 开库层失败，调用方回落文件路径）。 */
const ZCODE_READER_UNAVAILABLE_PREFIX = 'zcode SQLite 读取器不可用';

/** 默认库路径：~/.zcode/cli/db/db.sqlite（design Phase 1 实证位置，join 免 URI 转义）。 */
function defaultZcodeDbPath(): string {
  return join(homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
}

/** 模块级库路径工厂（测试覆写注入 fixture 路径；还原传 null）。 */
let zcodeDbPathFactory: () => string = defaultZcodeDbPath;

/**
 * 覆写读取器默认库路径工厂（模块级）；传 null 还原默认 ~/.zcode/cli/db/db.sqlite。
 * 测试注入 fixture 路径用，生产不触碰。
 */
export function setZcodeSqliteDbPathFactory(factory: (() => string) | null): void {
  zcodeDbPathFactory = factory ?? defaultZcodeDbPath;
}

/** 读取选项。 */
export interface ZcodeSqliteReadOptions {
  /** 库文件绝对路径（本次调用覆写默认工厂；测试注入 fixture 路径用）。 */
  dbPath?: string;
  /** 内存预算上限（UTF-16 code unit 口径；测试注入小值，生产默认 20MB）。 */
  maxContentUnits?: number;
}

/** message×part LEFT JOIN 遍历的行形状（列名即 SELECT 别名）。 */
interface ZcodeJoinedRow {
  message_id: string;
  message_data: string | null;
  part_data: string | null;
}

/** 未编号段（seq 在全量产段完成后统一重编号）。 */
type UnnumberedSegment = Omit<NormalizedLogMessage, 'seq'>;

/** 「读取器不可用」错误（node:sqlite 不可导入 / 库文件缺失或打不开）。 */
function zcodeReaderUnavailableError(detail: string): Error {
  return new Error(`${ZCODE_READER_UNAVAILABLE_PREFIX}：${detail}`);
}

/** 未知错误对象转消息文本（抛错兜底拼接用）。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 读取 zcode 本地 SQLite 库中的会话对话（read_agent_log_messages 的 zcode 数据源，
 * design Phase 1）。
 *
 * 开库只读（DatabaseSync `{ readOnly: true }`——task-01 fixture 用例验证过的形态，
 * 等价 file URI mode=ro，WAL 并发读安全），message（按 sequence）×part（按
 * message_id+sequence）双层遍历归一化：隐藏消息整条跳过（D-003@v1 三判据）、
 * tool 单 part 产两段（D-004@v1，running/pending 只产 tool_use）、边界/未知
 * part 类型与坏行计数 skippedLines 不中断；seq 全局重编号 1 起，beforeSeq 切片
 * + 200 段窗口（最新在尾、窗口取尾部）与 parse-zcode-model-io 逐字对齐。
 *
 * 错误语义（不伪造空结果，回落归调用方）：
 *   - node:sqlite 不可导入（D-006@v1 生效版本 ≥22.13.0 / ≥23.4.0）/ 库文件缺失
 *     或打不开 → 抛「zcode SQLite 读取器不可用」；
 *   - 会话不在库 / 查询异常（zcode 升级改 schema 等）→ 原样抛出。
 */
export async function readZcodeSqliteMessages(
  sessId: string,
  beforeSeq: number | null,
  opts: ZcodeSqliteReadOptions = {},
): Promise<AgentLogMessagesResult> {
  const dbPath = opts.dbPath ?? zcodeDbPathFactory();

  // 惰性加载 node:sqlite（不可导入 = 读取器不可用，D-006@v1）。
  let DatabaseSync: NodeSqliteModuleLike['DatabaseSync'];
  try {
    DatabaseSync = loadNodeSqliteDatabaseSync();
  } catch (error) {
    throw zcodeReaderUnavailableError(`node:sqlite 模块不可导入（${errorMessage(error)}）`);
  }
  if (!existsSync(dbPath)) {
    throw zcodeReaderUnavailableError(`库文件不存在（${dbPath}）`);
  }
  let db: SqliteDatabaseLike;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    throw zcodeReaderUnavailableError(`库文件打开失败（${dbPath}：${errorMessage(error)}）`);
  }

  try {
    // 会话存在性前置（sessId 参数绑定防注入——来自上报文件名解析）：不在库直接抛。
    const sessionRow = db.prepare('SELECT id FROM session WHERE id = ?').get(sessId);
    if (sessionRow === undefined || sessionRow === null) {
      throw new Error(`zcode 会话不在库中：session.id=${sessId}`);
    }

    // 双层遍历单查询化：message 左连接 part（无 part 的消息补 null 行，不丢消息），
    // ORDER BY m.sequence, p.sequence 即「message 按 sequence × part 按序」。
    const rows = db
      .prepare(
        `SELECT m.id AS message_id, m.data AS message_data, p.data AS part_data
         FROM message AS m LEFT JOIN part AS p ON p.message_id = m.id
         WHERE m.session_id = ?
         ORDER BY m.sequence, p.sequence`,
      )
      .all(sessId) as ZcodeJoinedRow[];

    const segments: UnnumberedSegment[] = [];
    let skippedLines = 0;
    // 内存预算（ql-20260911-003-355a P2）：文件路径有 lstat 20MB 预检（DEFAULT_
    // MAX_CONTENT_BYTES），SQLite 路径无文件大小可查——按行 data 的 code unit 累计
    // 近似计（message_data 在 join 行重复计属保守方向）；超限与文件路径同口径返
    // too_large（不物化全量段、不截半份 diff）。
    let budgetUnits = 0;
    const budgetLimit = opts.maxContentUnits ?? DEFAULT_MAX_CONTENT_BYTES;
    // 当前 message 分组状态（rows 按 message 聚簇，message_id 变更即切组）。
    let currentMessageId: string | null = null;
    let messageSkipParts = false;
    let messageRole: string | null = null;
    let messageTs: string | null = null;

    for (const row of rows) {
      budgetUnits += (row.message_data?.length ?? 0) + (row.part_data?.length ?? 0);
      if (budgetUnits > budgetLimit) {
        return {
          status: 'too_large',
          messages: [],
          truncated: false,
          totalSegments: 0,
          skippedLines: 0,
        };
      }
      if (row.message_id !== currentMessageId) {
        currentMessageId = row.message_id;
        const messageData = parseJsonObject(row.message_data);
        if (messageData === null) {
          // 坏 message 行（data 非法 JSON / 非对象）：计 1，其 part 随消息一并
          // 丢弃不计（part 无 role/ts 不可归一化，坏在 message 不重复记 part）。
          skippedLines++;
          messageSkipParts = true;
          messageRole = null;
          messageTs = null;
        } else if (isHiddenZcodeMessage(messageData)) {
          // 隐藏三判据任一命中（D-003@v1）：整条跳过，不计坏行（对齐文件 parser
          // 剥 <system-reminder> 不计数的同语义）。
          messageSkipParts = true;
        } else {
          messageSkipParts = false;
          messageRole = typeof messageData.role === 'string' ? messageData.role : null;
          messageTs = zcodeMessageTimestamp(messageData);
        }
      }
      if (row.part_data === null || messageSkipParts) continue;
      const part = parseJsonObject(row.part_data);
      if (part === null) {
        skippedLines++;
        continue;
      }
      const produced = normalizeZcodePart(part, messageRole, messageTs);
      skippedLines += produced.skipped;
      segments.push(...produced.segments);
    }

    // seq 重编号（1 起全局序；隐藏/忽略段跳过后连续编号）。
    const numbered: NormalizedLogMessage[] = segments.map((segment, index) => ({ seq: index + 1, ...segment }));

    // beforeSeq 切片（「加载更早」翻页）→ 段窗口（最近 200 段，最新在尾）——与
    // parse-zcode-model-io 主函数收尾逐字对齐：truncated = 切片后段数超窗口，
    // 超窗截尾（保留最新段），totalSegments 恒为窗口前全量总数。
    const sliced = beforeSeq !== null ? numbered.filter((m) => m.seq < beforeSeq) : numbered;
    const truncated = sliced.length > DEFAULT_MAX_SEGMENTS;
    const messages = truncated ? sliced.slice(sliced.length - DEFAULT_MAX_SEGMENTS) : sliced;

    return { status: 'parsed', messages, truncated, totalSegments: numbered.length, skippedLines };
  } finally {
    db.close();
  }
}

// ── 归一化内部（映射表见模块头 + design Phase 1 实证表）───────────────────────

/** JSON 文本 → 对象（非法 JSON / 非对象 → null，调用方计数跳过不中断）。 */
function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 隐藏判据（D-003@v1）：data.semantics.uiVisibility=='hidden' ||
 * semantics.transcriptVisibility=='hidden' || 顶层 visibility=='model-only'
 * 任一命中即整条 message 隐藏（实测 user 侧大量系统注入，不过滤会产生假用户气泡）。
 */
function isHiddenZcodeMessage(data: Record<string, unknown>): boolean {
  const semantics = data.semantics;
  if (isRecord(semantics)) {
    if (semantics.uiVisibility === 'hidden') return true;
    if (semantics.transcriptVisibility === 'hidden') return true;
  }
  return data.visibility === 'model-only';
}

/** ts 提取：message.data.time.created（毫秒 → ISO）；缺失/非法 → null（不算坏行）。 */
function zcodeMessageTimestamp(data: Record<string, unknown>): string | null {
  const time = data.time;
  if (!isRecord(time)) return null;
  const created = time.created;
  if (typeof created !== 'number' || !Number.isFinite(created)) return null;
  return new Date(created).toISOString();
}

/** 单条 part 归一化结果：产段 + 坏行/忽略计数增量。 */
interface ZcodePartNormalization {
  segments: UnnumberedSegment[];
  skipped: number;
}

/**
 * 单条 part → 段（design Phase 1 实证映射表）：
 *   - text：所属 message.role=user → user_input、assistant → reply（其它/缺失
 *     role 不产段，对齐文件 parser 未知 role 处理）；
 *   - reasoning → thinking（与 role 无关）；
 *   - tool → 两段（D-004@v1）：tool_use（tool_name/callID/state.input 2KB 摘要）
 *     + tool_result（state.status=='error' 取 state.error 文本，否则 state.output
 *     4KB 摘要；is_error=(status=='error')；status ∈ running/pending 只产 use 段）；
 *   - step-start/step-finish/timeline/file/compaction 与任何未知 type：防御式
 *     忽略（计数 skippedLines，未来新增类型不炸）；
 *   - 结构字段缺失/非法（text/tool/callID/state 非法形状）→ 计 1 跳过不中断。
 */
function normalizeZcodePart(
  part: Record<string, unknown>,
  role: string | null,
  ts: string | null,
): ZcodePartNormalization {
  switch (part.type) {
    case 'text': {
      if (typeof part.text !== 'string') return { segments: [], skipped: 1 };
      if (part.text.trim() === '') return { segments: [], skipped: 0 }; // 空文本不产段（对齐文件 parser 空气泡防御）
      if (role === 'user') {
        return { segments: [makeSegment('user_input', ts, { text: part.text })], skipped: 0 };
      }
      if (role === 'assistant') {
        return { segments: [makeSegment('reply', ts, { text: part.text })], skipped: 0 };
      }
      return { segments: [], skipped: 0 };
    }
    case 'reasoning': {
      if (typeof part.text !== 'string') return { segments: [], skipped: 1 };
      if (part.text.trim() === '') return { segments: [], skipped: 0 };
      return { segments: [makeSegment('thinking', ts, { text: part.text })], skipped: 0 };
    }
    case 'tool': {
      // 结构三要素（tool/callID/state）任一缺失/非法 → 坏行。
      const state = part.state;
      if (typeof part.tool !== 'string' || typeof part.callID !== 'string' || !isRecord(state)) {
        return { segments: [], skipped: 1 };
      }
      const segments: UnnumberedSegment[] = [
        makeSegment('tool_use', ts, {
          tool_name: part.tool,
          tool_use_id: part.callID,
          tool_input: summarizeZcodeToolInput(state.input),
        }),
      ];
      const status = state.status;
      if (status !== 'running' && status !== 'pending') {
        const isError = status === 'error';
        segments.push(
          makeSegment('tool_result', ts, {
            tool_name: part.tool,
            tool_use_id: part.callID,
            tool_result: summarizeZcodeToolResult(isError ? state.error : state.output),
            is_error: isError,
          }),
        );
      }
      return { segments, skipped: 0 };
    }
    case 'step-start':
    case 'step-finish':
    case 'timeline':
    case 'file':
    case 'compaction':
      // 边界/元数据段：防御式忽略（计数）。
      return { segments: [], skipped: 1 };
    default:
      // 未知 type（含缺失）：防御式忽略（计数），未来新增类型不炸。
      return { segments: [], skipped: 1 };
  }
}

/** 构造未编号段：未显式给出的字段一律 null（九字段齐全 snake_case，对齐文件 parser）。 */
function makeSegment(
  kind: NormalizedLogMessage['kind'],
  ts: string | null,
  fields: Partial<
    Pick<UnnumberedSegment, 'text' | 'tool_name' | 'tool_use_id' | 'tool_input' | 'tool_result' | 'is_error'>
  > = {},
): UnnumberedSegment {
  return {
    kind,
    text: fields.text ?? null,
    tool_name: fields.tool_name ?? null,
    tool_use_id: fields.tool_use_id ?? null,
    tool_input: fields.tool_input ?? null,
    tool_result: fields.tool_result ?? null,
    is_error: fields.is_error ?? null,
    ts,
  };
}

/** tool input 摘要：JSON.stringify 后首 2KB 截断（与 parse-zcode-model-io 同口径）。 */
function summarizeZcodeToolInput(input: unknown): string {
  try {
    return (JSON.stringify(input) ?? '').slice(0, ZCODE_TOOL_INPUT_MAX_CHARS);
  } catch {
    // 循环引用等异常形状兜底（DB 来源理论上不会出现，防御式不抛）。
    return String(input).slice(0, ZCODE_TOOL_INPUT_MAX_CHARS);
  }
}

/** tool result 摘要：字符串首 4KB 截断；缺失 → ''；非字符串形状 JSON 序列化兜底（同口径）。 */
function summarizeZcodeToolResult(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, ZCODE_TOOL_RESULT_MAX_CHARS);
  if (content === null || content === undefined) return '';
  try {
    return (JSON.stringify(content) ?? '').slice(0, ZCODE_TOOL_RESULT_MAX_CHARS);
  } catch {
    return String(content).slice(0, ZCODE_TOOL_RESULT_MAX_CHARS);
  }
}

/** unknown 收窄为 Record（行/块结构校验基础）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
