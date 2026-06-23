/**
 * daemon-version.ts —— daemon 自身版本号的唯一来源（package.json）。
 *
 * 与 version.ts 的区别：version.ts 是 semver 解析工具（解析 *外部 agent CLI*
 * 的版本字符串，如 `claude --version` 的输出），不持有 daemon 自身版本。
 * 本模块持有 daemon 包自身的版本，供：
 *   - cli.ts 的 `--version`（commander `.version()`）
 *   - adapters/json-rpc.ts 的 codex app-server 握手 `clientInfo.version`
 *
 * 实现：ESM 静态 import package.json，带 `with { type: 'json' }` import attribute。
 *   - dev（node dist/cli.js）：运行时读 sillyhub-daemon/package.json（Node ≥20.10
 *     原生支持 import attribute；vitest 经 vite 解析 JSON，无版本限制）
 *   - ncc 打包后：ncc 把 JSON import 当静态资源内联进 bundle（实测），bundle 内
 *     不再产生运行时 JSON import，因此在任意 Node ≥20 版本均可运行。版本冻结为
 *     构建时版本（这正是发布所需）。
 *
 * @module daemon-version
 */

import pkg from '../package.json' with { type: 'json' };

/** Daemon 包版本号（package.json version 字段）。 */
export const DAEMON_VERSION: string = pkg.version;

/** Daemon 包名（package.json name 字段）。 */
export const DAEMON_NAME: string = pkg.name;
