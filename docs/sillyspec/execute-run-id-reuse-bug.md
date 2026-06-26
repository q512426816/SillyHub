---
author: qinyi
created_at: 2026-06-26 12:58:20
---

# execute run ID 跨变更复用导致进度状态混淆

## 发现时间
2026-06-26，推进变更 `2026-06-26-daemon-client-spec-sync-fix` 时。

## 现象
对该变更执行 `sillyspec run execute --change 2026-06-26-daemon-client-spec-sync-fix`，CLI 输出的固定 run ID 是 `exec-2026-06-24-113710`。但这个 run ID 实际是 06-24 那个 **`2026-06-25-admin-global-daemon-workspace-management`** 变更的旧 execute run ID——两个不同变更复用了同一个 run ID。

## 影响（实测）
1. **review.json 跨变更互相覆盖**：`.sillyspec/.runtime/execute-runs/exec-2026-06-24-113710/tasks/task-01~16/review.json` 下全是 admin 变更的残留（display_alias / owner / 分页 / 管理员页面），与 daemon-client 变更毫无关系。CLI 要求把当前变更的 review.json 写到这个 run ID 路径，等于让两变更的 task review 互相覆盖。
2. **step 计数错乱**：CLI 输出「execute 已进行到第 5/15 步（前 4 步已完成）」基于旧 run 的状态，与当前变更实际进度不符——把已实现并提交的 task-01 又列为 Wave 1 待执行，盲目继续会**重做已完成 task**。
3. **plan.md checkbox 全未勾**：当前变更的 task 从未走 CLI 正式收口（`--done` 勾选），因为 run 状态早已错乱。

## 根因（推测）
execute run ID 的生成/复用逻辑没有按变更名隔离。`exec-<date>-<seq>` 形式的 ID 在同一天或相邻日期的不同变更间发生碰撞/复用，或缓存了旧 run ID 未按 `--change` 重新生成。

## 期望修复
execute run ID 应按变更名强隔离（如 `exec-<change-slug>-<timestamp>`，或启动时校验 run ID 不被其他变更占用）。`.runtime/execute-runs/<runId>/` 下的进度数据（review.json / step 状态 / meta）不得跨变更污染。

## 当前规避
绕过 CLI 的 step/review.json 状态，以 **worktree 真实代码 + plan.md(14-task)** 为唯一事实来源手动推进：核实各 task 的 git 提交产出确定真实进度，子代理写代码后人工审查 + 串行 commit，review.json 写到正确位置或最后统一处理。CLI 的 `execute --done` 收口（校验 review.json）本机因无 sqlite3 本就要绕过（见已有记忆），此处叠加 run ID 错乱进一步要求脱离 CLI 状态推进。
