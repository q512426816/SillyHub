// tests/agent-log/read-zcode-sqlite.test.ts
// task-01（2026-09-10-zcode-session-sqlite-read / FR-01）：sess id 提取纯函数 +
// fixture SQLite 造库构造器单测（node:sqlite DatabaseSync 真实建库，零 mock）。
//
// fixture schema / session id 形态按本机真实库只读核对（design Phase 1 实证 +
// task-01 执行期 PRAGMA table_info / index_list / 文件名交叉比对）：主会话文件
// model-io-sess_<uuid>.jsonl → session.id sess_<uuid>；子代理文件
// model-io-sess_subagent_agent_<uuid>.jsonl → sess_subagent_agent_<uuid>。
//
// 覆盖 task-01 acceptance 全项：
//   S1 主会话完整路径提取（Windows \ 与 POSIX / 分隔符 + 纯文件名）
//   S2 子代理路径提取（subagent_agent 前缀完整保留进 session id）
//   S3 非 zcode 命名 → null（claude 文件名 / 其他 model-io 前缀 / 普通文件）
//   S4 无 .jsonl 后缀 / 后缀不符 / 大写后缀 / 空 id → null（纯函数零 fs 零异常）
//   F1 三表建成 + 行数 + 只读 DatabaseSync 查回
//   F2 parent_id（子代理→主会话；主/空会话 NULL）+ 空会话零 message 零 part
//   F3 message.sequence 每会话连续 + part 按 message_id 归属行数
//   F4 part/message.data 逐行 JSON.parse（除坏行）+ 场景按 session_id 区分查询
//      （隐藏三判据各 1 / tool 四态 / 未知类型 1）
//   F5 坏 JSON 行场景独立（全库恰 1 行 part.data 不可解析）
//   F6 close 后句柄释放（Windows rmSync 成功即证据）+ 注入路径生效
//   F7 可重复构造（默认路径两库并存、路径互异、数据各自完整）
//
// task-02（同变更 / FR-01 + D-003/D-004/D-006@v1）：readZcodeSqliteMessages
// 读取器单测（fixture 注入 dbPath，归一化/窗口语义对照 parse-zcode-model-io）：
//   R1 主会话全场景（九段 kind 序列 / tool 两段与 running-pending 单段 / error
//      文本 / 隐藏三判据零泄漏 / 忽略类型与坏行计数 / ts 毫秒→ISO）
//   R2 子代理会话读取
//   R3 空会话 → parsed 空数组
//   R4 坏 message 行与 tool 结构缺失：计数不中断、坏消息 part 一并丢弃
//   R5 beforeSeq 翻页 + 200 段窗口截断（最新在尾取尾部，truncated/totalSegments
//      逐字对齐 parse-zcode-model-io）
//   R6 开库失败（dbPath 不存在文件）→ 抛「读取器不可用」
//   R7 会话不在库 → 抛错不伪造空结果
//   R8 模块级默认库路径工厂覆写与还原
//   R9 tool 摘要截断（tool_input 首 2KB / tool_result 首 4KB）

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractZcodeSessId,
  createZcodeFixtureDb,
  readZcodeSqliteMessages,
  setZcodeSqliteDbPathFactory,
  FIXTURE_TIME_BASE,
  ZCODE_FIXTURE_IDS,
  type ZcodeFixtureDb,
} from '../../src/agent-log/read-zcode-sqlite.js';

// node:sqlite 不在 vite 5 内建外部化清单内，静态 import 会被误解析报
// "Failed to load url sqlite"；经 createRequire 走 Node CJS 加载器直取内建
// （运行时不变，仅测试侧取用方式）。tsc 不含 tests，此处的最小结构类型只为
// 编辑器友好，形状与 src 内声明一致。
interface RoStatement {
  get(...anonymousParameters: unknown[]): unknown;
  all(...anonymousParameters: unknown[]): unknown[];
}
interface RoDatabase {
  prepare(sql: string): RoStatement;
  close(): void;
}
const DatabaseSync = createRequire(import.meta.url)('node:sqlite').DatabaseSync as new (
  location: string,
  options?: { readOnly?: boolean },
) => RoDatabase;

// 写连接（R4/R5/R9 向 fixture 追加注入行）：同一 node:sqlite DatabaseSync 构造器，
// 仅类型收窄为可 run 的最小结构（不加 readOnly 即默认读写）。
interface WrStatement {
  run(...anonymousParameters: unknown[]): unknown;
}
interface WrDatabase {
  prepare(sql: string): WrStatement;
  close(): void;
}
const WritableDatabaseSync = DatabaseSync as unknown as new (location: string) => WrDatabase;

const { mainSession: MAIN, subagentSession: SUB, emptySession: EMPTY } = ZCODE_FIXTURE_IDS;

// ── 测试工具 ──────────────────────────────────────────────────────────────────

/**
 * 造库 → 开只读连接执行断言 → 双 close → 删临时文件。
 * finally 里 fixture.close() 后 rmSync：Windows 上写句柄未释放时 rmSync 抛
 * EBUSY/EPERM——任何用例走过该路径即顺带证明无句柄泄漏（F6 再专项断言）。
 */
async function withFixtureDb(
  fn: (fixture: ZcodeFixtureDb, ro: RoDatabase) => void | Promise<void>,
  options: { dbPath?: string } = {},
): Promise<void> {
  const fixture = await createZcodeFixtureDb(options);
  let ro: RoDatabase | null = null;
  try {
    ro = new DatabaseSync(fixture.dbPath, { readOnly: true });
    await fn(fixture, ro);
  } finally {
    ro?.close();
    fixture.close();
    rmSync(fixture.dbPath, { force: true });
  }
}

/** COUNT 聚合便捷取数（参数化防注入惯例与产码一致）。 */
function count(ro: RoDatabase, sql: string, ...params: unknown[]): number {
  const row = ro.prepare(sql).get(...params) as { n: number | bigint };
  return Number(row.n);
}

// ── extractZcodeSessId（S1-S4）────────────────────────────────────────────────

describe('extractZcodeSessId — sess id 提取纯函数', () => {
  it('S1 主会话完整路径 → sess_<uuid>（Windows/POSIX 分隔符 + 纯文件名）', () => {
    // 真实库核对样本 uuid（model-io-sess_de7e1282-….jsonl ↔ session.id sess_de7e1282-…）。
    const uuid = 'de7e1282-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
    expect(extractZcodeSessId(`C:\\Users\\qinyi\\.zcode\\cli\\rollout\\model-io-sess_${uuid}.jsonl`)).toBe(`sess_${uuid}`);
    expect(extractZcodeSessId(`/home/dev/.zcode/cli/rollout/model-io-sess_${uuid}.jsonl`)).toBe(`sess_${uuid}`);
    // 无目录前缀的纯文件名同样可提取（basename 兼容零分隔符）。
    expect(extractZcodeSessId(`model-io-sess_${uuid}.jsonl`)).toBe(`sess_${uuid}`);
  });

  it('S2 子代理路径 → sess_subagent_agent_<uuid>（前缀完整保留）', () => {
    // 真实 rollout 目录现存子代理文件名样本 uuid。
    const uuid = '5938c855-7a7f-4fa7-8862-50d06da6721d';
    expect(
      extractZcodeSessId(`C:\\Users\\qinyi\\.zcode\\cli\\rollout\\model-io-sess_subagent_agent_${uuid}.jsonl`),
    ).toBe(`sess_subagent_agent_${uuid}`);
    expect(extractZcodeSessId(`/home/dev/.zcode/cli/rollout/model-io-sess_subagent_agent_${uuid}.jsonl`)).toBe(
      `sess_subagent_agent_${uuid}`,
    );
  });

  it('S3 非 zcode 命名 → null', () => {
    expect(extractZcodeSessId('C:\\logs\\claude-20260910T120000.jsonl')).toBeNull();
    expect(extractZcodeSessId('/var/log/model-io-other.jsonl')).toBeNull();
    expect(extractZcodeSessId('/var/log/notes.txt')).toBeNull();
    // 目录名形似也不误提取——只认 basename。
    expect(extractZcodeSessId('/rollout/model-io-sess_x.jsonl/summary.txt')).toBeNull();
  });

  it('S4 无 .jsonl 后缀 / 后缀不符 / 大写后缀 / 空 id → null（零异常）', () => {
    expect(extractZcodeSessId('rollout/model-io-sess_abc')).toBeNull(); // 无后缀
    expect(extractZcodeSessId('rollout/model-io-sess_abc.jsonl.txt')).toBeNull(); // 后缀不符
    expect(extractZcodeSessId('rollout/model-io-sess_abc.JSONL')).toBeNull(); // 大写后缀
    expect(extractZcodeSessId('rollout/model-io-sess_.jsonl')).toBeNull(); // 空 id（.+ 不匹配）
    expect(extractZcodeSessId('')).toBeNull(); // 空串
    expect(extractZcodeSessId('rollout/')).toBeNull(); // 目录残迹
  });
});

// ── createZcodeFixtureDb（F1-F7）──────────────────────────────────────────────

describe('createZcodeFixtureDb — fixture 造库构造器', () => {
  it('F1 三表建成 + 行数 + 只读 DatabaseSync 查回', async () => {
    await withFixtureDb((_fixture, ro) => {
      // 造数全集行数：session 3（主/子代理/空）/ message 8（主 6 + 子代理 2）/ part 19。
      expect(count(ro, 'SELECT COUNT(*) AS n FROM session')).toBe(3);
      expect(count(ro, 'SELECT COUNT(*) AS n FROM message')).toBe(8);
      expect(count(ro, 'SELECT COUNT(*) AS n FROM part')).toBe(19);
      // 主会话行可按 id 查回且关键列非空（title/directory 真实库 NOT NULL）。
      const row = ro.prepare('SELECT id, title, directory FROM session WHERE id = ?').get(MAIN) as {
        id: string;
        title: string;
        directory: string;
      };
      expect(row.id).toBe(MAIN);
      expect(row.title.length).toBeGreaterThan(0);
      expect(row.directory.length).toBeGreaterThan(0);
    });
  });

  it('F2 parent_id（子代理→主会话；主/空会话 NULL）+ 空会话零 message 零 part', async () => {
    await withFixtureDb((_fixture, ro) => {
      const sub = ro.prepare('SELECT parent_id FROM session WHERE id = ?').get(SUB) as { parent_id: string };
      expect(sub.parent_id).toBe(MAIN);
      const main = ro.prepare('SELECT parent_id FROM session WHERE id = ?').get(MAIN) as { parent_id: string | null };
      expect(main.parent_id).toBeNull();
      const empty = ro.prepare('SELECT parent_id FROM session WHERE id = ?').get(EMPTY) as { parent_id: string | null };
      expect(empty.parent_id).toBeNull();
      // 空会话：仅 session 行，message/part 均零。
      expect(count(ro, 'SELECT COUNT(*) AS n FROM message WHERE session_id = ?', EMPTY)).toBe(0);
      expect(count(ro, 'SELECT COUNT(*) AS n FROM part WHERE session_id = ?', EMPTY)).toBe(0);
    });
  });

  it('F3 message.sequence 每会话连续 + part 按 message_id 归属行数', async () => {
    await withFixtureDb((_fixture, ro) => {
      // 主会话 message sequence 1..6 连续；子代理 1..2。
      const mainSeqs = (
        ro.prepare('SELECT sequence FROM message WHERE session_id = ? ORDER BY sequence').all(MAIN) as Array<{
          sequence: number;
        }>
      ).map((r) => r.sequence);
      expect(mainSeqs).toEqual([1, 2, 3, 4, 5, 6]);
      const subSeqs = (
        ro.prepare('SELECT sequence FROM message WHERE session_id = ? ORDER BY sequence').all(SUB) as Array<{
          sequence: number;
        }>
      ).map((r) => r.sequence);
      expect(subSeqs).toEqual([1, 2]);
      // part 按 message 归属：assistantText 7 行（reasoning+text+五种忽略类型）/
      // assistantTools 6 行（tool 四态+未知类型+坏行）/ 每条 user 消息 1 行。
      expect(count(ro, 'SELECT COUNT(*) AS n FROM part WHERE message_id = ?', ZCODE_FIXTURE_IDS.messages.assistantText)).toBe(7);
      expect(count(ro, 'SELECT COUNT(*) AS n FROM part WHERE message_id = ?', ZCODE_FIXTURE_IDS.messages.assistantTools)).toBe(6);
      expect(count(ro, 'SELECT COUNT(*) AS n FROM part WHERE message_id = ?', ZCODE_FIXTURE_IDS.messages.visibleUser)).toBe(1);
    });
  });

  it('F4 data 逐行 JSON.parse（除坏行）+ 场景按 session_id 区分查询', async () => {
    await withFixtureDb((_fixture, ro) => {
      // message.data 全量可解析（坏行只造在 part，见造数清单）。
      const messages = ro.prepare('SELECT data FROM message').all() as Array<{ data: string }>;
      for (const m of messages) {
        expect(() => JSON.parse(m.data)).not.toThrow();
      }
      // part.data 除坏 JSON 行外逐行可解析。
      const parts = ro.prepare('SELECT id, data FROM part').all() as Array<{ id: string; data: string }>;
      const parseable = parts.filter((p) => p.id !== ZCODE_FIXTURE_IDS.parts.badJson);
      expect(parseable.length).toBe(parts.length - 1);
      for (const p of parseable) {
        expect(() => JSON.parse(p.data)).not.toThrow();
      }

      // 隐藏三判据各恰 1 条且互不重叠（主会话）。
      expect(
        count(ro, "SELECT COUNT(*) AS n FROM message WHERE session_id = ? AND json_extract(data, '$.semantics.uiVisibility') = 'hidden'", MAIN),
      ).toBe(1);
      expect(
        count(ro, "SELECT COUNT(*) AS n FROM message WHERE session_id = ? AND json_extract(data, '$.semantics.transcriptVisibility') = 'hidden'", MAIN),
      ).toBe(1);
      expect(
        count(ro, "SELECT COUNT(*) AS n FROM message WHERE session_id = ? AND json_extract(data, '$.visibility') = 'model-only'", MAIN),
      ).toBe(1);

      // tool 四态各 1：completed 带 output；error 带 error 无 output；running/pending 无 output。
      // json_valid 前置守卫：json_extract 对非法 JSON 文本会抛 malformed JSON，
      // 坏行（part_main_6_badjson）须先排除——与 task-02「坏行跳过计数不中断」同语义。
      const toolRows = ro
        .prepare(
          "SELECT json_extract(data, '$.state.status') AS status, json_extract(data, '$.state.output') AS output, json_extract(data, '$.state.error') AS error FROM part WHERE session_id = ? AND json_valid(data) AND json_extract(data, '$.type') = 'tool'",
        )
        .all(MAIN) as Array<{ status: string; output: unknown; error: unknown }>;
      expect(toolRows.length).toBe(4);
      const byStatus = new Map(toolRows.map((r) => [r.status, r]));
      expect([...byStatus.keys()].sort()).toEqual(['completed', 'error', 'pending', 'running']);
      expect(byStatus.get('completed')?.output).toBe('3 passed');
      expect(byStatus.get('error')?.error).toBe('Command failed with exit code 1');
      expect(byStatus.get('error')?.output).toBeNull();
      expect(byStatus.get('running')?.output).toBeNull();
      expect(byStatus.get('pending')?.output).toBeNull();

      // 未知 part 类型恰 1 条（不在真实八类白名单内）。
      expect(
        count(
          ro,
          "SELECT COUNT(*) AS n FROM part WHERE session_id = ? AND json_valid(data) AND json_extract(data, '$.type') NOT IN ('text', 'tool', 'reasoning', 'step-start', 'step-finish', 'timeline', 'file', 'compaction')",
          MAIN,
        ),
      ).toBe(1);
    });
  });

  it('F5 坏 JSON 行场景独立：全库恰 1 行 part.data 不可解析', async () => {
    await withFixtureDb((_fixture, ro) => {
      const parts = ro.prepare('SELECT id, data FROM part').all() as Array<{ id: string; data: string }>;
      const bad = parts.filter((p) => {
        try {
          JSON.parse(p.data);
          return false;
        } catch {
          return true;
        }
      });
      // 恰 1 行坏行，且 id 即造数声明的坏行。
      expect(bad.map((p) => p.id)).toEqual([ZCODE_FIXTURE_IDS.parts.badJson]);
      // 坏行内容是截断的 JSON 文本（供 task-02 skippedLines 计数语义）。
      expect(bad[0]?.data.startsWith('{"type":"text"')).toBe(true);
    });
  });

  it('F6 close 后句柄释放（rmSync 成功即证据）+ 注入路径生效', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcode-fx-inject-'));
    const injected = join(dir, 'injected.sqlite');
    try {
      const fixture = await createZcodeFixtureDb({ dbPath: injected });
      expect(fixture.dbPath).toBe(injected);
      expect(existsSync(injected)).toBe(true);
      fixture.close();
      // Windows 上写句柄未释放时 rmSync 抛 EBUSY/EPERM——删成功即句柄已释放
      // （acceptance「不泄漏文件句柄」专项；幂等 close 再调一次不炸）。
      fixture.close();
      rmSync(injected);
      expect(existsSync(injected)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('F7 可重复构造：默认路径两库并存、路径互异、数据各自完整', async () => {
    const fixtureA = await createZcodeFixtureDb();
    const fixtureB = await createZcodeFixtureDb();
    try {
      expect(fixtureA.dbPath).not.toBe(fixtureB.dbPath);
      for (const fixture of [fixtureA, fixtureB]) {
        const ro: RoDatabase = new DatabaseSync(fixture.dbPath, { readOnly: true });
        try {
          expect(count(ro, 'SELECT COUNT(*) AS n FROM session')).toBe(3);
          expect(count(ro, 'SELECT COUNT(*) AS n FROM message')).toBe(8);
          expect(count(ro, 'SELECT COUNT(*) AS n FROM part')).toBe(19);
        } finally {
          ro.close();
        }
      }
    } finally {
      fixtureA.close();
      fixtureB.close();
      rmSync(fixtureA.dbPath, { force: true });
      rmSync(fixtureB.dbPath, { force: true });
    }
  });
});

// ── readZcodeSqliteMessages（R1-R9，task-02 读取器）──────────────────────────

describe('readZcodeSqliteMessages — SQLite 会话读取器', () => {
  it('R1 主会话全场景：九段 kind 序列 / tool 两段与 running-pending 单段 / error 文本 / 隐藏零泄漏 / 计数 / ts', async () => {
    await withFixtureDb(async (fixture) => {
      const result = await readZcodeSqliteMessages(MAIN, null, { dbPath: fixture.dbPath });
      expect(result.status).toBe('parsed');
      expect(result.truncated).toBe(false);
      expect(result.totalSegments).toBe(9);
      // 7 = msg_main_5 五种忽略类型（step-start/step-finish/timeline/file/compaction）
      // + msg_main_6 未知类型 hologram + 坏 JSON 行。
      expect(result.skippedLines).toBe(7);
      // seq 全局重编号 1 起（隐藏三条 + 忽略段跳过后连续）。
      expect(result.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(result.messages.map((m) => m.kind)).toEqual([
        'user_input',
        'thinking',
        'reply',
        'tool_use',
        'tool_result', // completed：单 part 两段
        'tool_use',
        'tool_result', // error：state.error 文本进 result、is_error=true
        'tool_use', // running：只产 use 段
        'tool_use', // pending：只产 use 段
      ]);

      const ISO = (delta: number) => new Date(FIXTURE_TIME_BASE + delta).toISOString();
      const [userInput, thinking, reply, use1, res1, use2, res2, use3, use4] = result.messages;
      // 九字段 snake_case 齐全：首段逐字段断言（未给字段一律 null）。
      expect(userInput).toEqual({
        seq: 1,
        kind: 'user_input',
        text: '帮我排查这个构建失败',
        tool_name: null,
        tool_use_id: null,
        tool_input: null,
        tool_result: null,
        is_error: null,
        ts: ISO(1000),
      });
      expect(thinking).toMatchObject({ kind: 'thinking', text: '先看构建日志定位报错行…', ts: ISO(5000) });
      expect(reply).toMatchObject({ kind: 'reply', text: '构建失败原因是依赖版本冲突。', ts: ISO(5000) });
      // tool completed：use + result 两段，ts 取 message.time.created。
      expect(use1).toMatchObject({
        kind: 'tool_use',
        tool_name: 'Bash',
        tool_use_id: 'call_c1',
        tool_input: '{"command":"pnpm test"}',
        tool_result: null,
        is_error: null,
        ts: ISO(10000),
      });
      expect(res1).toMatchObject({
        kind: 'tool_result',
        tool_name: 'Bash',
        tool_use_id: 'call_c1',
        tool_input: null,
        tool_result: '3 passed',
        is_error: false,
        ts: ISO(10000),
      });
      // tool error：error 态取 state.error 文本进 tool_result。
      expect(use2).toMatchObject({ kind: 'tool_use', tool_name: 'Bash', tool_use_id: 'call_c2', tool_input: '{"command":"exit 1"}', tool_result: null, is_error: null });
      expect(res2).toMatchObject({ kind: 'tool_result', tool_name: 'Bash', tool_use_id: 'call_c2', tool_result: 'Command failed with exit code 1', is_error: true });
      // running/pending：无 output，只产 tool_use。
      expect(use3).toMatchObject({ kind: 'tool_use', tool_name: 'Grep', tool_use_id: 'call_c3', tool_input: '{"pattern":"TODO"}', tool_result: null, is_error: null });
      expect(use4).toMatchObject({ kind: 'tool_use', tool_name: 'WebSearch', tool_use_id: 'call_c4', tool_input: '{"query":"node sqlite"}', tool_result: null, is_error: null });
      // 隐藏三判据零泄漏：三条隐藏消息正文均不出现。
      const blob = JSON.stringify(result.messages);
      expect(blob).not.toContain('uiVisibility 隐藏');
      expect(blob).not.toContain('transcriptVisibility 隐藏');
      expect(blob).not.toContain('visibility=model-only');
    });
  });

  it('R2 子代理会话读取（sess_subagent_agent_* 同规则）', async () => {
    await withFixtureDb(async (fixture) => {
      const result = await readZcodeSqliteMessages(SUB, null, { dbPath: fixture.dbPath });
      expect(result.status).toBe('parsed');
      expect(result.truncated).toBe(false);
      expect(result.totalSegments).toBe(2);
      expect(result.skippedLines).toBe(0);
      expect(result.messages.map((m) => [m.seq, m.kind, m.text, m.ts])).toEqual([
        [1, 'user_input', '调查这个已知问题的实现现状', new Date(FIXTURE_TIME_BASE + 20000).toISOString()],
        [2, 'reply', '调查结论：问题出在读取层。', new Date(FIXTURE_TIME_BASE + 21000).toISOString()],
      ]);
    });
  });

  it('R3 空会话 → parsed 空数组（不伪造 parse_error）', async () => {
    await withFixtureDb(async (fixture) => {
      const result = await readZcodeSqliteMessages(EMPTY, null, { dbPath: fixture.dbPath });
      expect(result).toEqual({ status: 'parsed', messages: [], truncated: false, totalSegments: 0, skippedLines: 0 });
    });
  });

  it('R4 坏 message 行与 tool 结构缺失：计数不中断、坏消息 part 一并丢弃', async () => {
    await withFixtureDb(async (fixture) => {
      const wr = new WritableDatabaseSync(fixture.dbPath);
      try {
        wr.prepare('INSERT INTO message (id, session_id, sequence, data) VALUES (?, ?, ?, ?)').run(
          'msg_main_bad_json',
          MAIN,
          7,
          '{"role":"user",',
        );
        const insertPart = wr.prepare('INSERT INTO part (id, message_id, session_id, sequence, data) VALUES (?, ?, ?, ?, ?)');
        // 坏 message 的健康 part：随消息一并丢弃，不产段也不计数（坏在 message 记 1 次）。
        insertPart.run('part_bad_msg_text', 'msg_main_bad_json', MAIN, 1, JSON.stringify({ type: 'text', text: '坏消息的健康 part' }));
        // 合法 JSON 但 tool 三要素缺 state：字段缺失坏行。
        insertPart.run(
          'part_main_6_tool_missing_state',
          ZCODE_FIXTURE_IDS.messages.assistantTools,
          MAIN,
          7,
          JSON.stringify({ type: 'tool', tool: 'Bash', callID: 'call_c9' }),
        );
      } finally {
        wr.close();
      }
      const result = await readZcodeSqliteMessages(MAIN, null, { dbPath: fixture.dbPath });
      expect(result.status).toBe('parsed');
      expect(result.totalSegments).toBe(9); // 不中断：九段照常产出
      expect(result.skippedLines).toBe(9); // 7 既有 + 坏 message 1 + 缺 state tool 1
      expect(JSON.stringify(result.messages)).not.toContain('坏消息的健康 part');
    });
  });

  it('R5 beforeSeq 翻页 + 200 段窗口截断（最新在尾取尾部，对齐 parse-zcode-model-io）', async () => {
    await withFixtureDb(async (fixture) => {
      const BIG = 'sess_00000000-0004-4000-8000-000000000004';
      const wr = new WritableDatabaseSync(fixture.dbPath);
      try {
        wr.prepare('INSERT INTO session (id, title, directory, parent_id) VALUES (?, ?, ?, ?)').run(BIG, '大会话', 'C:\\repo\\big', null);
        const insertMessage = wr.prepare('INSERT INTO message (id, session_id, sequence, data) VALUES (?, ?, ?, ?)');
        const insertPart = wr.prepare('INSERT INTO part (id, message_id, session_id, sequence, data) VALUES (?, ?, ?, ?, ?)');
        for (let i = 1; i <= 210; i++) {
          const messageId = `msg_big_${i}`;
          insertMessage.run(messageId, BIG, i, JSON.stringify({ role: 'user', time: { created: FIXTURE_TIME_BASE + i } }));
          insertPart.run(`part_big_${i}`, messageId, BIG, 1, JSON.stringify({ type: 'text', text: `第 ${i} 条` }));
        }
      } finally {
        wr.close();
      }
      // 首窗：210 段 > 200 → truncated=true，返回最近 200 段（尾部，最新在尾）。
      const first = await readZcodeSqliteMessages(BIG, null, { dbPath: fixture.dbPath });
      expect(first.truncated).toBe(true);
      expect(first.totalSegments).toBe(210);
      expect(first.messages).toHaveLength(200);
      expect(first.messages[0]).toMatchObject({ seq: 11, text: '第 11 条' });
      expect(first.messages.at(-1)).toMatchObject({ seq: 210, text: '第 210 条' });
      // 「加载更早」：beforeSeq=11 → seq<11 共 10 段，窗口内不截断。
      const earlier = await readZcodeSqliteMessages(BIG, 11, { dbPath: fixture.dbPath });
      expect(earlier.truncated).toBe(false);
      expect(earlier.totalSegments).toBe(210);
      expect(earlier.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      // 切片后恰 200 段 = 窗口边界内，不截断。
      const exact = await readZcodeSqliteMessages(BIG, 201, { dbPath: fixture.dbPath });
      expect(exact.truncated).toBe(false);
      expect(exact.messages).toHaveLength(200);
      expect(exact.messages[0]).toMatchObject({ seq: 1 });
      // beforeSeq 越过最早段 → 空窗口仍 parsed，totalSegments 恒全量。
      const beyond = await readZcodeSqliteMessages(BIG, 1, { dbPath: fixture.dbPath });
      expect(beyond).toMatchObject({ status: 'parsed', truncated: false, totalSegments: 210 });
      expect(beyond.messages).toEqual([]);
    });
  });

  it('R6 开库失败：dbPath 指向不存在的文件 → 抛「读取器不可用」', async () => {
    const missing = join(tmpdir(), `zcode-not-exist-${process.pid}-${Date.now()}.sqlite`);
    await expect(readZcodeSqliteMessages(MAIN, null, { dbPath: missing })).rejects.toThrow(/读取器不可用/);
  });

  it('R7 会话不在库 → 抛错不伪造空结果（fixture 库只含其它会话）', async () => {
    await withFixtureDb(async (fixture) => {
      const absent = 'sess_ffffffff-0009-4000-8000-000000000099';
      await expect(readZcodeSqliteMessages(absent, null, { dbPath: fixture.dbPath })).rejects.toThrow(/不在库/);
    });
  });

  it('R7b 内存预算命中（ql-20260911-003-355a P2）：累计行 data 超限 → too_large 不物化全量段', async () => {
    await withFixtureDb(async (fixture) => {
      const result = await readZcodeSqliteMessages(MAIN, null, {
        dbPath: fixture.dbPath,
        maxContentUnits: 10, // 远小于 fixture 主会话任意一行 data
      });
      expect(result.status).toBe('too_large');
      expect(result.messages).toEqual([]);
      expect(result.totalSegments).toBe(0);
    });
    // 预算充足时同库正常解析（对照——预算不误伤正常路径）
    await withFixtureDb(async (fixture) => {
      const result = await readZcodeSqliteMessages(MAIN, null, {
        dbPath: fixture.dbPath,
        maxContentUnits: 20 * 1024 * 1024,
      });
      expect(result.status).toBe('parsed');
      expect(result.totalSegments).toBeGreaterThan(0);
    });
  });

  it('R8 模块级默认库路径工厂覆写与还原', async () => {
    await withFixtureDb(async (fixture) => {
      setZcodeSqliteDbPathFactory(() => fixture.dbPath);
      try {
        const result = await readZcodeSqliteMessages(SUB, null);
        expect(result.totalSegments).toBe(2);
      } finally {
        setZcodeSqliteDbPathFactory(null);
      }
      // 还原后无 opts.dbPath 走缺省 ~/.zcode/cli/db/db.sqlite：fixture 会话必然
      // 不在真实库中（或本机无 zcode 库 → 读取器不可用），两种情况都抛错而非
      // 误返回数据——工厂还原语义即由该抛错反证。
      await expect(readZcodeSqliteMessages(SUB, null)).rejects.toThrow();
    });
  });

  it('R9 tool 摘要截断：tool_input JSON 首达 2KB / tool_result 首达 4KB', async () => {
    await withFixtureDb(async (fixture) => {
      const TRUNC = 'sess_11111111-0005-4000-8000-000000000005';
      const wr = new WritableDatabaseSync(fixture.dbPath);
      try {
        wr.prepare('INSERT INTO session (id, title, directory, parent_id) VALUES (?, ?, ?, ?)').run(TRUNC, '截断会话', 'C:\\repo\\trunc', null);
        wr.prepare('INSERT INTO message (id, session_id, sequence, data) VALUES (?, ?, ?, ?)').run(
          'msg_trunc_1',
          TRUNC,
          1,
          JSON.stringify({ role: 'assistant', time: { created: FIXTURE_TIME_BASE, completed: FIXTURE_TIME_BASE + 1 } }),
        );
        wr.prepare('INSERT INTO part (id, message_id, session_id, sequence, data) VALUES (?, ?, ?, ?, ?)').run(
          'part_trunc_tool',
          'msg_trunc_1',
          TRUNC,
          1,
          JSON.stringify({
            type: 'tool',
            tool: 'Bash',
            callID: 'call_t1',
            state: { status: 'completed', input: { command: 'x'.repeat(3000) }, output: 'o'.repeat(5000) },
          }),
        );
      } finally {
        wr.close();
      }
      const result = await readZcodeSqliteMessages(TRUNC, null, { dbPath: fixture.dbPath });
      expect(result.totalSegments).toBe(2);
      const [use, res] = result.messages;
      const expectedInputJson = JSON.stringify({ command: 'x'.repeat(3000) });
      expect(use?.tool_input).toBe(expectedInputJson.slice(0, 2048));
      expect(use?.tool_input?.length).toBe(2048);
      expect(res?.tool_result).toBe('o'.repeat(4096));
      expect(res?.tool_result?.length).toBe(4096);
    });
  });
});
