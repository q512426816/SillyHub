---
author: qinyi
created_at: 2026-07-01 22:50:00
type: sillyspec-tool-bug
---

# sillyspec CLI 平台模式 archive 流程删除变更目录（非归档）

## 现象
平台模式（daemon specDir 为活跃 specDir）下，`sillyspec run archive --done --confirm` 输出：
```
📦 已归档：2026-07-01-changes-align-sillyspec → archive/2026-07-01-2026-07-01-changes-align-sillyspec/
✅ archive 阶段已完成（5/5 步）
```
但实际：
- daemon specDir 的 `changes/2026-07-01-changes-align-sillyspec/` 目录**消失**（不在 active）
- `changes/archive/` 目录**不存在**（未创建）
- sillyspec.db 的 `changes` 表里该 change 记录被**删除**（unregisterChange 执行了）
- 归档目标目录 `archive/2026-07-01-2026-07-01-changes-align-sillyspec/` **不存在**

即：archive 的「移动到 archive/」实际是「删除源目录 + 删 db 记录」，归档目标未创建。

## 影响
- **变更过程文档全部丢失**：design.md / plan.md / tasks/*.md / decisions.md / proposal.md / requirements.md / prototype.html——这些写在 daemon specDir/changes/<change>/ 下，archive 把整个目录搞丢。
- 代码未受影响（execute 产出已 merge main，在 git 历史）。
- sillyspec.db 的 change 记录被 unregister，无法再 `sillyspec run <stage> --change <X>`（报"未找到变更"）。

## 根因推测
`archiveChangeDirectory`（sillyspec/src/run.js）平台模式下：
- `renameSync(srcDir, archive/<date>-<change>/)` 的 `srcDir` 解析正确（daemon specDir/changes/<change>）
- 但 `archive/` 目标目录创建在**不同 specDir**（可能源码 .sillyspec/changes/archive/ 或解析错误路径），或 `mkdir -p archive/` 在 daemon specDir 失败但未报错
- `unregisterChange`（删 db）照常执行
- 结果：源目录 rename 失败/移到错处 + db 删了 → 目录看似消失

需 sillyspec 工具作者核实 `archiveChangeDirectory` 在平台模式（specDir pointer）下的路径解析。

## 复现步骤
```bash
# 平台模式（源码 .sillyspec/ 存在 + daemon specDir 活跃）
sillyspec run archive --done --confirm --change <X>
# 输出 📦 已归档 → archive/<X>/
# 实际：daemon specDir/changes/<X>/ 消失，archive/ 不存在，db changes 表无 <X>
```

## 建议修复（待工具作者）
- `archiveChangeDirectory` 平台模式下，archive 目标路径必须与 srcDir 同一 specDir（daemon specDir/changes/archive/），遵循 `.sillyspec-platform.json` pointer。
- rename 前先 `mkdir -p` 目标目录并验证可写；rename 失败则不执行 `unregisterChange`（保 db 记录，可重试）。
- 或：archive 前自动 backup 变更目录到 specDir 外（防丢）。

## 本项目规避
- execute 产出（代码）及时 merge main（commit `197c53d7`/`1adbcb39`），不受 archive bug 影响。
- 变更文档丢失不可逆，重建仅能在 `changes/archive/<change>/` 放 verify-result.md + README 说明（过程文档内容从对话历史/记忆恢复）。
- 后续 sillyspec archive 前应手动 `cp -r changes/<change> changes/archive-backup-<change>` 防丢。

## 关联
- 与 `runtime-cleanup-destroys-worktree-meta.md`（3.20.5 已修）、`progress-specdir-drift.md` 同属 sillyspec CLI 平台模式缺陷系列。本 bug 在 3.20.5 仍存在。
