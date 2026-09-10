# 平台规范目录 junction 迁移：进行中变更的产物分裂/遮蔽事件（2026-09-09）

## 现象

13:26 左右，daemon 规范目录 `~/.sillyhub/daemon/specs/<project-id>` 被迁移工具重指为
junction → 仓库 `.sillyspec/`（另一项目 sillyspec 仓库前一日 21:00 已同模式迁移，应为有意
迁移）。但迁移快照是 12:50 的——进行中的 `2026-09-09-sessions-visual-refresh` 变更在
12:53~13:18 写入的 design.md 全文/requirements/tasks/design-grill/决策修订/三轮审查产物全部
留在旧目录备份里，junction 目标（仓库）只有 12:50 的骨架副本。

## 影响

- 仓库 `.sillyspec/changes/2026-09-09-sessions-visual-refresh/` 只剩 design-init 骨架 +
  旧 decisions + 旧原型，缺 4 个文件、3 个文件过期；
- 独立审查 review.json（pass/pass 终审）写进了 specs 侧备份目录，junction 下不可见；
- QUICKLOG 分裂：junction 后新 CLI 写入在仓库侧新建了小文件（ql-014/015），旧全量历史
  （含 ql-009 P0 视觉条目）在备份侧；
- 并行会话（另一 agent 正在跑后端 quick）同期写入，进一步加剧归属混乱。

## 处置（已手工恢复）

1. 变更七件套自 `~/.sillyhub/daemon/spec-backups/b97f8231.pre-junction-backup-20260909/`
   覆盖回仓库（逐文件核对过新旧）；
2. 填好 verdict 的 review.json 自 `specs/b97f8231.pre-junction-backup-20260909/`（注意：
   存在 specs/ 与 spec-backups/ 两个备份位置，内容不同！）盖入仓库 stage-reviews run 目录；
3. marker 文件与 131058 历史 run 一并恢复；
4. QUICKLOG 按内容合并（备份全量 + 仓库 014/015 追加），008~015 连续；
5. docHash（sha256 design.md）与终审 review.json 一致性校验通过；
6. brainstorm --done 后 CLI [sync] 自动把变更同步回平台 DB——变更中心可见。

## 对工具的改进建议

- 迁移前应先做全量快照再切 junction（本次快照落后进行中写入 30 分钟）；
- 迁移期间应阻止/暂停 CLI 写入（或迁移后立即比对两侧 mtime 差异报警）；
- 备份位置应唯一（specs/ 与 spec-backups/ 双份且内容不一致，极易拿错）。

状态：活跃坑（待工具修复确认后可移 finished/）。

## 巡检注记（2026-09-10 定时扫描）

- 迁移工具定位：`pre-junction-backup` 命名与 junction 切换逻辑**不在两仓源码内**（daemon.ts 无此字符串）——本次迁移为运维侧操作过程，三条改进建议（先全量快照再切/迁移期阻止 CLI 写入/备份位置唯一）暂无代码归属方。定位到工具本体（或 daemon 官方化迁移路径立项）前保持活跃；若属一次性运维动作不再复现，可由管理员裁决归档。
