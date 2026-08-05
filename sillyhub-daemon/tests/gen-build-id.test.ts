// tests/gen-build-id.test.ts
// task-05：gen-build-id 输出格式回归测试 —— 守护 self-update 链路 R-04。
//
// 背景：daemon 侧 build-bundle 会把 src/build-id.ts 打进 bundle；backend
// `_compute_daemon_version`（router.py:122）用正则从部署的 bundle 提取 BUILD_ID，
// 这是 self-update 比对版本的关键入口。本测试运行 task-01 的 gen-build-id.mjs
// 真实生成 src/build-id.ts，再用 backend 正则的 JS 等价镜像反向匹配，确保：
//   1. gen 产出能被 backend 正则提取（捕获组非空）；
//   2. 提取值的格式合法（<8位hex>-<14位数字> 或 unknown 前缀 fallback）；
//   3. 关键回归点：gen 产出的 export 行【无 `: string` 类型注解】——
//      因为 backend 正则 `BUILD_ID\s*=\s*["']` 中的 \s* 不吃冒号，
//      一旦 gen 漂移成 `BUILD_ID: string = "..."`，self-update 提取会失配，
//      本测试应变红拦截。
//
// 约束（对照 task-05.md constraints）：
//   - 不改 backend router.py（正则源头在 backend，本任务只在其镜像上写测试）；
//   - 不改 gen-build-id.mjs 本体（格式源头归 task-01）；
//   - 必须真实跑 gen-build-id.mjs 生成，不手写假 build-id.ts 绕过；
//   - 跨平台（Win/Linux/mac），仅用 node child_process 与 fs，不依赖 bash。

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── 路径解析 ───────────────────────────────────────────────────────────────
// 本测试文件位于 sillyhub-daemon/tests/，gen 脚本在同包 scripts/，产物在同包 src/build-id.ts。
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..');
const GEN_SCRIPT = resolve(PKG_ROOT, 'scripts', 'gen-build-id.mjs');
const BUILD_ID_FILE = resolve(PKG_ROOT, 'src', 'build-id.ts');

// ─── backend 正则的 JS 等价镜像 ──────────────────────────────────────────────
// 源头：backend/app/modules/daemon/router.py:122
//   m = re.search(r'BUILD_ID\s*=\s*["\x27]([^"\x27]+)', text)
// 语义：BUILD_ID → 任意空白（0+）→ 等号 → 任意空白（0+）→ 单或双引号 →
//       捕获组（一个以上非引号字符）。
// JS 正则与 Python re 语义一致（无 re.MULTILINE/re.DOTTY 影响，search 取首个匹配）。
const BACKEND_BUILD_ID_RE = /BUILD_ID\s*=\s*["']([^"']+)/;

// gen 产出 BUILD_ID 合法格式：
//   - 正常：8 位 hex sha + '-' + 14 位 yyyymmddhhmmss（task-01：`--short=8` + formatTimestamp）
//   - fallback：git 缺失 / 非 git 目录 → sha 段为 "unknown"（gen-build-id.mjs:43/48/52）
const BUILD_ID_FORMAT_RE = /^(?:[0-9a-f]{8}|unknown)-\d{14}$/;

// ─── 工具：保存/还原 src/build-id.ts（避免污染源码版控状态）──────────────────
// task-02 已把 src/build-id.ts 加入 .gitignore，但测试仍应做到自清理：
// 还原测试前的内容（哪怕不存在），保证幂等。
let originalContent: string | null = null;
let originallyExisted = false;

function snapshotBuildId() {
  originallyExisted = existsSync(BUILD_ID_FILE);
  originalContent = originallyExisted ? readFileSync(BUILD_ID_FILE, 'utf8') : null;
}

function restoreBuildId() {
  // src/ 目录一定存在（项目结构），无需重建
  if (!existsSync(dirname(BUILD_ID_FILE))) {
    mkdirSync(dirname(BUILD_ID_FILE), { recursive: true });
  }
  if (originallyExisted && originalContent !== null) {
    writeFileSync(BUILD_ID_FILE, originalContent, 'utf8');
  } else if (!originallyExisted) {
    // 测试前不存在 → 还原成「不存在」（写一个 gen 占位产物让 src/ 不空，
    // 但本分支仅在不寻常环境触发，正常 worktree 必有 build-id.ts）
    // 实际上为了不破坏后续 pnpm prebuild/postinstall，留 gen 最新产出即可，
    // 此处不删除文件，仅保证内容为 gen 最新写出的（已在 snapshot 后被 gen 覆盖）。
  }
}

// ─── 工具：同步执行 gen-build-id.mjs ──────────────────────────────────────────
// 跨平台：直接用 `node <脚本>`，不依赖 bash。cwd 设为 sillyhub-daemon（与
// package.json prebuild/postinstall 调用环境一致）。gen 脚本内部用
// import.meta.dirname 解析输出路径，不依赖 cwd，但保持一致避免歧义。
function runGenBuildId() {
  const result = spawnSync(process.execPath, [GEN_SCRIPT], {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result;
}

describe('gen-build-id output format (R-04 self-update 链路守护)', () => {
  // 每个用例前后都做快照/还原，确保用例间互不污染、不污染源码版控状态。
  afterEach(() => {
    restoreBuildId();
  });

  // ── 主用例：真实跑 gen → backend 正则提取 → 格式校验 ──────────────────────
  it('真实执行 gen-build-id.mjs → 产出 build-id.ts 能被 backend 正则提取合法 BUILD_ID', () => {
    snapshotBuildId();

    // 先删掉现有 build-id.ts，确保下面的文件是本次 gen 真实写出的，而非遗留产物。
    // （否则 gen 脚本若被误删/改坏，旧 build-id.ts 仍在会让测试假绿）
    if (existsSync(BUILD_ID_FILE)) {
      rmSync(BUILD_ID_FILE, { force: true });
    }
    expect(existsSync(BUILD_ID_FILE), '前置：删除后 build-id.ts 应不存在').toBe(false);

    const result = runGenBuildId();

    // gen 脚本设计上始终退出码 0（git 失败也 fallback，不抛异常）。
    // 这里硬断言 status===0：gen 脚本若被误改坏 / 不存在，必须明确暴露，
    // 不靠下面「文件存在性」间接推断（间接推断会被遗留 build-id.ts 掩盖，故前面已删）。
    expect(
      result.status,
      `gen-build-id.mjs 必须退出码 0（实际 ${result.status}，stderr: ${result.stderr}）`,
    ).toBe(0);

    // 1) gen 必须写出 src/build-id.ts
    expect(existsSync(BUILD_ID_FILE), 'gen-build-id.mjs 必须写出 src/build-id.ts').toBe(true);

    const content = readFileSync(BUILD_ID_FILE, 'utf8');

    // 2) 用 backend router.py:122 正则的 JS 等价镜像提取
    const m = BACKEND_BUILD_ID_RE.exec(content);
    if (!m) {
      // 捕获组为空时打印实际内容与正则，便于定位是 gen 输出漂移还是正则写错
      // eslint-disable-next-line no-console
      console.error('[gen-build-id] backend 正则未命中，实际 build-id.ts 内容:\n', content);
    }
    expect(m, 'backend 正则必须从 gen 产出提取到 BUILD_ID 捕获组').not.toBeNull();
    const captured = m![1];
    expect(captured, 'BUILD_ID 捕获组不能为空').toBeTruthy();

    // 3) 提取值格式合法：<8位hex>-<14位数字> 或 unknown 前缀
    // captured 经上一行 toBeTruthy 断言运行时非空，但 TS 不跨 expect() 收窄，故显式断言。
    expect(
      BUILD_ID_FORMAT_RE.test(captured!),
      `BUILD_ID 格式非法（期望 <8位hex>-<14位数字> 或 unknown-<14位数字>，实际: ${captured})`,
    ).toBe(true);
  });

  // ── 关键回归点：export 行【无 `: string` 类型注解】──────────────────────────
  // task-01 gen-build-id.mjs 注释明确：「正则 \s* 不吃冒号 → 不能带 `: string` 注解」。
  // backend router.py:122 的 \s* 只匹配空白，一旦 gen 漂移成
  //   `export const BUILD_ID: string = "..."`
  // backend 正则 `BUILD_ID\s*=` 会卡在冒号上失配 → self-update 提取 BUILD_ID 失败 →
  // 整条 self-update 链路断（R-04）。本断言必须单独存在，提前拦截这种漂移。
  it('关键回归点：gen 产出 export 行无 `: string` 类型注解（backend 正则 \\s* 不吃冒号）', () => {
    snapshotBuildId();

    runGenBuildId();
    expect(existsSync(BUILD_ID_FILE), 'src/build-id.ts 必须存在').toBe(true);

    const content = readFileSync(BUILD_ID_FILE, 'utf8');

    // 找到 export const BUILD_ID 那一行（首行是 AUTO-GENERATED 注释，次行是 export）
    const exportLine = content
      .split('\n')
      .find((l) => /export\s+const\s+BUILD_ID/.test(l));
    expect(exportLine, '必须存在 export const BUILD_ID 行').toBeTruthy();

    // 核心断言：BUILD_ID 标识符与等号之间不能出现冒号（即无 `: string` 注解）
    expect(
      exportLine!,
      'export 行不能带 `: string` 类型注解（否则 backend 正则 \\s* 卡在冒号失配）',
    ).not.toMatch(/BUILD_ID\s*:/);

    // 进一步锁定合法形态：`BUILD_ID` → 等号 → 引号字面量
    // 即 `BUILD_ID = "..."` 或 `BUILD_ID = '...'`，冒号不得出现
    expect(exportLine!).toMatch(/^export\s+const\s+BUILD_ID\s*=\s*["']/);
  });

  // ── 反向敏感性验证（task-05 verify）：故意写成带注解 → backend 正则失配 ──
  // 不真实跑 gen（gen 不会产出带注解的格式），直接拿一段伪造的「漂移产物」
  // 喂给 backend 正则镜像，证明正则对 `: string` 注解敏感（即「如果 gen 漂移成这样，
  // 提取会失败」）—— 验证正则本身有敏感性，回归测试不是「永远绿」的空壳。
  it('敏感性自检：漂移成 `BUILD_ID: string = "..."` 时 backend 正则必须失配', () => {
    const drifted = '// AUTO-GENERATED\nexport const BUILD_ID: string = "abc12345-20260804120000";\n';
    const m = BACKEND_BUILD_ID_RE.exec(drifted);
    expect(m, '带 `: string` 注解的漂移产物不应被 backend 正则提取').toBeNull();
  });

  // ── 双引号 / 单引号都被正则接受（正则源头语义）──────────────────────────────
  // backend 正则 `["\x27]` 即匹配单或双引号。gen 实际产出固定双引号，但正则语义
  // 接受两者。本用例固化正则语义，防止有人「优化」正则只支持双引号而悄悄破坏兼容。
  it('正则语义：单引号包裹的 BUILD_ID 也能被提取（gen 实际产双引号，正则兼容两者）', () => {
    const single = "export const BUILD_ID = 'abc12345-20260804120000';\n";
    const m = BACKEND_BUILD_ID_RE.exec(single);
    expect(m, '单引号包裹也应被 backend 正则提取').not.toBeNull();
    expect(m![1]).toBe('abc12345-20260804120000');
  });

  // ── 失败可观测性：gen 产出异常时测试提供足够诊断信息 ─────────────────────────
  // 不是断言 gen 行为，而是固化「测试自身的可观测性」：当 gen 输出漂移导致失配，
  // 测试日志必须能还原现场（实际内容 + 正则结果）。这里用一个伪造的非 export 产物，
  // 确保 backend 正则对「没有 BUILD_ID 字面量」的内容返回 null（不假绿）。
  it('反例：内容不含 BUILD_ID → backend 正则返回 null（不假绿）', () => {
    const noop = '// some other generated file\nexport const OTHER = "value";\n';
    const m = BACKEND_BUILD_ID_RE.exec(noop);
    expect(m).toBeNull();
  });
});
