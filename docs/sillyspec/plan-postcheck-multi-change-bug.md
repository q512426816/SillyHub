---
author: WhaleFall
created_at: 2026-06-26T13:11:00
type: tool-defect
---

# SillySpec 缺陷：plan postcheck 多变更环境下校验错变更

## 现象
plan 阶段 step 4（Wave 重排与可行性校验，CLI 自动 postcheck）在多变更项目（`.sillyspec/changes/` 下多个目录）报「蓝图一致性校验失败」，列出 task-NN 缺 allowed_paths / 验收标准——但这些 task 属于**另一个变更**（字典序最大的目录，如 `workspace-spec-root-managed-p0`），不是当前 `--change` 指定的变更，阻塞当前 plan。

## 根因
`plan-postcheck.js` 的 `executePlanPostcheck` 用 `resolveChangeDir(cwd, progress, specDir)` 解析变更目录（`run.js:456-472`）：
1. 优先读 `progress.currentChange`（来自 `.sillyspec/.runtime/progress.json`）
2. fallback：唯一非 archive 目录
3. 返回 null → postcheck 回退到 `readdirSync(changesDir).filter(有 plan.md).sort().reverse()[0]`（`plan-postcheck.js:394-397`），取**字典序最大**目录名。

问题链：
- `sillyspec run plan --change <name>` 不把 `currentChange` 写入 `progress.json`（进度实际存 `sillyspec.db`，postcheck 与进度系统脱节）。
- `progress.json` 空 + 多变更 → `resolveChangeDir` 返回 null → 回退 `sort().reverse()` 取字典序最大（`'w' > '2'`，`workspace-*` 排前），校验了错误变更的 task。

次生：postcheck 期望 task 文件在 `changeDir/tasks/` 子目录（`plan-postcheck.js:160`），但 plan step 3 prompt 未明确要求子目录，易写成变更根目录。

## 影响
多变更项目的 plan step 4 被别的变更的 task 格式问题阻塞，无法完成 plan 阶段。

## workaround（已验证有效）
1. 写 `.sillyspec/.runtime/progress.json`：`{"currentChange":"<你的变更名>"}`，让 `resolveChangeDir` 优先匹配。
2. `task-NN.md` 放 `changeDir/tasks/` 子目录（非根）。

## 建议修复（给 SillySpec 维护者）
- `executePlanPostcheck` 接收并使用 `--change` 参数（或从 `sillyspec.db` 读当前变更），不依赖 `progress.json` 回退排序。
- `sort().reverse()` 回退应按 mtime / 进度排序，而非字典序。
- plan step 3 prompt 明确 task 文件放 `tasks/` 子目录。
