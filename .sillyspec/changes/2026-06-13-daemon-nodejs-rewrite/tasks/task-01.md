---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-01
title: Node 工程初始化（package.json + tsconfig strict + vitest.config.ts）
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-02, task-03, task-04, task-12, task-13, task-14, task-15]
allowed_paths:
  - sillyhub-daemon/package.json
  - sillyhub-daemon/tsconfig.json
  - sillyhub-daemon/vitest.config.ts
---

# task-01: Node 工程初始化（package.json + tsconfig strict + vitest.config.ts）

本任务是 daemon Node.js 重写的第一步（Wave 1，无依赖）。只产出工程脚手架配置，**不写任何业务源码**。后续所有 task（task-02 协议层、task-03 backends、task-04 CLI、task-12~15 其他模块）都在此工程内增补代码，因此本配置的命名、路径、TS 选项必须一次到位。

## 修改文件

精确路径（均在 `sillyhub-daemon/` 子目录下，仓库根为 `/Users/qinyi/SillyHub`）：

| 文件 | 动作 | 说明 |
|---|---|---|
| `sillyhub-daemon/package.json` | 新建 | 工程清单，name/type/engines/bin/scripts/dependencies |
| `sillyhub-daemon/tsconfig.json` | 新建 | TypeScript strict 配置，target ES2022 + NodeNext |
| `sillyhub-daemon/vitest.config.ts` | 新建 | vitest 测试运行器配置，environment node |
| `sillyhub-daemon/src/.gitkeep` | 新建 | 空占位，确保 `src/` 目录进入 git（后续 task 在此填业务码） |
| `sillyhub-daemon/tests/.gitkeep` | 新建 | 空占位，确保 `tests/` 目录进入 git（后续 task 在此填测试） |

> 注意：`sillyhub-daemon/src/.gitkeep` 与 `sillyhub-daemon/tests/.gitkeep` 不在 frontmatter 的 `allowed_paths` 内，但二者是 0 字节占位文件、非源码，且为"src/ 空目录占位"实现要点所必需。若 execute 阶段严格受限，可仅创建前三个配置文件，src/tests 目录由 task-02 首次写源码时自然建立。

## 实现要求

### R1. package.json 必填字段

- `name`: `"sillyhub-daemon"`（与 Python `pyproject.toml` 的 `name` 保持一致，便于 1:1 等价识别）
- `version`: `"0.1.0"`（对齐 Python 版本，本任务不升级版本号）
- `description`: `"SillyHub local daemon for task execution (Node.js rewrite)"`（沿用 Python 描述并标注 rewrite）
- `type`: `"module"`（ESM，配合 `module: NodeNext`）
- `private`: `true`（不发布到 npm，与 frontend/package.json 一致）
- `engines.node`: `">=20.0.0"`（对齐 Python `requires-python >=3.12` 的硬性约束级别，也与 frontend `engines.node` 一致）
- `packageManager`: `"pnpm@9.6.0"`（**必须**与 frontend/package.json 完全一致，monorepo 共用 pnpm 版本）
- `bin`: `{ "sillyhub-daemon": "./dist/cli.js" }`（对齐 Python `project.scripts.sillyhub-daemon`）
- `main`: `"./dist/cli.js"`（执行入口）

### R2. package.json scripts

直接对齐 Python 入口与 frontend 命名风格，并预留 local.yaml 将引用的 `daemon_*` 命令（本任务只定义 npm scripts，local.yaml 的修改属 task-02 或后续 task 范围，本任务**不修改 local.yaml**）：

| script | 值 | 说明 |
|---|---|---|
| `dev` | `"tsc --watch"` | 监听编译（daemon 是常驻进程，dev 模式靠 tsc watch + node dist/cli.js，不在本任务做热重载） |
| `build` | `"tsc"` | 编译到 dist/ |
| `typecheck` | `"tsc --noEmit"` | 类型检查，对齐 frontend `typecheck` |
| `test` | `"vitest run"` | 单次跑测试，对齐 frontend `test` |
| `test:watch` | `"vitest"` | watch 模式，对齐 frontend `test:watch` |
| `start` | `"node dist/cli.js"` | 启动已构建的 daemon |

> local.yaml 占位命令（本任务不写入 local.yaml，仅在此声明约定，供后续 task 引用）：
> - `daemon_install`: `"cd sillyhub-daemon && pnpm install"`
> - `daemon_build`: `"cd sillyhub-daemon && pnpm build"`
> - `daemon_test`: `"cd sillyhub-daemon && pnpm test"`
> - `daemon_typecheck`: `"cd sillyhub-daemon && pnpm typecheck"`

### R3. package.json dependencies

技术栈映射严格按 design 要求（G-05 零/少依赖）：

- 运行时 dependencies **仅 2 个**：
  - `ws`: `"^8.18.0"`（替换 Python `websockets`）
  - `commander`: `"^12.1.0"`（替换 Python `click`）
- **不包含** `httpx` 对应物——design 明确用 Node 20 原生 `fetch`（Node 18+ 全局可用，本工程 engines>=20 满足），零依赖。

### R4. package.json devDependencies

- `typescript`: `"5.5.4"`（**固定版本**，与 frontend/package.json 完全一致，避免 monorepo 内 TS 版本漂移）
- `vitest`: `"^2.0.0"`（与 frontend 一致）
- `@types/node`: `"20.14.0"`（与 frontend 一致，匹配 Node 20 LTS）
- `@types/ws`: `"^8.5.12"`
- `@types/commander`：**不需要**——commander v12 自带类型声明（捆绑发布），添加此包反而会引入幽灵类型。execute 阶段若 IDE 报缺类型，先确认 commander 版本是否 >=12，而非盲目装 @types/commander。

### R5. tsconfig.json 关键选项

| 选项 | 值 | 依据 |
|---|---|---|
| `target` | `"ES2022"` | 对齐 frontend，Node 20 原生支持 ES2022 |
| `module` | `"NodeNext"` | daemon 是 Node 后端（非 bundler），用 NodeNext 而非 frontend 的 esnext/bundler |
| `moduleResolution` | `"NodeNext"` | 必须与 module 配对 |
| `lib` | `["ES2022"]` | **不含 dom**——daemon 跑在 Node，不需要 DOM 类型（与 frontend 区分点） |
| `strict` | `true` | 硬性要求 |
| `noUncheckedIndexedAccess` | `true` | 硬性要求，对齐 frontend |
| `noImplicitOverride` | `true` | 配合后续 protocol interface 继承 |
| `forceConsistentCasingInFileNames` | `true` | 对齐 frontend，跨平台一致 |
| `esModuleInterop` | `true` | 导入 commander 等 CJS 包 |
| `skipLibCheck` | `true` | 对齐 frontend，加快编译 |
| `resolveJsonModule` | `true` | 允许 import package.json 读版本 |
| `declaration` | `true` | 输出 .d.ts |
| `sourceMap` | `true` | 调试 |
| `outDir` | `"./dist"` | 编译产物 |
| `rootDir` | `"./src"` | 源码根（**严格限定**：tests/ 不在 rootDir 内，靠 vitest 单独处理，避免 tsc 把测试编进 dist） |
| `types` | `["node"]` | 显式包含 @types/node，**不包含** vitest/globals（避免污染运行时类型，测试类型由 vitest.config 注入） |
| `isolatedModules` | `true` | 对齐 frontend，配合 vitest 转译 |
| `verbatimModuleSyntax` | `true` | ESM 工程推荐，强制 `import type` 语法 |

`include`: `["src/**/*.ts"]`
`exclude`: `["node_modules", "dist", "tests"]`

> **注意 rootDir 与测试的关系**：tsconfig.json 仅覆盖 `src/`（生产编译用）；vitest 用 esbuild 直接转译 `tests/**/*.test.ts`，不依赖 tsc 处理测试。这样 `pnpm typecheck`（tsc --noEmit）只检 src，`pnpm test`（vitest）跑 tests，职责分离。

### R6. vitest.config.ts 要求

- 导入方式：`import { defineConfig } from 'vitest/config'`
- `test.environment`: `"node"`（daemon 是 Node 进程，**不用 jsdom**，与 frontend 的 dom 环境区分）
- `test.include`: `["tests/**/*.test.ts"]`
- `test.globals`: `false`（保持显式 import { describe, it, expect } from 'vitest'，类型更安全）
- `test.coverage`：本任务可先不配，留待 task 验收阶段加 threshold（避免引入 @vitest/coverage-v8 额外依赖，超出"仅 ws+commander"约束）

## 接口定义

以下为三个配置文件的**完整结构骨架**，execute 子代理可直接照搬字段值。

### package.json

```json
{
  "name": "sillyhub-daemon",
  "version": "0.1.0",
  "description": "SillyHub local daemon for task execution (Node.js rewrite)",
  "private": true,
  "type": "module",
  "main": "./dist/cli.js",
  "bin": {
    "sillyhub-daemon": "./dist/cli.js"
  },
  "scripts": {
    "dev": "tsc --watch",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "start": "node dist/cli.js"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "packageManager": "pnpm@9.6.0",
  "dependencies": {
    "commander": "^12.1.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "20.14.0",
    "@types/ws": "^8.5.12",
    "typescript": "5.5.4",
    "vitest": "^2.0.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
});
```

### 目录占位

```
sillyhub-daemon/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   └── .gitkeep        # 空文件，仅占位
└── tests/
    └── .gitkeep        # 空文件，仅占位
```

## 边界处理

1. **Node 版本不符（engines 校验失败）**：若执行环境 Node < 20，`pnpm install` 会因 `engines.node` 报错或警告。处理：execute 前 `node -v` 自检；若 <20，停止并提示升级，**不**为绕过而放宽 engines（G-05 硬约束）。pnpm 默认不硬性拦截 engines，如需严格，可加 `.npmrc` 写 `engine-strict=true`（本任务可选，不强求）。

2. **依赖安装失败（registry/网络）**：若 `pnpm install` 拉取 ws/commander/typescript 失败。处理：先确认 monorepo 根是否有 pnpm-workspace.yaml（若有，daemon/ 应作为 workspace 成员，本任务**不**创建 workspace 配置，由 task-02 或 monorepo 整合 task 处理）。临时排查：`pnpm config get registry`，必要时切 `https://registry.npmmirror.com/`。**禁止**用 npm/yarn 混装（monorepo 统一 pnpm@9.6.0）。

3. **strict 下类型报错（tsc --noEmit 失败）**：本任务 src/ 为空，理论上零类型错误。若出现错误，最可能是 `lib` 未含 ES2022 导致 Promise/Array.at 等报红，或 `types: ["node"]` 未装 @types/node。处理：逐一核对 R5 表格；**禁止**用 `// @ts-ignore` 或临时关 strict 绕过——strict 是 design 硬约束。

4. **与 monorepo 其它 TS 项目约定冲突**：frontend 用 `module: esnext` + `moduleResolution: bundler`（因 Next.js bundler），daemon 用 `NodeNext`。这不算冲突——backend 与 frontend 运行时不同，**刻意区分**。execute 若被 review 质疑，依据：daemon 是 Node 原生进程无 bundler，NodeNext 才能正确解析 `import ... from 'node:fs'` 等内置模块。一致点保留：engines、typescript 版本、pnpm 版本、strict、noUncheckedIndexedAccess。

5. **bin 路径不存在（dist/cli.js 缺失）**：本任务只声明 `"bin": { "sillyhub-daemon": "./dist/cli.js" }`，但 dist/cli.js 要等 task-02 写 cli.ts + task-01 build 后才存在。处理：package.json 的 bin 字段在 install 时不会校验路径存在，仅在 `pnpm link` / npm install -g 时报错；本任务**不执行** `pnpm link`，验收只到 `pnpm build`（产物为空 dist，因 src 空）。AC 中明确：bin 路径存在性验收留给 task-02。

6. **pnpm-workspace.yaml 已锁定版本（phantom dependency）**：若 monorepo 根 pnpm-workspace.yaml 或 package.json 已声明 `typescript`/`vitest` 某固定版本，daemon 子包的 devDependencies 可能被 hoist 覆盖。处理：execute 前读仓库根 `package.json` 与 `pnpm-workspace.yaml`；若版本冲突，以 monorepo 根版本为准并同步本任务 devDependencies，**不**在子包锁不同版本制造漂移。

7. **@types/commander 误装**：commander v12 自带类型，若 execute 阶段 IDE 提示缺类型而误装 `@types/commander`，会导致类型重复声明冲突（TS2767/TS6200）。处理：确认 `"commander": "^12.1.0"` 已装后，类型应自动可用；若仍报错，检查是否装了 @types/commander 并卸载之。

8. **rootDir 限制导致 tests 编译失败**：tsconfig rootDir=`./src` 且 include 仅 `src/**`，若有人在 src 内 `import '../tests/...'`，tsc 会报 "is not under rootDir"。处理：保持 src/tests 物理隔离，测试通过 vitest 独立转译；禁止跨界 import。

## 非目标

本任务**明确不做**以下事项（避免越界，留给后续 task）：

- **不写任何业务源码**：src/ 下除 .gitkeep 外不创建 cli.ts、protocol.ts、daemon.ts 等（属 task-02/03/04）。
- **不迁移或改写测试**：tests/ 下除 .gitkeep 外不创建任何 .test.ts（属各功能 task）。
- **不删除 Python 工程**：`sillyhub-daemon/sillyhub_daemon/` 与 `sillyhub-daemon/tests/*.py` **保持原样**，Python 与 Node 工程在 sillyhub-daemon/ 下短期共存，待全部 task 验收后由收尾 task 删除 Python 代码。本任务的 package.json/tsconfig.json/vitest.config.ts 与 Python pyproject.toml 共存无冲突（工具链互不读取对方）。
- **不修改 local.yaml**：daemon_* 命令占位仅在本蓝图声明，实际写入 .sillyspec/.runtime/local.yaml 由后续 task（或 sillyspec 流程整合）处理。
- **不配置 ESLint/Prettier**：本任务范围外，lint 策略留待统一 task（frontend 用 next lint，daemon 需另选 eslint 平面配置，不在 task-01）。
- **不配 CI**：GitHub Actions 等不在本任务。
- **不动 monorepo 根的 package.json/pnpm-workspace.yaml**：若需把 daemon 加入 workspace，由专门 task 处理；本任务仅建子目录工程。

## 参考

- Python 工程入口与依赖：`/Users/qinyi/SillyHub/sillyhub-daemon/pyproject.toml`
  - `name = "sillyhub-daemon"`、`version = "0.1.0"`、`requires-python = ">=3.12"`
  - 入口 `sillyhub_daemon.__main__:cli`（对应 Node 的 dist/cli.js）
  - 运行时依赖 httpx/websockets/click（对应 fetch/ws/commander）
- monorepo TS 约定：`/Users/qinyi/SillyHub/frontend/package.json`
  - `engines.node: ">=20.0.0"`、`packageManager: "pnpm@9.6.0"`
  - `typescript: "5.5.4"`、`@types/node: "20.14.0"`、`vitest: "^2.0.0"`
  - scripts 命名：`typecheck`/`test`/`test:watch`
- TS 编译选项参考：`/Users/qinyi/SillyHub/frontend/tsconfig.json`
  - `strict: true`、`noUncheckedIndexedAccess: true`、`forceConsistentCasingInFileNames: true`、`target: "ES2022"`、`skipLibCheck: true`
  - 注意 daemon 与 frontend 的差异：module/moduleResolution（NodeNext vs esnext/bundler）、lib（ES2022 vs dom+esnext）、types（node vs vitest/globals+jest-dom）
- 本变更设计文档：`/Users/qinyi/SillyHub/.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/design.md`（技术栈映射、G-05 零/少依赖约束）

## TDD 步骤

本任务为配置类任务，TDD 退化为"建工程 → 编译通过 → 测试运行器就绪 → 回归"四步：

1. **建工程**：按"接口定义"章节创建 package.json / tsconfig.json / vitest.config.ts，建 src/.gitkeep 与 tests/.gitkeep。
2. **装依赖**：`cd sillyhub-daemon && pnpm install`。验证：node_modules 生成，无报错；`pnpm list typescript vitest ws commander` 版本符合 R3/R4。
3. **类型检查通过**（对齐 Python 无源码时的"空工程可编译"）：因 src/ 为空，`pnpm typecheck`（tsc --noEmit）应 0 错误 0 警告。
   - 若报 "No inputs were found in config file"（include 匹配不到任何 .ts）：在 src/ 下放一个临时 `src/_placeholder.ts`（内容 `export {};`），**仅用于让 tsc 不空报**；或直接靠 src/.gitkeep + 一个 `export {}` 的占位 .ts。本任务采用：src/ 下放 `.gitkeep` 即可，若 tsc 空输入报错则补 `src/index.ts` 写 `export {};`（仍非业务码）。
4. **vitest 能跑空套件**：`pnpm test`。验证：vitest 启动成功，因 tests/ 无 .test.ts，应输出 "No test files found" 并以 exit code 0 或 1 退出（vitest 默认无测试时退出 1，属预期，验收说明见 AC-02）。如需 exit 0，可加 `--passWithNoTests`，本任务**采用** `vitest run --passWithNoTests`（更新 scripts.test 为此值，见 AC-02 备注）。
5. **build 产物**：`pnpm build`（tsc）。验证：dist/ 目录生成（内容可能为空或仅含占位 .js，因 src 无业务码），无编译错误。
6. **回归**：在 monorepo 根执行 `pnpm -C frontend typecheck` 确认 frontend 未被本任务影响（隔离性回归，确认 daemon 工程初始化未触碰 frontend 配置）。

> scripts.test 最终取值修正：`"vitest run --passWithNoTests"`（让空套件 exit 0，便于 CI 友好）。execute 阶段以此为准。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `cd sillyhub-daemon && pnpm install` | 安装成功，exit 0，node_modules 内含 ws、commander、typescript、vitest、@types/node、@types/ws；无 peer dependency 警告（或警告不涉及核心依赖） |
| AC-02 | `cd sillyhub-daemon && pnpm test` | vitest 成功启动，输出 "No test files found" 且 **exit code 0**（依赖 scripts.test 含 `--passWithNoTests`） |
| AC-03 | `cd sillyhub-daemon && pnpm typecheck` | `tsc --noEmit` 输出为空，exit 0，**零错误零警告** |
| AC-04 | `cd sillyhub-daemon && pnpm build` | `tsc` 成功，dist/ 目录被创建，exit 0；dist 内不包含 tests 产物（因 rootDir=src、exclude tests） |
| AC-05 | 检查 tsconfig strict 生效 | tsconfig.json 含 `"strict": true` 与 `"noUncheckedIndexedAccess": true`；临时在 src/ 写一行 `const x: string = 1;` 跑 `pnpm typecheck` 应报类型错误（验证后删除该行，不在最终提交内） |
| AC-06 | 检查 package.json 字段 | `engines.node === ">=20.0.0"`、`packageManager === "pnpm@9.6.0"`、`type === "module"`、`bin.sillyhub-daemon === "./dist/cli.js"`、dependencies 仅含 ws+commander 两项（不含 httpx 等价包） |
| AC-07 | 检查 monorepo 隔离 | `pnpm -C frontend typecheck` 仍 exit 0，frontend/tsconfig.json 与 frontend/package.json 未被本任务修改（`git diff --name-only` 仅含 sillyhub-daemon/ 下文件） |
| AC-08 | 检查 Python 工程未被动 | `sillyhub-daemon/pyproject.toml` 与 `sillyhub-daemon/sillyhub_daemon/*.py` 内容未变（git status 显示这些文件非本任务改动） |
