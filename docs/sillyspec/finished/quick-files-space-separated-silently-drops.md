# 活跃坑：sillyspec quick `--files` 多文件必须逗号分隔（单参数），空格分隔 CLI 只取首个

> 状态：**活跃（待工具修复 / 文档补强）** · 发现于 2026-08-11 · quick `quick-c5dcc01a`（前端 locale 批量修复，19 文件）

## 现象

`sillyspec run quick --files` 传**多个文件**时，若用空格分隔（每个路径一个参数，符合 POSIX 多值参数直觉）：

```bash
sillyspec run quick --linked-changes none --files \
  "frontend/src/.../a.tsx" \
  "frontend/src/.../b.tsx" \
  "frontend/src/.../c.tsx" \
  --non-interactive
```

CLI 启动**不报错**，但 `guard.json` 的 `allowedFiles` **只登记了第一个**：

```
🛡️ quick 变更边界已记录: 43 个已有脏文件, 1 个 allowedFiles   ← 应为 19
```

```bash
$ cat .sillyspec/.runtime/quick-sessions/<id>/guard.json | jq '.allowedFiles'
[
  "frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx"   # 只剩首个
]
```

后果：step 3 `--done` 边界审计时，其余 18 个文件全部被判「超出 allowedFiles」→ BLOCKED（或 WARNING，视版本）。边界保护形同虚设——声明的边界与实际不符。

## 正确用法

`--files` 期望**逗号分隔的单个参数值**（与 skill 文档 `--files a.js,b.js` 一致，但文档未强调"禁止空格分隔"）：

```bash
sillyspec run quick --linked-changes none \
  --files "a.tsx,b.tsx,c.tsx" \
  --non-interactive
```

启动后立即核对 `guard.json`：

```bash
cat ".sillyspec/.runtime/quick-sessions/quick-<id>/guard.json" | \
  python -c "import json,sys; d=json.load(sys.stdin); print('allowedFiles count:', len(d.get('allowedFiles',[])))"
```

## 根因

CLI 参数解析对 `--files` 取值时只读了下一个 token（`args[i+1]`），没有循环收集直到遇到下一个 `--flag`。多个空格分隔的路径只有第一个被当成 `--files` 的值，其余被当成未知位置参数丢弃（不报错）。

## 期望修复

1. `--files` 支持空格分隔多值（贪婪收集直到下一个 `--flag`），或
2. 检测到「`--files` 后的 token 不含逗号且下一 token 不是 `--flag`」时**报错而非静默丢弃**，或
3. 至少在启动摘要里把解析到的 allowedFiles **全量打印**（而非只打计数），让用户一眼看出少了。

## 绕过

启动 quick 后、改代码前，**必查 `guard.json` 的 allowedFiles count 是否等于预期**。不等则 `rm -rf .sillyspec/.runtime/quick-sessions/<id> .sillyspec/changes/<id>` 回退重来，用逗号分隔重传。

## 相关

- skill 文档（`.claude/skills/sillyspec-quick/SKILL.md`）的 `--files a.js,b.js` 示例是逗号分隔，但未警告空格分隔的静默丢失。
