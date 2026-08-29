# QUICKLOG 按日轮转机制与文档语义不一致（曾误判为数据丢失）

- 日期：2026-08-28
- 状态：活跃坑（机制已查明，待工具补文档/口径统一）
- author: WhaleFall
- created_at: 2026-08-28 11:10:00

## 现象与结论（已查明）

quick 会话 `--done` 后主文件 `.sillyspec/quicklog/QUICKLOG-WhaleFall.md` 从 510 行被重写为 11 行（仅剩当条），曾误判为 push 后清理误删。实际是 **CLI 的按日轮转**：历史条目被整体挪到同目录日期后缀文件 `QUICKLOG-WhaleFall-2026-08-28.md`（510 行 46 条），数据未丢失。

## 真正的问题

1. 轮转行为无任何输出提示，`git diff` 上表现为主文件 -500 行级删除，极易误判为数据事故（本次即触发了一次多余的恢复提交 d1752d11）。
2. 与 CLAUDE.md 规则 19「同一 QUICKLOG 文件按 ql-ID 条目追加，不是单槽位」的文档语义不一致——工具已改为"主文件仅当前条目 + 历史按日轮转文件"，文档未更新。

## 规避 / 建议

- 工具侧：轮转发生时打一行日志（如 `quicklog rotated → QUICKLOG-<user>-<date>.md`）；或干脆不轮转（继续单文件追加，git 本身可管体积）。
- 文档侧：若保留轮转，同步修订 CLAUDE.md 规则 19 与 QUICKLOG 相关 skill 描述。
- 使用侧：见主文件只剩单条 + 出现日期后缀文件 = 正常轮转，勿恢复（会与轮转副本重复）。

## 处置记录

- d1752d11：误判后从 git 恢复主文件全量（与轮转副本重复，历史记录保留）。
- 后续提交：主文件回到 CLI 单条形态，轮转文件 `QUICKLOG-WhaleFall-2026-08-28.md` 入库。

## 处置记录（2026-08-29 收口）

- **工具侧**：轮转 echo 自 sillyspec 仓 f1709ec（2026-08-13）已存在——`🔄 QUICKLOG 已轮转（>500 行）：QUICKLOG-<user>.md → QUICKLOG-<user>-<日期>.md（提交时带上归档文件，勿漏）`。08-28 事故时该提示已在，误判根因是提示发生在**条目创建时**（rotateIfNeeded 在 append 路径内），而 git diff 审视发生在 `--done` 之后，时间差导致提示未被关联。
- **文档侧（本日补齐）**：两仓（multi-agent-platform / sillyspec）CLAUDE.md「任务记录隔离」规则与 `.claude/skills/sillyspec-quick/SKILL.md` 均已补轮转口径：主文件超 500 行自动轮转属正常、git diff 大幅删除不是数据丢失、**勿从 git 恢复**（会与轮转副本重复）、提交带上归档文件。
- 结论：机制已查明 + 工具提示已在 + 文档口径已对齐 → 归档。
