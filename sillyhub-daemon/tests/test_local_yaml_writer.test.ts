/**
 * tests/test_local_yaml_writer.test.ts —— local-yaml-writer 单元测试
 * （task-11 / FR-04 / FR-05 / D-004）。
 *
 * 守护 src/local-yaml-writer.ts 的三层契约（design §5.4 + §7.3）：
 *   - findTopLevelSectionRange / replaceTopLevelSection（纯函数：文本级段替换算法）
 *   - writeLocalYaml（落盘：platform 无条件覆盖 + mcp 有才留 + 文件不存在创建）
 *
 * 六场景（蓝图 task-11.md acceptance）：
 *   1. platform 段无条件覆盖（旧 url/token → serverOrigin+platform_token）
 *   2. mcp 段有才留（已存在用户自定义 mcp → 原样不动）—— D-004
 *   3. 注释字节级保留（段外注释/其他段/嵌套内容逐字不变）
 *   4. CRLF + LF 两种换行都正确保留
 *   5. 文件不存在时创建含 platform + mcp 两段
 *   6. 顶层段边界精确（不误伤 mcp 下 url/token 缩进子键）
 *
 * 策略：
 *   - 纯函数（findTopLevelSectionRange / replaceTopLevelSection）用内存字符串直接断言，
 *     覆盖段边界 / CRLF 字节保留 / 删除分支。
 *   - writeLocalYaml 用 mkdtemp 临时根目录真实读写 .sillyspec/local.yaml，
 *     不依赖任何真实 local.yaml（约束：不依赖真实 local.yaml）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeLocalYaml,
  findTopLevelSectionRange,
  replaceTopLevelSection,
} from '../src/local-yaml-writer.js';

// ── 测试常量 ────────────────────────────────────────────────────────────────
const PLATFORM_TOKEN = 'shp_live_PTOK_111';
const MCP_TOKEN = 'shm_live_MTOK_222';
const SERVER_ORIGIN = 'https://hub.example.test';
const LOCAL = { platform_token: PLATFORM_TOKEN, mcp_token: MCP_TOKEN };

const LOCAL_YAML = (root: string) => join(root, '.sillyspec', 'local.yaml');

// ── 临时目录管理 ────────────────────────────────────────────────────────────
const tmpRoots: string[] = [];

/**
 * 建唯一临时根目录；传 prefilled 则预置 .sillyspec/local.yaml 内容
 * （不传则不创建 .sillyspec，用于"文件不存在"场景）。
 */
async function makeRoot(prefilled?: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lyw-'));
  tmpRoots.push(root);
  if (prefilled !== undefined) {
    await mkdir(join(root, '.sillyspec'), { recursive: true });
    await writeFile(LOCAL_YAML(root), prefilled, 'utf8');
  }
  return root;
}

afterEach(async () => {
  // 每个用例独立临时目录，测后清空（splice 清空数组并发发 rm）。
  await Promise.all(
    tmpRoots.splice(0).map((r) => rm(r, { recursive: true, force: true }).catch(() => {})),
  );
});

// ────────────────────────────────────────────────────────────────────────────
// 场景 1：platform 段无条件覆盖
// ────────────────────────────────────────────────────────────────────────────
describe('场景 1：writeLocalYaml platform 段无条件覆盖（FR-04）', () => {
  it('已有 platform 旧 url/token 被替换为 serverOrigin+platform_token，段外注释保留，mcp 追加', async () => {
    const before =
      '# 顶部注释\n' +
      'platform:\n' +
      '  url: https://old.example.com\n' +
      '  token: OLD_PT\n' +
      '# 尾部注释\n';
    const root = await makeRoot(before);

    await writeLocalYaml(root, LOCAL, SERVER_ORIGIN);
    const after = await readFile(LOCAL_YAML(root), 'utf8');

    // 整串精确匹配：注释保留 + platform 覆盖 + mcp 追加（两段间空行分隔）
    expect(after).toBe(
      '# 顶部注释\n' +
        'platform:\n' +
        '  url: https://hub.example.test\n' +
        `  token: ${PLATFORM_TOKEN}\n` +
        '# 尾部注释\n' +
        '\n' +
        'mcp:\n' +
        '  url: https://hub.example.test/mcp\n' +
        `  token: ${MCP_TOKEN}\n`,
    );
  });

  it('serverOrigin 尾部斜杠被剥离（platformUrl + mcp url 均无尾斜杠）', async () => {
    const before = 'platform:\n  url: https://old.example.com\n  token: OLD_PT\n';
    const root = await makeRoot(before);

    // 末尾多个斜杠都应被 replace(/\/+$/, '') 剥掉
    await writeLocalYaml(root, LOCAL, 'https://hub.example.test///');
    const after = await readFile(LOCAL_YAML(root), 'utf8');

    expect(after).toContain('url: https://hub.example.test\n');
    expect(after).toContain('url: https://hub.example.test/mcp\n');
    expect(after).not.toContain('hub.example.test//');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 场景 2：mcp 段有才留（D-004）
// ────────────────────────────────────────────────────────────────────────────
describe('场景 2：writeLocalYaml mcp 段有才留（D-004 / FR-05）', () => {
  it('已存在的用户自定义 mcp 段原样保留（url+token 不被覆盖）', async () => {
    const before =
      'platform:\n' +
      '  url: https://old.example.com\n' +
      '  token: OLD_PT\n' +
      'mcp:\n' +
      '  url: https://custom-mcp.example.test:9000/mcp\n' +
      '  token: USER_CUSTOM_MT\n';
    const root = await makeRoot(before);

    await writeLocalYaml(root, LOCAL, SERVER_ORIGIN);
    const after = await readFile(LOCAL_YAML(root), 'utf8');

    // platform 被覆盖 + mcp 原样保留（精确整串）
    expect(after).toBe(
      'platform:\n' +
        '  url: https://hub.example.test\n' +
        `  token: ${PLATFORM_TOKEN}\n` +
        'mcp:\n' +
        '  url: https://custom-mcp.example.test:9000/mcp\n' +
        '  token: USER_CUSTOM_MT\n',
    );
    // 关键：用户的 mcp 配置不被下发的 mcp_token 覆盖
    expect(after).not.toContain(MCP_TOKEN);
    expect(after).toContain('USER_CUSTOM_MT');
    expect(after).toContain('https://custom-mcp.example.test:9000/mcp');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 场景 3：注释字节级保留
// ────────────────────────────────────────────────────────────────────────────
describe('场景 3：writeLocalYaml 注释与段外内容字节级保留', () => {
  it('多注释 + 其他顶层段 + 嵌套内容全部逐字保留，仅 platform 覆盖、mcp 追加', async () => {
    const before =
      '# 顶部注释 A\n' +
      '# 顶部注释 B\n' +
      '\n' +
      'platform:\n' +
      '  url: https://old.example.com\n' +
      '  token: OLD_PT\n' +
      '\n' +
      '# 段间注释\n' +
      'other_section:\n' +
      '  foo: bar\n' +
      '  nested:\n' +
      '    deep: value\n' +
      '# 尾部注释\n';
    const root = await makeRoot(before);

    await writeLocalYaml(root, LOCAL, SERVER_ORIGIN);
    const after = await readFile(LOCAL_YAML(root), 'utf8');

    // —— 字节级保留：platform 段之前的所有内容（顶部注释 + 空行）必须逐字不变 ——
    const prefixBefore = before.slice(0, before.indexOf('platform:'));
    const prefixAfter = after.slice(0, after.indexOf('platform:'));
    expect(prefixAfter).toBe(prefixBefore);

    // —— 段间注释 / other_section / 嵌套内容逐字保留 ——
    expect(after).toContain('# 段间注释');
    expect(after).toContain('other_section:\n  foo: bar');
    expect(after).toContain('  nested:\n    deep: value');
    expect(after).toContain('# 尾部注释');
    expect(after).toContain('# 顶部注释 A');
    expect(after).toContain('# 顶部注释 B');

    // —— 旧 platform 值已消失，新 platform + mcp 写入 ——
    expect(after).not.toContain('https://old.example.com');
    expect(after).not.toContain('OLD_PT');
    expect(after).toContain(`token: ${PLATFORM_TOKEN}`);
    expect(after).toContain(`  url: ${SERVER_ORIGIN}/mcp`);
    expect(after).toContain(`token: ${MCP_TOKEN}`);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 场景 4：CRLF + LF 两种换行都正确保留
// ────────────────────────────────────────────────────────────────────────────
describe('场景 4：CRLF + LF 换行保留（跨平台 / 约束：CRLF 与 LF 都测）', () => {
  describe('纯函数 findTopLevelSectionRange / replaceTopLevelSection', () => {
    it('LF 文本：段边界精确，replace 删除分支字节级保留（无 \\r 引入）', () => {
      const text = '# c\nplatform:\n  url: x\n  token: y\n# tail\n';
      expect(findTopLevelSectionRange(text, 'platform')).toEqual({ start: 1, end: 4 });

      // 删除 platform 段，其余字节（含注释）原样
      const deleted = replaceTopLevelSection(text, 'platform', null);
      expect(deleted).toBe('# c\n# tail\n');
      expect(deleted).not.toContain('\r');
    });

    it('CRLF 文本：行尾 \\r 保留，段边界仍精确（不因 \\r 误判）', () => {
      // split('\n') 后每行尾留 \r；重组应原样还原。
      const text = '# c\r\nplatform:\r\n  url: x\r\n  token: y\r\n# tail\r\n';
      // platform: 行尾的 \r 不影响 startsWith('platform:') 匹配
      expect(findTopLevelSectionRange(text, 'platform')).toEqual({ start: 1, end: 4 });

      // 删除分支：CRLF 字节级保留（注释行 \r\n 不变）
      const deleted = replaceTopLevelSection(text, 'platform', null);
      expect(deleted).toBe('# c\r\n# tail\r\n');
    });

    it('CRLF 文本：删除不存在段，原样返回（含全部 \\r）', () => {
      const text = 'platform:\r\n  url: x\r\n';
      expect(replaceTopLevelSection(text, 'mcp', null)).toBe(text);
    });
  });

  describe('writeLocalYaml 落盘换行', () => {
    it('LF 文件：写入后整文件不含 \\r（不引入 CRLF）', async () => {
      const before =
        '# comment\nplatform:\n  url: https://old.example.com\n  token: OLD_PT\n';
      const root = await makeRoot(before);

      await writeLocalYaml(root, LOCAL, SERVER_ORIGIN);
      const after = await readFile(LOCAL_YAML(root), 'utf8');

      expect(after).not.toContain('\r');
      expect(after).toContain('# comment\n');
      expect(after).toContain(`token: ${PLATFORM_TOKEN}\n`);
    });

    it('CRLF 文件：段外注释行的 \\r\\n 保留（段内新内容按实现现状不强制 \\r）', async () => {
      // CRLF 输入：每行 \r\n 结尾
      const before =
        '# comment\r\nplatform:\r\n  url: https://old.example.com\r\n  token: OLD_PT\r\n';
      const root = await makeRoot(before);

      await writeLocalYaml(root, LOCAL, SERVER_ORIGIN);
      const after = await readFile(LOCAL_YAML(root), 'utf8');

      // 段外注释行的 \r 保留（字节级保留段外内容）
      expect(after).toContain('# comment\r\n');
      // 新 platform 内容正确写入
      expect(after).toContain(`url: ${SERVER_ORIGIN}`);
      expect(after).toContain(`token: ${PLATFORM_TOKEN}`);
      // mcp 段被追加（文件原本无 mcp）
      expect(after).toContain(`  url: ${SERVER_ORIGIN}/mcp`);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 场景 5：文件不存在时创建含 platform + mcp 两段
// ────────────────────────────────────────────────────────────────────────────
describe('场景 5：writeLocalYaml 文件不存在时创建两段（FR-04 / FR-05）', () => {
  it('.sillyspec/local.yaml 不存在 → 创建文件含 platform + mcp 两段', async () => {
    // makeRoot() 不传 prefilled → 不建 .sillyspec，模拟全新项目
    const root = await makeRoot();

    await writeLocalYaml(root, LOCAL, SERVER_ORIGIN);

    // 文件被创建
    const st = await stat(LOCAL_YAML(root));
    expect(st.isFile()).toBe(true);

    const after = await readFile(LOCAL_YAML(root), 'utf8');

    // platform 段（url 去尾斜杠 + token）
    expect(after).toContain('platform:\n');
    expect(after).toContain(`  url: ${SERVER_ORIGIN}\n`);
    expect(after).toContain(`  token: ${PLATFORM_TOKEN}\n`);
    // mcp 段（url = origin/mcp + token）
    expect(after).toContain('mcp:\n');
    expect(after).toContain(`  url: ${SERVER_ORIGIN}/mcp\n`);
    expect(after).toContain(`  token: ${MCP_TOKEN}\n`);

    // 整串精确匹配（实现当前不写注释；design §5.4 "+最小注释" 为 task-03 待补缺口）
    expect(after).toBe(
      'platform:\n' +
        `  url: ${SERVER_ORIGIN}\n` +
        `  token: ${PLATFORM_TOKEN}\n` +
        '\n' +
        'mcp:\n' +
        `  url: ${SERVER_ORIGIN}/mcp\n` +
        `  token: ${MCP_TOKEN}\n`,
    );
  });

  it('.sillyspec 目录也不存在 → 递归创建目录并写入文件', async () => {
    const root = await makeRoot(); // 无 .sillyspec
    await writeLocalYaml(root, LOCAL, SERVER_ORIGIN);
    const dirStat = await stat(join(root, '.sillyspec'));
    expect(dirStat.isDirectory()).toBe(true);
    const fileStat = await stat(LOCAL_YAML(root));
    expect(fileStat.isFile()).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 场景 6：顶层段边界精确（不误伤 mcp 下 url/token 缩进子键）
// ────────────────────────────────────────────────────────────────────────────
describe('场景 6：findTopLevelSectionRange 顶层段边界精确（约束：非缩进子键）', () => {
  it('不匹配缩进子键：搜索 url/token 只命中行首非缩进，缩进子键返回 null', () => {
    const text =
      'platform:\n' +
      '  url: https://x\n' + // 缩进子键
      '  token: T\n' + // 缩进子键
      'mcp:\n' +
      '  url: https://y/mcp\n' +
      '  token: M\n';

    // url / token 都是缩进子键（行首空格），无顶层 → null
    expect(findTopLevelSectionRange(text, 'url')).toBeNull();
    expect(findTopLevelSectionRange(text, 'token')).toBeNull();
    // 顶层 platform / mcp 正确命中
    expect(findTopLevelSectionRange(text, 'platform')).toEqual({ start: 0, end: 3 });
    expect(findTopLevelSectionRange(text, 'mcp')).toEqual({ start: 3, end: 6 });
  });

  it('段 end 在下一个顶层 key 前停止（不吃掉后续顶层段）', () => {
    const text =
      'mcp:\n' +
      '  url: A\n' +
      '  token: B\n' +
      'other: value\n' +
      'platform:\n' +
      '  url: C\n';
    // mcp 段 end 应停在 'other: value' 行（next top-level key），不含 other
    const range = findTopLevelSectionRange(text, 'mcp');
    expect(range).toEqual({ start: 0, end: 3 });
  });

  it('不误伤 mcp 下 url/token 缩进子键：replaceTopLevelSection 只换顶层 mcp 段', () => {
    const text =
      'deep:\n' +
      '  mcp:\n' + // 嵌套缩进 mcp（不应被命中）
      '    url: nested_url\n' +
      'mcp:\n' + // 顶层 mcp
      '  url: top_url\n' +
      '  token: top_token\n';

    // 替换顶层 mcp，嵌套 deep.mcp 必须保留
    const replaced = replaceTopLevelSection(
      text,
      'mcp',
      '  url: NEW_URL\n  token: NEW_TOK',
    );

    // 嵌套 mcp 子树原样
    expect(replaced).toContain('deep:\n  mcp:\n    url: nested_url');
    // 顶层 mcp 已替换
    expect(replaced).toContain('mcp:\n  url: NEW_URL\n  token: NEW_TOK');
    // 旧的顶层 mcp 值消失
    expect(replaced).not.toContain('top_url');
    expect(replaced).not.toContain('top_token');
  });

  it('CRLF 下边界仍精确（行尾 \\r 不影响顶层判定与子键排除）', () => {
    const text =
      'platform:\r\n  url: x\r\n  token: y\r\nmcp:\r\n  url: z\r\n  token: w\r\n';
    // 顶层命中不受 \r 干扰
    expect(findTopLevelSectionRange(text, 'platform')).toEqual({ start: 0, end: 3 });
    expect(findTopLevelSectionRange(text, 'mcp')).toEqual({ start: 3, end: 6 });
    // 缩进子键仍排除
    expect(findTopLevelSectionRange(text, 'url')).toBeNull();
    expect(findTopLevelSectionRange(text, 'token')).toBeNull();
  });

  it('段不存在返回 null（找不到顶层 key 返回 null 而非抛错）', () => {
    const text = 'platform:\n  url: x\n';
    expect(findTopLevelSectionRange(text, 'mcp')).toBeNull();
    expect(findTopLevelSectionRange(text, 'nonexistent')).toBeNull();
  });
});
