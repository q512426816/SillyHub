# Node ESM isMain 判断禁字符串拼接 file://${argv[1]}（Windows 必败）

author: qinyi
created_at: 2026-07-12 23:10:00

> 通用 Node 坑（非 SillySpec 工具缺陷，但项目踩过 P1，记此供检索）。

## 现象

Node ESM 模块判断"是否作为主模块直接运行"，常见简写：

```ts
const isMain = import.meta.url === `file://${process.argv[1]}`;
```

Linux/macOS 正常。**Windows 下 isMain 恒 false** → 作为子进程 spawn 的入口模块不执行启动逻辑。

ql-20260712-002-mcpwin：daemon 内置 `mcp-server.ts` 的 `if (isMain) runMcpServer()` 在 Windows 下不触发 → MCP server 子进程不启动 → team 主 agent MCP 5 tool 链路 Windows 完全断（生产 P1，违反 CLAUDE.md 规则13 三平台兼容）。

## 根因

- Windows `process.argv[1]` 是反斜杠绝对路径（`C:\...\dist\mcp-server.js`）
- `file://` + `C:\...` 拼接 = `file://C:\...`（两斜杠 + 反斜杠）
- `import.meta.url` 在 Windows = `file:///C:/.../mcp-server.js`（三斜杠 + 正斜杠）
- 二者不匹配 → isMain = false
- Linux/macOS：argv[1] = `/abs/path.js`，`file://` + `/abs` = `file:///abs`（三斜杠），侥幸匹配 → posix CI 不报错，Windows 生产断

## 修复

用 `node:url` 的 `pathToFileURL` 跨平台规范化：

```ts
import { pathToFileURL } from 'node:url';
const isMain = (() => {
  try {
    if (!process.argv[1]) return false;  // 兜底 undefined（typecheck 要求 string 不能 undefined）
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
```

commit 7369903b（2026-07-12-team-main-agent-orchestration execute Step15 审查发现 P1）。

## 通用坑

任何 Node ESM 项目（daemon / CLI / MCP server / 入口脚本）的 isMain 判断**禁用字符串拼接 `file://${argv[1]}`**（Windows 必败，posix 侥幸过 → CI 绿生产断）。一律 `pathToFileURL(argv[1]).href` + 判空兜底。
