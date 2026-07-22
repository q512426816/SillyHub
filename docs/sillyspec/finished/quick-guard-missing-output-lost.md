---
author: qinyi
created_at: 2026-07-22 11:45:00
---

# quick 会话 guard 不落盘 → --done 兜底补写空编号 + output 摘要丢失

> ✅ 状态：**已解决**（2026-07-22 复核归档）。核心机制（guard 落盘 + 兜底/output 持久化）已由 10aa28a 修复并经测试验证（quicklog 39 + e2e 9 + guard 19 断言全过）；今日修复后条目（ql-005/006/007）均正确落盘于 `QUICKLOG-WhaleFall.md`，含 `结果：` 行。当日「ql-005 复现」实为误判——git `user.name` 在 `qinyi`/`WhaleFall` 间漂移，条目写进 `QUICKLOG-WhaleFall.md`，排查时误查 `QUICKLOG-qinyi.md` 故以为丢失。NNN「撞号」非缺陷：不同 per-user 文件本就分人记录，ql-ID 末尾 4 位后缀已消歧，无需强制跨文件序号唯一。

> 原状态（历史）：⚠️ 活跃坑，未修复。曾一度归入 `finished/`，但 2026-07-22 ql-005「再次复现」一度移回活跃区——后经核实为上述误判。

## 现象
`sillyspec run quick` 启动新会话（如 `quick-990f8c09`）时，`current-quick-run-id`
写为该会话 id，但 `.runtime/quick-sessions/quick-990f8c09/guard.json` **不落盘**
（目录下只有历史会话）。后续 `--done --change quick-990f8c09 --output "..."` 时：

1. CLI 提示「QUICKLOG 兜底补写: ql-<日期>-001-xxxx（guard 缺失/brownfield 会话）」；
2. 编号取兜底 `ql-<日期>-001-<rand>`，**不是**该日期真实下一个序号（如本应是 004/005）；
3. **更关键**：兜底补写的内容没有真正落盘到任何 QUICKLOG 文件（`grep` 全目录无匹配，
   `git diff` 也无新增），3 个 step 的 `--output` 摘要全部丢失——流程显示 ✅ 3/3 完成，
   但任务记录是空的。

## 根因（待工具修复）
quick 会话首次 `run` 时 guard 未写入 `quick-sessions/<sid>/guard.json`，导致 `--done`
走「guard 缺失」兜底分支，该分支只打印日志、不持久化 output 摘要。

## 绕过方案
quick 各 step 的 `--output` 摘要不可依赖工具落盘，**完成后手动把条目补写到**
`.sillyspec/quicklog/QUICKLOG-<user>.md`，编号按该文件内当日最大序号 +1，
并同步到模块文档变更索引。

## 复现记录

### 2026-07-22 ql-005（再次复现，证明本坑未修复，不应停留在 finished/）
- 会话 `quick-3820a419`。启动时 CLI 提示「QUICKLOG 条目已创建: ql-20260722-002-e5a1」，但实际 `.sillyspec/quicklog/QUICKLOG-qinyi.md` **根本没有 002 条目**（当日已有 001/003/004，真实下一个序号应为 005）。
- 3 个 step 的 `--done --output` 摘要全部丢失，`git diff` 无任何 QUICKLOG 新增。
- `sillyspec run quick --status --change quick-3820a419` 还显示进度卡在 1/3、Step 2「当前」（与已执行的 `--done` 推进矛盾）。
- 完全靠**手动补写** `ql-20260722-005` 到 QUICKLOG-qinyi.md + 模块文档变更索引才留下记录。
- 结论：坑仍在，`finished/` 归类过早。每次 quick 都得手动兜底。

## 关联坑：step prompt 的 specDir 与 .sillyspec-platform.json 不一致（文档写错根）

跑 quick 时，启动 step 的 prompt 正文写「平台模式 specDir=C:\Users\qinyi\.sillyhub\daemon\specs\<ws>\…」（`~/.sillyhub`，daemon-client 运行时副本），但项目根 `.sillyspec-platform.json` 实际 `specRoot = C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec`（项目内，本地模式，git 跟踪）。

后果：若按 step prompt 指引把文档/记录写到 `~/.sillyhub`，**不会进 git、不会被项目跟踪**，等于白写。ql-005 首次就把模块文档 `app-ppm-pages.md` 更到了 `~/.sillyhub` 版，后来读 `.sillyspec-platform.json` 才发现写错根，改回项目内 `.sillyspec/`。

绕过：文档/记录一律以 `.sillyspec-platform.json` 的 `specRoot` 为准（本项目 = 项目内 `.sillyspec/`），**忽略 step prompt 正文里的 `~/.sillyhub` 路径**。属 daemon-client spec 同步断裂的又一表现（见 memory `daemon-client-spec-sync-broken`）。

## 关联
- `quick-done-change-default-resets-steps.md`（quick 另一类会话状态缺陷）
