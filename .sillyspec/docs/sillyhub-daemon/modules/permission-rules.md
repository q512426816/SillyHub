---
schema_version: 1
doc_type: module-card
module_id: permission-rules
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 权限规则生成器（permission-rules）

## 定位
CC（claude-code）permission rules 生成器（`src/permission-rules.ts`，单文件）。
按 allowed_roots 构建「读自由 + 写白名单」沙箱：读工具（Read/Grep/Bash 等）不配
规则，写工具（Write/Edit）白名单内 allow、白名单外 deny。产物是 CC `--settings`
JSON 的 permissions 部分（2026-06-29-runtime-allowed-roots-config task-05）。

## 契约摘要
- `buildWritePermissionRules(allowedRoots: string[]): { allow: string[]; deny: string[] }`
  ——每个 root（去重 + expandRoot）× 每个写工具生成 `Write(root/**)` + `Write(root)`
  两条 allow；deny 固定 `Write(**)` / `Edit(**)` 两条通配。
- `buildCcSettingsJson(allowedRoots): string`——JSON.stringify({ permissions:
  { allow, deny } })，daemon 启动 CC 时经 `--settings` 传入。
- 常量 `WRITE_TOOLS = ['Write', 'Edit']`；`SillySpec_TEMP_PATTERNS` 临时路径放行表。
- 依赖：零模块依赖（仅 node:os）。唯一消费方 `adapters/stream-json.ts`。

## 关键逻辑
```
allow = for root × tool: tool(root/**) + tool(root)          # 白名单内写
allow += for temp × tool: tool(temp/**) + tool(temp)         # FR-003 临时路径放行
deny  = Write(**), Edit(**)                                  # 通配拒绝，allow 覆盖 deny
expandRoot: ~ → homedir，反斜杠统一正斜杠（CC 路径模式用 /）
```

## 注意事项
- 语义依赖 CC permission 优先级：allow（具体路径）覆盖 deny（通配 `**`），
  越界写（如 `D:/evil/**`）仍被 `Write(**)` 拦截。
- FR-003 临时路径只放行 3 类：`C:/dev/null`（Windows null 设备占位，sillyspec
  写它触发 deny）、`/dev/null`、`os.tmpdir()`（反斜杠转正斜杠）。`.sillyspec/.runtime`
  在 ~/.sillyhub 下已含于 homedir 兜底白名单，不重复加。
- 路径分隔统一正斜杠在 expandRoot / tmpdir 两处做，新增放行项必须同样转斜杠，
  否则 Windows 反斜杠路径匹配不上。
- 与 policy 模块的 filesystem-policy 是两套机制：本模块是 CC 侧 settings 沙箱
  （batch claude spawn 用），policy 是 daemon 侧裁决 + 审计；改 allowed_roots
  语义时两处都要顾及。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
