---
author: qinyi
created_at: 2026-07-30 10:45:00
---

# archive step5 对「源名含前导日期」的变更仍失败（坑3 修复未覆盖）

**状态**：活跃坑（待工具修复）。finished/sillyspec-3.24-verify-archive-pitfalls.md 的坑3 说已修，但本场景漏修。

## 现象

变更 `2026-07-29-sidebar-menu-restructure` 归档时：
- archive step4 `--confirm` 把目录从 `changes/2026-07-29-sidebar-menu-restructure/` 移到 `changes/archive/2026-07-30-sidebar-menu-restructure/`（**归档去源名前导日期**，避免双日期：2026-07-29-sidebar-menu-restructure → 纯描述 sidebar-menu-restructure → 2026-07-30-sidebar-menu-restructure）。
- 紧接 step5 `--done --change 2026-07-29-sidebar-menu-restructure` 报：
  `❌ 变更 "2026-07-29-sidebar-menu-restructure" 在当前 spec 下不存在`（前置 `validateChangeExists` exit 1）。

归档实质已完成（step4 已移动目录 + `unregisterChange` 标 `status=archived`，db 确认 status=archived）。

## 根因

坑3 的工具修复：`stage-contract.js` 的 `validateChangeExists` 对 archive 阶段加特例——`changes/<name>/` 不存在时检查 `changes/archive/<YYYY-MM-DD>-<changeName>/`（精确匹配）。

但归档逻辑（run.js）会**去源名前导日期**再拼归档目录：`2026-07-29-sidebar-menu-restructure` → 纯描述 `sidebar-menu-restructure` → 归档目录 `2026-07-30-sidebar-menu-restructure`。

而 `validateChangeExists` 的特例用**完整 changeName**（含日期）拼：`YYYY-MM-DD-2026-07-29-sidebar-menu-restructure`，与实际归档目录 `2026-07-30-sidebar-menu-restructure` **不匹配** → 仍判「不存在」。

即：坑3 修复假设 changeName 不含前导日期；本项目变更名约定为 `YYYY-MM-DD-<desc>`（含日期），两者不兼容。

## 绕过（已验证）

step5 `--done` 失败不阻断归档闭环。判据 = **db `status=archived`**（step4 已 `unregisterChange`）：

```bash
python -c "import sqlite3;c=sqlite3.connect('.sillyspec/.runtime/sillyspec.db');print([r for r in c.execute(\"select name,status,current_stage from changes where name like '%<变更关键字>%'\").fetchall()])"
```

见 `status=archived` 即归档完成，step5 的 git add（归档移动 + 模块文档）由人工/agent 手动做即可。

## 建议工具修复

`validateChangeExists` 的 archive 特例匹配逻辑应同时尝试「去 changeName 前导日期」的归档目录名（即归档逻辑用的同一去日期规则），而非只拼 `YYYY-MM-DD-<完整 changeName>`。或归档移动时把目标目录名写回 db 某字段，校验时直接读，避免字符串拼匹配。
