// gen-provider-caps.mjs —— caps 三端单源生成脚本（零依赖 Node，2026-09-11-
// provider-adapter-registry task-04 / design Wave 3 / FR-04 / D-002@v1）。
//
// 从 daemon 单源 sillyhub-daemon/src/interactive/providers.ts 的 PROVIDER_CAPS
// 静态解析能力矩阵，生成两份 @generated 产物（三端手抄镜像退役）：
//
// - frontend/src/lib/provider-caps.ts（ProviderCaps 接口 + PROVIDER_CAPS 表 +
//   getProviderCaps 默认拒绝 + PROVIDER_SWITCH_ENGINES 派生白名单）；
// - backend/app/modules/agent/provider_caps.py（同值 dict + get_provider_caps
//   默认拒绝 fallback）。
//
// 解析方式（零新依赖——daemon 无 tsx 且 dist 依赖构建，不 import TS 模块；
// 先例 = backend 对齐测试 test_provider_caps_alignment.py 的源文件读取式）：
// 剥注释 → 花括号配平提取 `export const PROVIDER_CAPS` 对象字面量体 →
// 逐引擎子块提取键值对（boolean 裸字面量 true/false + dialog 三值带引号
// 字符串 'native'/'marker'/'none'）。
//
// 响亮失败守卫（R-02）：解析结果必须恰含四引擎（claude/codex/pi/cursor）且
// 每键恰 10 个 caps 键；任一不符即 stderr 打印差异明细并 exit 1，**不写任何
// 产物**（值形态写错——如裸 true 误写成字符串——同样以「缺少 caps 键」暴露）。
//
// 幂等：固定引擎序/键序/缩进/引号风格，重跑输出逐字节一致（frontend
// gen:types:check 的 git diff 守护与对齐测试的前提）。
//
// 用法（仓库任意位置均可，产物路径相对本脚本定位）::
//
//     node sillyhub-daemon/scripts/gen-provider-caps.mjs
//     # 或 cd frontend && pnpm gen:types（本脚本已挂 gen:types 链尾）

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const daemonTablePath = resolve(here, "..", "src", "interactive", "providers.ts");
const frontendOutPath = resolve(
  here,
  "..",
  "..",
  "frontend",
  "src",
  "lib",
  "provider-caps.ts",
);
const backendOutPath = resolve(
  here,
  "..",
  "..",
  "backend",
  "app",
  "modules",
  "agent",
  "provider_caps.py",
);

// 契约常量（与 daemon 单源 ProviderCaps 接口一致；新引擎/新键接入时同步这里，
// 守卫会强制单源与本清单一致，不同步即响亮失败）。
const ENGINES = ["claude", "codex", "pi", "cursor"];
const CAPS_KEYS = [
  "resume",
  "mcp",
  "multimodal",
  "thinking",
  "subagent",
  "permission_dialog",
  "dialog",
  "edit_patch",
  "model_select",
  "provider_switch",
];

// ── 解析（backend 对齐测试 _extract_ts_const_object_body / _TS_BOOL_PAIR_RE
//    同款思路的 JS 移植）──────────────────────────────────────────────────────

/** 剥离 /* ... *\/ 块注释与 // 行注释（取值依据锚点写在注释里，不参与解析）。 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

function fail(message) {
  console.error(`[gen-provider-caps] ❌ ${message}`);
  process.exit(1);
}

/** 提取 `export const <constName> ... = { ... }` 对象字面量正文（花括号配平）。 */
function extractConstObjectBody(text, constName) {
  const opener = new RegExp(`export\\s+const\\s+${constName}\\b[^=]*=\\s*\\{`).exec(
    text,
  );
  if (opener === null) {
    fail(
      `未找到 \`export const ${constName}\` 声明（表格式漂移，检查单源或本脚本解析器）`,
    );
  }
  const start = opener.index + opener[0].length;
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
    }
    i += 1;
  }
  if (depth !== 0) {
    fail(`常量 ${constName} 对象字面量花括号不配平`);
  }
  return text.slice(start, i - 1);
}

// 引擎子块（`claude: { ... }`，块内无嵌套花括号——caps 值均为标量）。
const ENGINE_BLOCK_RE = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{([^{}]*)\}/g;
// 块内键值对：boolean 裸字面量，或 dialog 三值带引号字符串（写错值形态即
// 匹配不到，由守卫以「缺少 caps 键」响亮暴露，不会静默通过）。
const PAIR_RE =
  /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:(true|false)\b|'(native|marker|none)')/g;

/** 解析 PROVIDER_CAPS 字面量体为 Map<engine, Map<key, boolean|string>>。 */
function parseCapsTable(body) {
  const table = new Map();
  for (const block of body.matchAll(ENGINE_BLOCK_RE)) {
    const values = new Map();
    for (const pair of block[2].matchAll(PAIR_RE)) {
      if (pair[3] !== undefined) {
        values.set(pair[1], pair[3]);
      } else {
        values.set(pair[1], pair[2] === "true");
      }
    }
    table.set(block[1], values);
  }
  return table;
}

// ── 响亮失败守卫（R-02）：恰四引擎 × 每键恰 10 caps 键 ────────────────────────

function guardTable(table) {
  const errors = [];
  const engineSet = new Set(ENGINES);
  const parsedEngines = new Set(table.keys());
  const missingEngines = ENGINES.filter((engine) => !parsedEngines.has(engine));
  const extraEngines = [...parsedEngines].filter(
    (engine) => !engineSet.has(engine),
  );
  if (missingEngines.length > 0) {
    errors.push(
      `缺少引擎键: ${missingEngines.join(", ")}（单源 ${daemonTablePath}；表格式漂移或解析器失配）`,
    );
  }
  if (extraEngines.length > 0) {
    errors.push(
      `多出引擎键: ${extraEngines.join(", ")}（新引擎接入须同步本脚本 ENGINES 与两端模板）`,
    );
  }
  const capsKeySet = new Set(CAPS_KEYS);
  for (const engine of ENGINES) {
    const values = table.get(engine);
    if (values === undefined) {
      continue; // 缺引擎已报，不重复。
    }
    const missingKeys = CAPS_KEYS.filter((key) => !values.has(key));
    const extraKeys = [...values.keys()].filter(
      (key) => !capsKeySet.has(key),
    );
    if (missingKeys.length > 0) {
      errors.push(
        `${engine} 缺少 caps 键: ${missingKeys.join(", ")}（值形态须为裸 true/false 或 dialog 三值带引号字符串，否则解析不到）`,
      );
    }
    if (extraKeys.length > 0) {
      errors.push(
        `${engine} 多出 caps 键: ${extraKeys.join(", ")}（新键接入须同步本脚本 CAPS_KEYS 与两端模板）`,
      );
    }
  }
  return errors;
}

// ── 渲染（固定键序/缩进/引号风格——幂等前提）─────────────────────────────────

function tsValue(value) {
  return typeof value === "string" ? `'${value}'` : String(value);
}

function renderFrontend(table) {
  const engineBlocks = ENGINES.map((engine) => {
    const values = table.get(engine);
    const pairs = CAPS_KEYS.map(
      (key) => `    ${key}: ${tsValue(values.get(key))},`,
    );
    return [`  ${engine}: {`, ...pairs, "  },"].join("\n");
  }).join("\n");
  return `/**
 * provider 能力矩阵（ProviderCaps）前端表 —— **本文件为生成产物，勿手改**。
 *
 * @generated 由 sillyhub-daemon/scripts/gen-provider-caps.mjs 生成；唯一维护源 =
 * sillyhub-daemon/src/interactive/providers.ts 的 PROVIDER_CAPS（取值依据锚点
 * 注释在单源侧）。重跑生成：node sillyhub-daemon/scripts/gen-provider-caps.mjs
 * （frontend \`pnpm gen:types\` 链尾已自动执行）。
 *
 * 镜像约定（三端同步，单源 = daemon 侧，2026-09-11-provider-adapter-registry
 * task-04 起手抄镜像退役）：daemon 单源改取值后重跑生成脚本，本文件与 backend
 * app/modules/agent/provider_caps.py 随脚本一并刷新；三端键集合（10 键：
 * 9 个 boolean + dialog string 枚举）与每个 provider 每键取值一致性由
 * backend/app/modules/agent/tests/test_provider_caps_alignment.py 以源文件
 * 读取方式守护（任一端漂移即测试失败）。
 *
 * 取值语义：caps 描述 provider 当前真实能力，9 个 boolean 键缺省 false 默认
 * 拒绝（FR-06 / D-002@v1）；dialog 为 string 枚举键（'native' = 走平台
 * dialog 管道 / 'marker' = 纯前端标记协议 / 'none' = 无通道）；未知 provider
 * 查询返回默认拒绝对象（boolean 键全 false、dialog 取 'none'），不抛错。
 */

/** provider 能力矩阵（10 键：9 个 boolean + dialog string 枚举，缺省默认拒绝）。 */
export interface ProviderCaps {
  /** 会话恢复（Claude SDK session_id / Codex threadId）。 */
  resume: boolean;
  /** MCP server 注入（driver 实际消费 mcpServers 配置并生效）。 */
  mcp: boolean;
  /** 多模态（会话附件：图片 / 文件注入）。 */
  multimodal: boolean;
  /** 思考流（thinking 事件缓冲与渲染）。 */
  thinking: boolean;
  /** 子代理（团队派工 / Task 分身链路）。 */
  subagent: boolean;
  /** 远程人审对话框（permission dialog / user dialog 桥）。 */
  permission_dialog: boolean;
  /**
   * 向用户提问的对话框通道形态（string 枚举；FR-06，
   * 2026-09-09-askuser-pi-cursor task-12 加入）：'native' = 走平台 dialog
   * 管道（permission_dialog 桥，pending 行 + 答题端点）；'marker' = 纯前端
   * 标记协议（消息尾部 askuser fenced 块，不经后端 dialog 管道）；'none' =
   * 无通道（未知 provider 回退值）。
   */
  dialog: 'native' | 'marker' | 'none';
  /** Edit 工具 structuredPatch（差异渲染数据源）。 */
  edit_patch: boolean;
  /** 模型选择（创建会话时的模型覆盖生效）。 */
  model_select: boolean;
  /** 会话级供应商切换支持（第 10 键，与 daemon 单源 adapter.switchable 同源）。 */
  provider_switch: boolean;
}

/**
 * 各 provider 能力取值（生成自 daemon 单源；取值依据锚点见
 * sillyhub-daemon/src/interactive/providers.ts 的 PROVIDER_CAPS docblock）。
 */
export const PROVIDER_CAPS: Record<string, ProviderCaps> = {
${engineBlocks}
};

/**
 * 查询 provider 能力；未知 provider 返回默认拒绝对象，不抛错。
 *
 * 返回已知 provider 的表内对象（调用方只读，勿就地修改——表是模块级共享态）；
 * 未知 provider 每次返回新的默认拒绝字面量（boolean 键全 false、dialog 取
 * 'none'，R-09）。
 */
export function getProviderCaps(provider: string): ProviderCaps {
  const caps = PROVIDER_CAPS[provider];
  if (caps !== undefined) {
    return caps;
  }
  return {
    resume: false,
    mcp: false,
    multimodal: false,
    thinking: false,
    subagent: false,
    permission_dialog: false,
    dialog: 'none',
    edit_patch: false,
    model_select: false,
    provider_switch: false,
  };
}

/**
 * 会话级供应商切换已解锁的引擎白名单（FR-03；task-04 起随本文件生成——从
 * PROVIDER_CAPS 按 provider_switch === true 派生，不再手抄白名单，取值随
 * daemon 单源）。消费方两处门禁：SessionConfigBar 的 providerLocked（配置条
 * 供应商下拉锁定）与 session-panel 错误卡 timelineOnSwitchProvider——白名单
 * 外引擎（cursor / 未知）仍锁，提示用引擎中性文案「当前引擎不支持会话级
 * 供应商切换」。
 */
export const PROVIDER_SWITCH_ENGINES: ReadonlySet<string> = new Set(Object.entries(PROVIDER_CAPS).filter(([,c]) => c.provider_switch).map(([k]) => k));
`;
}

function pyValue(value) {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  return value ? "True" : "False";
}

function renderBackend(table) {
  const engineBlocks = ENGINES.map((engine) => {
    const values = table.get(engine);
    const pairs = CAPS_KEYS.map(
      (key) => `        "${key}": ${pyValue(values.get(key))},`,
    );
    return [`    "${engine}": {`, ...pairs, "    },"].join("\n");
  }).join("\n");
  return `# @generated 由 sillyhub-daemon/scripts/gen-provider-caps.mjs 生成，勿手改；
# 唯一维护源 = sillyhub-daemon/src/interactive/providers.ts 的 PROVIDER_CAPS。
# 重跑生成：node sillyhub-daemon/scripts/gen-provider-caps.mjs（frontend
# \`pnpm gen:types\` 链尾已自动执行）。
"""provider 能力矩阵（ProviderCaps）Python 镜像表（生成产物）。

镜像约定（三端同步，单源 = daemon 侧，2026-09-11-provider-adapter-registry
task-04 起手抄镜像退役）：

- 唯一维护源是 \`\`sillyhub-daemon/src/interactive/providers.ts\`\` 的
  \`\`PROVIDER_CAPS\`\`（含取值依据的文件:行号锚点注释，改值先改那里）；
- 本文件与 \`\`frontend/src/lib/provider-caps.ts\`\` 均为脚本生成产物，daemon
  单源改值后重跑 \`\`sillyhub-daemon/scripts/gen-provider-caps.mjs\`\` 三端一并
  刷新，三端键集合（10 键：9 个 boolean + dialog string 枚举）与每个
  provider 每键取值必须一致；
- 一致性由 \`\`app/modules/agent/tests/test_provider_caps_alignment.py\`\` 以
  源文件读取方式守护（直接读 daemon / frontend 表源比对，不复制值断言），
  任一端漂移即测试失败；
- 查询语义：未知 provider 返回默认拒绝新 dict（boolean 键全 False、dialog
  string 枚举取 \`\`"none"\`\`，缺省 false 默认拒绝，FR-06 / D-002@v1），不抛错。
"""

from __future__ import annotations

PROVIDER_CAPS: dict[str, dict[str, bool | str]] = {
    # 取值依据锚点见 daemon 侧 sillyhub-daemon/src/interactive/providers.ts
    # 的 PROVIDER_CAPS docblock。
${engineBlocks}
}

# 键序取自镜像表首条目（claude）；10 键齐全与三端一致性由守护测试保证。
_CAPS_KEYS: tuple[str, ...] = tuple(next(iter(PROVIDER_CAPS.values())))


def get_provider_caps(provider: str) -> dict[str, bool | str]:
    """查询 provider 能力矩阵。

    Args:
        provider: provider 标识（detector key，如 \`\`"claude"\`\` / \`\`"codex"\`\`）。

    Returns:
        dict[str, bool | str]: 已知 provider 返回表内条目的**副本**（调用方可安全
        修改，不污染模块级共享表）；未知 provider 返回默认拒绝新 dict（boolean
        键全 False、dialog string 枚举取 \`\`"none"\`\`，10 键齐全，FR-06），不抛错。
    """
    caps = PROVIDER_CAPS.get(provider)
    if caps is not None:
        return dict(caps)
    # 未知 provider 默认拒绝：boolean 键全 False，dialog string 枚举回退 'none'。
    return {key: ("none" if key == "dialog" else False) for key in _CAPS_KEYS}
`;
}

// ── 主流程：读单源 → 解析 → 守卫（失败零写盘）→ 双产物写盘 ───────────────────

if (!existsSync(daemonTablePath)) {
  fail(`单源文件缺失: ${daemonTablePath}`);
}
const sourceText = stripComments(readFileSync(daemonTablePath, "utf8"));
const table = parseCapsTable(extractConstObjectBody(sourceText, "PROVIDER_CAPS"));
const guardErrors = guardTable(table);
if (guardErrors.length > 0) {
  console.error(
    `[gen-provider-caps] ❌ 守卫失败（解析自 ${daemonTablePath}），不写任何产物：`,
  );
  for (const error of guardErrors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

writeFileSync(frontendOutPath, renderFrontend(table), "utf8");
writeFileSync(backendOutPath, renderBackend(table), "utf8");
console.log(`[gen-provider-caps] done: ${frontendOutPath}`);
console.log(`[gen-provider-caps] done: ${backendOutPath}`);
