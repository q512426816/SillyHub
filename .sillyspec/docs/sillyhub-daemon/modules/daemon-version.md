---
schema_version: 1
doc_type: module-card
module_id: daemon-version
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# daemon-version

## 定位
daemon 自身版本号的唯一来源（持有 `package.json` 的 version/name）。与 `version.ts` 区别：后者是 semver 解析工具，解析「外部 agent CLI」版本字符串；本模块只持有 daemon 包自身元数据，不含任何运行时逻辑。

## 契约摘要
- `DAEMON_VERSION: string` —— daemon 包版本号（package.json version 字段）。
- `DAEMON_NAME: string` —— daemon 包名（package.json name 字段）。
- 无函数、无副作用，纯常量导出。

## 关键逻辑
ESM 静态 import package.json，带 `with { type: 'json' }` import attribute：
```
import pkg from '../package.json' with { type: 'json' };
export const DAEMON_VERSION = pkg.version;
export const DAEMON_NAME = pkg.name;
```
- dev（node dist/cli.js）：运行时读 sillyhub-daemon/package.json（Node ≥20.10 原生支持；vitest 经 vite 解析无版本限制）。
- ncc 打包后：ncc 把 JSON import 当静态资源内联进 bundle（实测），bundle 内不再产生运行时 JSON import，任意 Node ≥20 均可运行。版本冻结为构建时版本（发布所需）。

## 注意事项
- 消费方：cli.ts 的 commander `.version()`；adapters/json-rpc.ts 的 codex app-server 握手 `clientInfo.version`。
- 与 `version.ts`（MIN_VERSIONS/parseSemver）职责正交，勿混用：本模块读自身版本，version.ts 解析外部 agent 版本并做最低版本校验。
- import attribute `with { type: 'json' }` 是 Node ≥20.10 的稳定特性；ncc bundle 后该 import 被内联，低版本 Node 也能跑打包产物。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
