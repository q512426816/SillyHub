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

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractZcodeSessId,
  createZcodeFixtureDb,
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
