# daemon spec-sync 平台接管指针把 CLI 重定向进空缓存库——`--done` 静默新建幽灵进度，仓库真库被旁路

- **日期**：2026-09-04
- **状态**：活跃（工具缺陷 + 环境事故，待修复/待定拓扑约定）
- **影响命令**：所有 `sillyspec run *` / `progress show`（仓库根裸调）

## 现象

2026-09-04 21:55（本机 daemon 当晚多次 respawn 之后），`sillyspec run brainstorm --done --change 2026-09-04-conflict-resolve-entry` 执行后 `progress show` 显示该变更为全新 1/8 周期（step 1「进度确认」的 output 恰是刚才那条 --done 的 output），步骤 2-7 的完成记录与历史用户回答「全部消失」。

## 根因（实证）

1. daemon 侧 spec-sync（重新）init/scan 在仓库根写下了平台接管声明：`.sillyspec-platform.json`（specRoot 指向 `~/.sillyhub/daemon/specs/<workspaceId>`）+ `.sillyspec-platform-managed`（declaredAt 21:57:13Z，specRoot/.runtime 整树 mtime 21:55:25）。platform 连接配置（url/token）在 `.sillyspec/local.yaml`，与指针文件无关。
2. 指针生效后，CLI 的进度库从仓库 `.sillyspec/.runtime/sillyspec.db`（483 changes，含全部历史）重定向到 `<specRoot>/.runtime/sillyspec.db`（**新建空库**）。
3. **缺陷 A（静默 fork）**：`run --done` 对空库中不存在的 change 不报「change not found」，而是自动创建 change + stage 并把本次 --done 记成 step 1「进度确认」——幽灵周期就此诞生，且随即 auto-sync 推上平台（服务器进度行被幽灵覆盖，last_pushed 21:55:49Z）。
4. **缺陷 B（repair 失明）**：`sillyspec progress repair` 报「未发现问题」——它只查元数据一致性（指针/孤儿行），不查「步骤-产出对齐」与「双库分裂」。
5. 连锁风险：本地行处于「已同步且无本地改动」状态时（last_synced ≥ last_local_modified），下一次 auto-pull 会把平台上的幽灵进度**快进导入**仓库真库，把真库也冲掉。

## 恢复路径（本次实操，供复用）

1. 备份并删除仓库根两份指针文件（备份在 `.sillyspec/.runtime/rescue-20260904-platform-takeover/`）；doctor 提示 managed-但-指针缺失会 fail-closed，所以两个文件必须一起删。
2. 清除幽灵产物：`<specRoot>/.runtime/`（整树当晚新建）与 `<specRoot>/changes/<变更名>/`（空壳目录）。
3. 立即在真库产生本地写入（继续推进步骤），使 last_local_modified 越过 last_synced——**抢在 auto-pull 快进之前**。
4. 推送会 409 落 sync-conflict 文件 → `sillyspec platform resolve <变更名> --keep-local`（本地权威，自动重推闭环）→ `platform status` 复核「本地与平台进度同步」。

## 待修复建议（SillySpec 侧）

- `run --done` 在「change 不存在于当前进度库」时应报错或要求显式 `--create`，禁止静默新建（本例直接元凶）。
- 接管切换生效时（指针写入/刷新），应校验目标库与源库的变更基数差异并警告（483 → 0 的跳变不可能正常）；或接管时做一次 progress 迁移/导入而不是留空库。
- `progress repair` 增加「步骤记录 vs 变更目录产出（design/decisions/prototype）对齐」与「接管指针导致的双库分裂」检查维度。
- `platform pointer --cleanup` 只清 >24h 过时指针，对「分钟级新接管但目标库为空」的明显事故形态无能为力。

## 环境侧待定（SillyHub daemon 侧）

daemon respawn 后重新 init/scan 绑定 workspace 会重建接管指针——若仓库真库才是工作拓扑（当前事实），需要明确：daemon 不应在仓库已有本地进度库时静默宣布接管；或接管时先做进度合并。否则同一事故会随 daemon 重启复发。

## 同日变体：quick 会话 guard 缺失 → --done 兜底劈出双 QUICKLOG 条目（2026-09-04 22:14）

同一指针环境下的 `sillyspec run quick` 变体（会话 quick-501b6f72，工作区 spec 策略修改）：

- **现象**：启动时 CLI 把「进行中」条目（ql-20260904-001-a579）写进**平台侧** `<specRoot>/quicklog/QUICKLOG-qinyi.md`；三步推进正常（`--status` 走平台库）；但 step3 `--done` 找不到会话 guard.json（平台 specRoot `.runtime/quick-sessions/` 下无该会话目录），报「QUICKLOG 兜底补写: ql-20260904-028-3cb5（guard 缺失/brownfield 会话）」——在**仓库侧** `.sillyspec/quicklog/QUICKLOG-qinyi.md` 新建了一条全新 ql-ID 的完成条目。同一次会话产生两个 ID、两份文件各半：启动元数据在平台文件、四字段正文在仓库文件。
- **人肉缝合**：以仓库侧完成条目（028-3cb5，git 跟踪）为准；代码注释/测试/模块文档里按启动分配 ID 写的引用全部 sed 成 028；平台侧过期「进行中」骨架（001-a579）清空。step2 首次 `--done` 还出现过一次「不生效重放 step2 prompt」的吞输出（重跑同命令即过，疑似同一根因）。
- **待修复补充**：quick 启动与 --done 应从同一 specRoot 解析 quick-sessions guard 与 QUICKLOG 落点；guard 缺失时兜底应复用启动分配的 ql-ID（进度库里可查），而不是分配新 ID 制造引用漂移——落码注释/模块文档的 ql-ID 是启动时就给出的，兜底换号必然劈叉。
