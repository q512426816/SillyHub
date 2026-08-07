---
author: qinyi
created_at: 2026-08-07
status: 活跃坑（待 sillyspec 工具修复）
---

# quick --done 的 QUICKLOG 骨架不达标，必须手动精修

## 现象
`sillyspec run quick --done --change <session> --output "<四段摘要>"` 成功后，CLI 在
`QUICKLOG-qinyi.md` 落盘的 `ql-<id>` 条目骨架质量差，不达标：

- **状态留「进行中」**（应为「已完成」）——`--done` 已成功却没翻状态。
- **文件：「（见实际改动）」**（应为多行带括注的路径 bullet）。
- **正文四段（需求/根因/方案/结果）没渲染进条目**——`--output` 传了完整的四段，
  但骨架正文是空的（只有状态/关联变更/文件三行），`--output` 内容没被插入。

CLI 在 step 输出里明确要求「**QUICKLOG 正文精修（--done 之后必做，不可跳过）**」，
列出三项必改（标题改真实摘要 / 文件改多行 bullet / 正文四段充实）。

## 根因
quick `--done` 生成的骨架是**机械兜底产物**，没把 `--output` 的四段渲染进正文，
状态也没翻「已完成」，文件没用 `--done` 时的 staged/dirty 文件列表生成多行 bullet。
既知道「必做精修」，骨架就不该留半成品。

## 影响 + 绕过
- 影响：每条 quick 结束都得手动 Edit QUICKLOG 条目（改状态 + 文件多行 + 补正文四段），
  否则条目不达标。重复劳动，且容易漏改（忘翻状态 / 忘补正文）。
- 绕过：`--done` 后立即 Read QUICKLOG 条目 → 手动 Edit 精修（状态翻已完成、文件改
  多行带括注、正文补需求/根因/方案/结果四段）。
- QUICLOG 在 .sillyspec/（gitignore），精修不影响 `--done` 已通过的边界审计。

## 待修（给工具）
- `--done` 时把 `--output` 的四段（或解析出的需求/根因/方案/结果）直接渲染进骨架正文，
  不要留空让 agent 补。
- 状态直接翻「已完成」（`--done` 成功即完成）。
- 文件用 `--done` 时记录的边界文件（staged/dirty）生成多行 bullet（agent 仅需补括注）。
- 或：若坚持让 agent 精修，至少把 `--output` 原文插入正文（哪怕不分行），别丢弃。

## 相关
- 本次 `ql-20260807-001-f9ba`（pre-commit mypy 单文件扫）踩到：`--output` 写了完整
  四段，骨架却只给三行空壳，手动补全。
