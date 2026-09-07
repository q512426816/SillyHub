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

## 巡检注记（2026-09-05 定时扫描）

**SillySpec 侧修复已在 sillyspec 仓工作区在途落地（另一会话、未提交）**，覆盖「待修复建议」前三项中的核心：
- 缺陷 A（--done 静默 fork）：`run/command.js` 新增 `doneLikeTargetMaterialized`（物化口径：普通变更=changes/ 目录或 archive 目录；quick=会话 guard）+ done-like 动作（--done/--skip/--wait/--continue/--reset/--reopen）存在性守卫——目标未物化时 exit(2) 拒绝静默新建，报错文案含当前库/指针模式/活跃列表/排查三路；配套 `test/done-phantom-change-guard.test.mjs`。
- 缺陷 B（repair 失明）：`src/progress/consistency-doctor.js` 在途修改 + 新增 `test/progress-repair-dual-library.test.mjs`（双库分裂维度）。

**复审两点（供在途会话参考，未动其代码）**：
1. `doneLikeTargetMaterialized` quick 分支疑似实现缺口：文档注释承诺「legacy 单文件 guard 无法归属会话 → 保守认物化（宁可漏拦不误杀）」，实现只查 per-session `guard.json` 且残留一行死代码 `return`——legacy 会话会被误判幻影拒掉（与注释意图相反），且 unreachable return 可能挂 lint。建议补 legacy 兜底 `return true` 并删死行。
2. 同日变体第 3 点（quick 兜底应**复用启动分配的 ql-ID** 而非补分配新号，防落码引用劈叉）暂未见在途覆盖（complete-handlers.js 兜底路径仍是「补分配」语义）——待补。

**daemon 侧（环境待定）**维持定性：respawn 重建接管指针的拓扑约定属平台设计决策，未动。待在途会话提交发版后，下轮巡检复核归档。

## 处置记录（2026-09-07 定时收口，SillySpec 侧全数落地，归档）

- **缺陷 A（--done 静默 fork，直接元凶）**：已提交（sillyspec 仓 69369a0）——`doneLikeTargetMaterialized` 物化判定（普通变更=changes/ 或 archive/ 目录；quick=per-session guard 或 legacy 单文件兜底「保守认物化」）+ 六种 done-like 动作存在性守卫，目标未物化 exit(2) 拒绝静默新建；`test/done-phantom-change-guard.test.mjs` 21 断言全绿。巡检复审点 1（legacy 兜底缺失 + 死代码）已由该会话修复。
- **缺陷 B（repair 失明）**：已提交——`test/progress-repair-dual-library.test.mjs` 双库分裂维度 18 断言全绿。
- **同日变体第 3 点（quick 兜底 ql-ID 劈叉，巡检复审点 2）**：本轮（定时扫描）补齐——`progress/change-registry.js` 新增 `getQuicklogId` 读取（changes.quicklog_id，启动时 stage.js 回填）+ `progress.js` 委托 + `quicklog.js` 新增 `appendQuicklogEntryWithId`（以给定 ID 补建「进行中」骨架，幂等、同锁同格式同平台推送）；`complete-handlers.js` 兜底优先复用启动 ql-ID，条目不在当前库用原 ID 补建（启动/完成分裂库形态单 ID 收敛），库中也无才补分配。`test/quick-session-guard-cleanup.test.mjs` 新增验收 4（guard+QUICKLOG 双缺事故形态，断言仅一份文件、单条目=启动 ID、已翻完成），全套 26 断言绿；quick/quicklog 回归 62 用例零失败。
- **指针基数跳变告警（483→0 tripwire）**：未实现——破坏路径已被缺陷 A 守卫 fail-closed、分裂可被 repair 检出，该告警属锦上添花的咨询项，留档不阻塞。
- **daemon 侧拓扑约定（respawn 重建接管指针）**：维持「环境侧待定」定性——平台设计决策（不应静默接管 vs 接管时合并），随文件归档备查；复发时恢复路径见本文件第 4 节（已实证可复用）。

所有 SillySpec 侧改动中 69369a0 已提交；本轮 ql-ID 复用修复在工作区未提交（改动文件与在途 endpoint-baseline 变更无重叠），供审阅。
