---
author: qinyi
created_at: 2026-08-19 11:50:00
status: fixed
fixed_at: 2026-08-19 12:40:00
fix_commits: ba84b48（sillyspec 仓，缺陷①）+ 主仓 ql-20260819-004-695a（缺陷②）
---

# quick --done 轻量归档误伤进行中变更 + un-archive 愈合同步永久冲突

**发现日期**：2026-08-19（cross-workspace-team-mission 变更在平台显示进归档目录，用户提问追查实证）
**状态**：已修复（① sillyspec 仓 ba84b48 阶段完成态闸；② 主仓 ql-20260819-004 软删行复活语义；数据已协议级修复）。backend 容器重建部署后服务端修复生效。

## 事故链（时间均为本地时间）

1. **10:18:32** quick `ql-20260819-002-4c90`（给变更补原型图）以 `--linked-changes 2026-08-19-cross-workspace-team-mission` 启动。
2. **10:22:02** quick `--done` 收尾触发 `closeQuickLinkedChanges` 轻量归档：
   - 阶段闸读到 `current_stage='brainstorm'`（plan 10:25:09 才开始，**brainstorm 完成→plan 开始之间是闸门放行空窗**）；
   - `isChangeTasksComplete` 判真——该 tasks.md 是 **propose 骨架**，除 quick 追加的 `- [x] ql-…` 行外**没有任何 `- [ ]` 行**，"无未勾选框=全勾"启发式对骨架恒真；
   - → 整目录被移动到 `changes/archive/2026-08-19-cross-workspace-team-mission/`，本地 DB `status='archived'`。
3. **10:22:07** `--done` 的 spec 树同步把搬家推上平台：4 个内容未变文件走 **rename op**，tasks.md（勾选翻转改了哈希）走 delete+add。**服务端只落了 tasks.md 的 delete+add + QUICKLOG，4 个 rename op 未落盘也未报冲突**（见疑点③）——服务器磁盘上归档目录里从此只有一个 stray `tasks.md`。
4. **10:23:42** quick 会话（agent）发现误归档，`git mv` 把目录搬回活跃区——**但只修了文件层**：本地 DB status 仍 'archived'，平台不知情。
5. **10:25 起** plan/execute 会话每次 `--done` 同步都会计算"愈合 rename"（本地 active tasks.md 哈希 == 平台 archive tasks.md 哈希 → rename archive→active）——服务端 rename 分支发现目标路径存在**软删行**（exists=f）→ `target_row is not None` → **conflict 跳过**。此后每次同步都重复此冲突（其它 op 部分应用、CLI warn 一句没人看见）→ **un-archive 愈合永久卡死**。
6. reparse 扫到服务器归档目录里的 stray tasks.md → `changes` 行 `location='archive'` → **平台把进行中变更显示进归档目录**。

## 缺陷清单

### ① sillyspec CLI：轻量归档对进行中变更误触发（根因）——已修复（ba84b48）

`src/run/complete-handlers.js` `closeQuickLinkedChanges`：
- `QUICK_CLOSE_ALLOWED_STAGES = ['', 'scan', 'brainstorm']`——brainstorm **已完成**、即将进 plan 的变更不是"从未进入完整流程的僵尸"，但闸门只看 current_stage 不看 stage 完成态，空窗期放行。
- `isChangeTasksComplete` 用"无 `- [ ]` 未勾选行"判"全部完成"——propose 骨架 tasks.md 没有任务行，恒真。

**修复（已落地）**：`getChangeStage` LEFT JOIN stages 带出 `stage_status`（无阶段行归一 null 向后兼容），闸门对 `stage_status='completed'` 一律 skip 走原流程收尾。**不动** `isChangeTasksComplete`——只有 ql 行的「真僵尸」逃生通道（d192f89 原始场景）必须保留，任务行计数收紧会误伤它。

### ② backend：rename 到软删目标行永久冲突（卡死主因）——已修复（ql-20260819-004-695a）

`app/modules/spec_workspace/service.py` `apply_ops` rename 分支：`target_row = manifest_by_path.get(op.new_path)`——目标路径的 **exists=f 软删行**也算占用 → conflict。归档→恢复方向的 rename（un-archive 愈合）永远命中。

**修复（已落地）**：①rename 目标软删墓碑不算占用，rename 结果**原地复活墓碑**（不走「删墓碑+插新行」——SQLAlchemy flush 先 INSERT 后 DELETE，同 path 撞 `ux_spec_manifest_ws_path` 唯一约束）；R-07 无旧行 rename 落墓碑同款。②顺带修 add 落软删行：原同内容豁免 no-op 留僵尸 exists=f / 异内容判 conflict，现写盘+原地复活（version+1）。`TestSoftDeleteRevival` 4 用例守护。

### ③ 疑点：4 个 rename op 服务端蒸发（机制未定）——隔离不可复现，已加守护

02:22:07 请求含 4 个 rename（active→archive，base_version 匹配、无冲突返回、CLI 报"已同步 7"），但服务端清单/磁盘均无痕迹。修复②时按事故原形状写组合用例（单请求 rename+delete+update+add）**全落盘通过**——隔离环境不可复现，倾向环境因素（当日并发 115s 长请求 02:18:34-02:20:30 / Windows bind mount 时序）。组合用例留作回归守护，若再现实证需抓请求体级日志。

### ④ reparse 对归档目录的敏感性

`changes/archive/<name>/` 下**一个文件**就足以把整个 change 翻到 archive 区；且软删后残留的**空目录**也会维持 archive 判定（本次需 rmdir + 再触发全量 reparse 才翻回 active）。

## 数据修复实录（已执行，2026-08-19 11:45-11:55）

1. 协议级愈合（shpsync_ token POST `/api/changes/-/spec-sync`）：
   - `update` active tasks.md（base_version=2，本地内容）→ v3 复活；
   - `delete` archive tasks.md（base_version=1）→ v2 软删 + 触发全量 reparse。
2. `rmdir` 服务器上残留的空归档目录（Git Bash 路径须写 `//data/...` 防 MSYS 转换）。
3. 再发一个幂等 archive delete（base=2）触发第二次全量 reparse → `changes.location='active'` ✓。
4. 本地 sqlite：`UPDATE changes SET status='active' WHERE id=4308`（registerChange 设计上不复活归档行，只能直改）。

验证：清单 active tasks.md v3 exists=t / archive v2 exists=f；changes 行 location=active；本地 DB status='active'、current_stage='execute'。

## 关联

- [[sillyspec-quick-done-session-id-misbind]]（同 quick 收尾家族坑）
- 坑文档惯例：sillyspec 仓侧修复落地后移 `finished/`
