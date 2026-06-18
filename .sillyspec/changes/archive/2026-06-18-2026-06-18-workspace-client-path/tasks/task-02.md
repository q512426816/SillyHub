---
author: qinyi
created_at: 2026-06-18 11:44:49
change: 2026-06-18-workspace-client-path
id: task-02
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/config.ts
---

# Task-02 — DaemonConfig 加 `allowed_roots`

## 1. 任务概述

为 `sillyhub-daemon` 的配置结构 `DaemonConfig` 增加 `allowed_roots: string[]` 字段，作为 task-05 `list_dir` RPC handler 的白名单数据源：前端树形浏览（FR-03）请求的路径必须落在某个 `allowed_root` 之下，越界按 D-002@v1 返回 `forbidden`。

本任务只动配置层（interface + DEFAULT + load/save），**不**实现校验逻辑本身（那是 task-05 `file-rpc.ts` 的职责）；本任务确保配置文件读/写/默认值/向后兼容正确，供下游消费。

## 2. 修改文件清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/config.ts` | `DaemonConfig` interface 加 `allowed_roots: string[]`；`DEFAULT_CONFIG` 加默认值 `[homedir()]`；`loadConfig` 兜底向后兼容；`saveConfig` 无需改（透传序列化） |

唯一修改文件：`sillyhub-daemon/src/config.ts`（`allowed_paths` 严格限定）。测试文件（如已存在 `config.test.ts`）需相应更新，但不在本任务 `allowed_paths` 内——若仓库存在 `sillyhub-daemon/src/config.test.ts` 则按 §7 TDD 同步改测试用例；若不存在则在本任务范围外（由测试规范单独管理）。

## 3. 覆盖来源

| 来源 ID | 类型 | 摘要 | 本任务如何落实 |
|---|---|---|---|
| FR-04 | 功能需求 | list_dir allowed_roots 白名单：未显式配置时默认 `[homedir]`，首次受限提示配置位置 | §4 实现：`DEFAULT_CONFIG.allowed_roots = [homedir()]`；§5 loadConfig 保证旧 config.json 缺字段时回填默认 |
| D-002@v1 | 决策 | daemon config.json 新增 `allowed_roots: string[]`；list_dir 校验 path 必须在某 root 下，越界 forbidden | 本任务只负责字段 + 默认值 + 持久化；forbidden 判定在 task-05 |
| design §6 | 文件清单 | `sillyhub-daemon/src/config.ts`：DaemonConfig 加 allowed_roots（默认 `[homedir]`） | §4/§5/§6 |
| design §7.3 | 数据结构 | `interface DaemonConfig { /* 现有... */ allowed_roots: string[]; }` | §5 interface 定义 |

## 4. 实现要求

### 4.1 高层目标
1. `DaemonConfig` 接口新增 `allowed_roots: string[]` 字段。
2. 默认值：`[os.homedir()]`（单元素数组，绝对路径，与现有 `workspace_dir` 用同一个 `homedir()` 来源对齐）。
3. 旧 config.json（无此字段）→ loadConfig 自动回填默认值，保持向后兼容（brownfield）。
4. saveConfig 序列化新字段（无需改动逻辑，因 `JSON.stringify(config)` 已覆盖所有字段；但需确认行为不变）。
5. 不引入循环依赖、不动 import（`homedir` 已在文件顶部 import）。
6. 字段类型严格 `string[]`（非 `string[] | null`，默认值非空，避免下游判空负担）。

### 4.2 文档同步
- interface 字段 JSDoc 注释：用途、默认值、被谁消费（task-05 list_dir）、D-002 引用。
- DEFAULT_CONFIG 对应行加注释：对齐 FR-04 / D-002。
- 顶部模块注释无需改（模块用途不变）。

## 5. 接口定义（含伪代码）

### 5.1 DaemonConfig interface 改动

在 `sillyhub-daemon/src/config.ts` 现有 `export interface DaemonConfig { ... }` 末尾新增字段：

```ts
export interface DaemonConfig {
  /* ...现有所有字段保持不变（server_url / token / api_key / runtime_id /
     profile / workspace_dir / poll_interval / heartbeat_interval /
     max_concurrent_tasks / log_level / default_timeout_seconds / max_retries /
     terminal_observer_enabled / lease_heartbeat_interval /
     terminal_observer_mode / terminal_observer_close_on_exit /
     terminal_observer_command）... */

  /**
   * list_dir RPC 允许浏览的根目录白名单（绝对路径数组）。
   *
   * 用途（FR-04 / D-002@v1）：前端树形目录浏览请求的 path 必须落在
   * 某个 allowed_root 之下（含 root 本身），越界由 task-05 file-rpc.ts
   * 返回 error.code='forbidden'。
   *
   * 默认 `[os.homedir()]`：未显式配置时仅允许浏览用户家目录。
   * 用户可在 ~/.sillyhub/daemon/config.json 中追加项目目录扩展范围。
   *
   * 元素约定：
   *   - 必须为绝对路径（loadConfig 已做规范化，见 §6）。
   *   - 允许重复项（loadConfig 去重，见 §6）。
   *   - 大小写：Windows 下盘符保留原样（'C:\\Users\\...'），规范化不做大小写归一
   *     （由 task-05 比较时按平台决定是否 case-insensitive）。
   *
   * 字段非 nullable：默认值恒为非空数组（含 homedir），下游消费无需 null 检查。
   */
  allowed_roots: string[];
}
```

### 5.2 DEFAULT_CONFIG 改动

在 `sillyhub-daemon/src/config.ts` 现有 `Object.freeze({ ... })` 内追加：

```ts
export const DEFAULT_CONFIG: Readonly<DaemonConfig> = Object.freeze({
  /* ...现有字段不变... */

  // FR-04 / D-002@v1：list_dir 白名单根目录，默认仅允许浏览用户家目录。
  // 注：用 [homedir()] 而非 homedir() —— 字段类型是数组。
  // 不在此处做 path.resolve（homedir() 已返回绝对路径），规范化在 loadConfig。
  allowed_roots: [homedir()],
});
```

### 5.3 loadConfig 改动（向后兼容 + 规范化 + 去重）

在现有 `loadConfig` 函数 step 2（`Object.assign(data, saved)`）之后、step 3（runtime_id 自动生成）之前，插入 `allowed_roots` 兜底与规范化逻辑：

```ts
export async function loadConfig(
  path: string = DEFAULT_CONFIG_PATH,
): Promise<DaemonConfig> {
  const data: DaemonConfig = { ...DEFAULT_CONFIG };

  if (existsSync(path)) {
    const raw = await readFile(path, 'utf-8');
    const saved = JSON.parse(raw) as Partial<DaemonConfig>;
    Object.assign(data, saved);
  }

  // ── 新增：allowed_roots 向后兼容 + 规范化（FR-04 / D-002@v1）──
  data.allowed_roots = normalizeAllowedRoots(data.allowed_roots);
  // 若规范化后发生变化（如旧 config.json 缺字段被补默认、或路径被 resolve/去重），
  // 不立即落盘——与 runtime_id 自动生成那一路径不同，避免每次启动都写盘。
  // 仅当用户显式 saveConfig 时才持久化规范化结果。

  // step 3（现有）：runtime_id 自动生成 + 落盘（不变）
  if (!data.runtime_id) {
    data.runtime_id = randomUUID();
    await saveConfig(data, path);
  }

  return data;
}

/**
 * 规范化 allowed_roots：处理缺字段/非数组/相对路径/重复项/Windows 路径。
 * 见 §6 边界处理 B1~B6。
 *
 * @param raw 从 JSON 合并后的原始值（可能 undefined / 非数组 / 含相对路径）。
 * @returns 规范化后的非空绝对路径数组（去重保序）。
 */
function normalizeAllowedRoots(raw: unknown): string[] {
  // B1 缺字段 / 非数组 / 空数组 → 回填默认 [homedir()]
  if (!Array.isArray(raw) || raw.length === 0) {
    return [homedir()];
  }

  // B4 相对路径 → 绝对路径（path.resolve 基于 process.cwd()）
  // B5 Windows 路径：path.resolve 在 win32 自动处理反斜杠/盘符，无需特殊分支
  const resolved = (raw as unknown[])
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((p) => path.resolve(p));

  // B1 过滤后为空（如配置成 [null, 123]）→ 回填默认
  if (resolved.length === 0) {
    return [homedir()];
  }

  // B6 去重（保序，首次出现优先；不归一大小写——交由 task-05 比较层处理）
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const p of resolved) {
    if (!seen.has(p)) {
      seen.add(p);
      deduped.push(p);
    }
  }
  return deduped;
}
```

需要在文件顶部 import 增加 `path`（当前仅 import 了 `join`、`dirname`，需补 `resolve`）：

```ts
import { join, dirname, resolve as pathResolve } from 'node:path';
// 或保持现有写法：import { join, dirname } from 'node:path'; → 改为
import { join, dirname, resolve } from 'node:path';
// 伪代码中用 path.resolve，实际可改为直接 resolve(...) 以避免与 node:path 命名冲突。
```

### 5.4 saveConfig 改动

**无需改动**。现有实现 `JSON.stringify(config, null, 2)` 已自动序列化 `allowed_roots` 字段（数组在 JSON 中原生支持）。

需验证（在测试覆盖）：保存后重新 loadConfig 往返一致（round-trip）。

## 6. 边界处理（≥5 条）

| 编号 | 边界场景 | 输入示例 | 期望行为 | 实现位置 |
|---|---|---|---|---|
| B1 | 空 / 缺字段 / 非数组 | config.json 无 `allowed_roots` 字段；或 `null`；或 `"allowed_roots": []`；或 `"allowed_roots": "not-array"` | loadConfig 回填默认 `[homedir()]`；不报错；返回的 config 一定有合法非空数组 | `normalizeAllowedRoots` B1 分支 |
| B2 | 旧 config.json（brownfield，无此字段） | 现有用户已有的 config.json | `Object.assign(data, saved)` 后 `data.allowed_roots` 仍是 DEFAULT 的 `[homedir()]`（saved 没这键不覆盖）；再过一遍 normalize 等幂等。**向后兼容零行为变化** | loadConfig step 2 + normalize |
| B3 | 绝对路径规范化（含 `..` / `.`） | `"allowed_roots": ["~/projects/../shared"]`（注意：`~` 不展开，见 B3-注） | `path.resolve` 把 `..`/`.` 折叠为绝对路径；`~` 不展开（Node `path.resolve` 不识别 `~`，需用户写真实路径或文档提示） | `normalizeAllowedRoots` B4 |
| B4 | 相对路径（基于 process.cwd()） | `"allowed_roots": ["./repos"]` | `path.resolve("./repos")` → `<cwd>/repos`；落盘为绝对路径。**风险**：cwd 跨启动可能不同，建议文档提示「请配绝对路径」，但代码不强制（YAGNI） | `normalizeAllowedRoots` B4 |
| B5 | Windows 路径混合分隔符 / 大小写 | `"C:\\Users\\qinyi"` / `"C:/Users/Qinyi"` / `"c:\\users\\qinyi"` | `path.resolve` 在 win32 统一为反斜杠绝对路径；**不归一大小写**（Windows 文件系统不区分大小写，但字符串比较区分；交由 task-05 比较时按平台决定 case-insensitive） | `normalizeAllowedRoots` B4/B6 |
| B6 | 重复项 | `"allowed_roots": ["/home/a", "/home/a", "/home/b"]` | 去重保序 → `["/home/a", "/home/b"]`；`Set` 首次出现优先 | `normalizeAllowedRoots` B6 |
| B7 | 非字符串元素（脏数据） | `"allowed_roots": ["/home/a", null, 123, ""]` | filter 掉非 string / 空串 → `["/home/a"]`；若过滤后空 → 回填默认 `[homedir()]`（B1 兜底） | `normalizeAllowedRoots` filter + B1 |
| B8 | round-trip 一致性 | save → load → save | 第二次 save 的字节与第一次一致（规范化幂等：resolve+去重对已是规范的输入无副作用） | saveConfig + 测试 |

**B3-注（`~` 不展开）**：Node.js `path.resolve` 不识别 shell 风格 `~`。若用户在 config.json 写 `"~/projects"`，会被 resolve 成 `<cwd>/~/projects`（错误目录）。**本任务不展开 `~`**（YAGNI；用户应直接写绝对路径，DEFAULT 已示范用 `homedir()`）；若未来需要，可作为独立增强。需在字段 JSDoc 明确提示。

## 7. TDD（测试用例）

遵循 CLAUDE.md 执行顺序「写测试 → 写实现」。测试文件 `sillyhub-daemon/src/config.test.ts`（若不存在则新建，但新建测试文件不在本任务 `allowed_paths` 内——需与项目测试规范确认；本节给出用例规格供执行阶段落地）。

| 用例 ID | 场景 | 输入 | 期望 | 对应边界 |
|---|---|---|---|---|
| T1 | 默认值（无 config.json） | loadConfig 指向不存在文件 | `config.allowed_roots` 深度等于 `[homedir()]` | B1/B2 |
| T2 | 旧 config.json 无此字段 | `{...现有字段}` 不含 allowed_roots | 回填 `[homedir()]` | B2 |
| T3 | 显式配置透传 | `{allowed_roots: ["/a","/b"]}` | `["/a","/b"]`（resolve 后绝对路径） | B3 |
| T4 | 相对路径规范化 | `{allowed_roots: ["./x"]}`（cwd=/tmp） | `["/tmp/x"]` | B4 |
| T5 | Windows 路径分隔符统一（仅 win32 跑） | `{allowed_roots: ["C:/Users/q"]}` | `["C:\\Users\\q"]`（win32） | B5 |
| T6 | 去重保序 | `{allowed_roots: ["/a","/a","/b"]}` | `["/a","/b"]` | B6 |
| T7 | 非字符串过滤 | `{allowed_roots: ["/a",null,123,""]}` | `["/a"]` | B7 |
| T8 | 全脏数据回填默认 | `{allowed_roots: [null,"",42]}` | `[homedir()]` | B1/B7 |
| T9 | round-trip 一致 | save(显式) → load → save | 两次 save 文件字节一致 | B8 |
| T10 | DEFAULT_CONFIG 不可变（freeze 保护） | 尝试 `DEFAULT_CONFIG.allowed_roots.push("/x")` | 抛 TypeError（严格模式） | 防污染 |
| T11 | loadConfig 不因规范化而每次落盘 | 旧 config.json 缺字段 → loadConfig | 文件 mtime 不变（区别于 runtime_id 自动生成那条路径） | §5.3 设计取舍 |

TDD 顺序：T1/T2（最常见 brownfield）先行 → 驱动 interface + DEFAULT 落地 → T3~T8 驱动 normalize 函数 → T9/T11 驱动幂等性 → T10 是既有 freeze 的回归。

## 8. 验收标准（对照需求/决策）

| 验收点 | 来源 | 验证方式 | 通过条件 |
|---|---|---|---|
| AC-1 DaemonConfig interface 含 `allowed_roots: string[]` | FR-04 / D-002@v1 / design §7.3 | `tsc --noEmit` 编译 + grep 字段 | 类型检查通过；字段存在且类型为 `string[]` |
| AC-2 DEFAULT_CONFIG.allowed_roots = `[homedir()]` | FR-04「默认 [homedir]」/ D-002@v1 | 单测 T1 | 无 config.json 时返回值首元素等于 `os.homedir()` |
| AC-3 旧 config.json（无此字段）向后兼容 | design §9 兼容策略 / FR-04 | 单测 T2 | 不报错；回填默认；现有字段（token/runtime_id/workspace_dir 等）行为零变化 |
| AC-4 loadConfig 对脏数据健壮（空/非数组/非字符串/相对路径/重复） | 本任务边界处理 | 单测 T3~T8 | 全部通过 |
| AC-5 saveConfig 序列化新字段 + round-trip 一致 | FR-04 持久化 | 单测 T9 | 两次 save 字节一致；load 回来的 allowed_roots 等于 save 前 |
| AC-6 不每次启动落盘（仅 runtime_id 缺失才落盘的既有行为不变） | §5.3 设计取舍 | 单测 T11 | 旧 config.json 缺 allowed_roots 时 loadConfig 不改文件 mtime |
| AC-7 不引入非 allowed_paths 文件改动 | 本任务边界 | `git diff --name-only` | 仅 `sillyhub-daemon/src/config.ts`（+ 可能的 config.test.ts）变更 |
| AC-8 现有 daemon 启动/运行链路无回归 | design §9 | 手动启动 daemon + 一次心跳 | 启动正常；config 加载无异常；现有功能不报错 |
| AC-9 task-05 可消费：导出的 DaemonConfig.allowed_roots 字段可被 file-rpc.ts import 读取 | blocks: task-05 | 代码静态检查 | `import type { DaemonConfig } from './config'` 后 `config.allowed_roots` 类型推导为 `string[]` |
| AC-10 TypeScript 严格模式编译通过 | 项目规约 | `pnpm tsc --noEmit`（或项目既定命令） | 0 error |

## 9. 风险与备注

- **R-1（与 task-05 接口契约）**：本任务定义字段，task-05 消费。需确保字段名 `allowed_roots`（snake_case，与现有 DaemonConfig 全 snake_case 命名一致）与 task-05 file-rpc.ts 读取处完全一致；本任务完成后建议在 task-05 蓝图中显式引用本字段名。
- **R-2（`~` 不展开）**：见 B3-注。用户若误配 `~/x` 会被错误 resolve。文档（JSDoc）已提示，不做代码展开（YAGNI）。
- **R-3（DEFAULT_CONFIG freeze 是浅冻结）**：`allowed_roots` 是数组（引用类型），`Object.freeze` 浅冻结不阻止 `DEFAULT_CONFIG.allowed_roots.push(...)`。但现有代码注释已说明「DaemonConfig 全是扁平字段，浅冻结即足够」——本任务引入数组后该假设**不再成立**。**应对**：loadConfig 起始 `{ ...DEFAULT_CONFIG }` 是浅拷贝，`data.allowed_roots` 仍指向 DEFAULT 的同一个数组引用！若后续代码 `data.allowed_roots.push(...)` 会污染 DEFAULT。**必须在 normalize 内新建数组**（`normalizeAllowedRoots` 返回全新数组，不 in-place 修改入参），见 §5.3 伪代码（`map`/`filter` 均产生新数组，已满足）。**单测 T10 需补充一条**：loadConfig 后修改 `data.allowed_roots` 不影响 `DEFAULT_CONFIG.allowed_roots`。
- **R-4（不在本任务范围）**：forbidden 越界判定、WS RPC 协议、前端提示配置位置——均属 task-04/task-05。本任务只产出数据。

## 10. 出参检查清单（执行阶段自检）

- [ ] `sillyhub-daemon/src/config.ts` 是唯一改动的源文件（test 文件除外）
- [ ] interface 新增字段有 JSDoc，引用 FR-04 / D-002@v1
- [ ] DEFAULT_CONFIG 新增项有注释
- [ ] `normalizeAllowedRoots` 函数私有（不 export），纯函数
- [ ] loadConfig 调用 normalize 后**不**额外落盘（除非 runtime_id 路径触发）
- [ ] 全部单测 T1~T11 通过
- [ ] `tsc --noEmit` 0 error
- [ ] 现有 daemon 手动启动一次无异常
