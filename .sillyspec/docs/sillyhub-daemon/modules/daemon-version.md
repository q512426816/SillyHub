---
schema_version: 1
doc_type: module-card
module_id: daemon-version
author: qinyi
created_at: 2026-08-18 01:45:00
---

# daemon 版本号唯一来源（daemon-version）

## 定位

daemon 自身版本号的唯一来源（package.json 的 version/name），纯常量导出、无运行时
逻辑。与 version.ts 职责正交：version.ts 是 semver 解析工具，解析**外部 agent CLI**
的版本字符串（如 `claude --version` 输出）并做最低版本校验；本模块只持有 daemon
包自身元数据。

## 契约摘要

- `DAEMON_VERSION: string`——package.json version 字段。
- `DAEMON_NAME: string`——package.json name 字段。
- 无函数、无副作用。

## 关键逻辑

```
import pkg from '../package.json' with { type: 'json' };   # ESM import attribute
DAEMON_VERSION = pkg.version;  DAEMON_NAME = pkg.name;
```

- dev（node dist/cli.js）：运行时读 sillyhub-daemon/package.json（Node ≥20.10 原生
  支持 import attribute；vitest 经 vite 解析 JSON，无版本限制）。
- ncc 打包后：JSON import 被当静态资源内联进 bundle（实测），不产生运行时 JSON
  import，任意 Node ≥20 可跑；版本冻结为构建时版本（正是发布所需）。

## 注意事项

- 消费方：cli.ts 的 commander `.version()`（`--version`）；adapters/json-rpc.ts 的
  codex app-server 握手 `clientInfo.version`。
- 勿与 version.ts 混用：本模块读自身版本，version.ts 判外部 agent 最低版本。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
