---
author: WhaleFall
created_at: 2026-07-30 16:45:00
type: sillyspec-tool-defect
status: active
---

# brainstorm `--reopen --from-step N` 后 `--done` 致步骤状态不同步

> 2026-07-30 变更 `2026-07-30-daemon-heartbeat-dedup-fix` 实测踩坑。

## 现象

为修补 design.md（补「决策」章节满足 plan 契约），执行：
```
sillyspec run brainstorm --change <变更名> --reopen --from-step 6
# 改 design.md ...
sillyspec run brainstorm --change <变更名> --done --output "..."
```
`--done` 输出：
```
✅ brainstorm 阶段已完成（8/8 步）
👉 下一步 plan
⚠️ 阶段校验跳过：8 步中仅 6 步标记为已完成，可能存在状态不同步。如确认阶段已完成，请运行 --status 确认。
```
随后 `--status` 显示矛盾：
```
阶段：brainstorm
进度：[██████░░] 6/8       ← 6/8
✅ 已完成                   ← 顶部却标「已完成」
✅ Step 1..6
⬜ Step 7: Design Grill    ← 未完成
⬜ Step 8: 用户确认...     ← 未完成
👉 下一步 plan             ← 却能进下一阶段
```

## 根因

`--reopen --from-step N` 会把 N..end 步骤状态重置为未完成（revision 模式，要求重新生成）。但 `--done` 当前步（N）后，CLI 的 batch-complete 直接把**阶段标记为完成并推进到下一阶段**，没有补回 N+1..end 的步骤状态。

结果：阶段完成标记 + 能进下一阶段（plan 契约看的是 design.md 内容 + 阶段完成标记），但步骤明细里 N+1..end 仍显示未完成 → 进度数字（6/8）与「已完成」矛盾。

## 影响

- **不阻断**下一阶段：plan 启动成功（plan 契约门控看 design.md 章节 + brainstorm 阶段完成标记，二者均满足）。
- **误导**：`--status` 的 6/8 + ⬜ 让人以为阶段没完成、Grill 没跑。实际上 Grill 之前已 pass，本次 reopen 只为补决策章节（方案未变，Grill 结论不变，无需重跑）。

## 修复（用户侧绕过）

以「顶部 ✅ 已完成 + 能进下一阶段」为阶段完成判据，忽略 6/8 的步骤明细与警告。若步骤明细强迫症要修，跑 `sillyspec doctor` 对齐进度。

## 待修（sillyspec 工具侧）

`--reopen --from-step N` + `--done N` 的 batch-complete 路径，应在标记阶段完成时**同步把 N+1..end 标记为 completed（继承 reopen 前状态）**，或在 reopen 时区分「需要重跑」vs「保留已完成」（如仅 design.md 文档微调，Grill/用户确认步骤可标记 carried-over）。

## 复现

```bash
# brainstorm 已 8/8 完成
sillyspec run brainstorm --change <变更名> --reopen --from-step 6
# 编辑 design.md（如补章节）
sillyspec run brainstorm --change <变更名> --done --output "修订"
# → 阶段标完成 + 能进 plan，但 --status 显示 6/8 + Step7/8 ⬜ + 警告状态不同步
```

## 影响范围

任何 brainstorm（或其它阶段）`--reopen --from-step N` 修订后 `--done`，若 N 不是末步，都会触发步骤明细与阶段完成标记不一致。本次变更首次踩中。

## 关联

- brainstorm `--reopen --from-step` revision 模式（Step6..8 重置）
- `--done` batch-complete 阶段完成路径
- 相关已记坑：`execute-done-progress-reset-and-dual-review-gate.md`（同主题的 execute 进度重置，不同阶段不同机制）
