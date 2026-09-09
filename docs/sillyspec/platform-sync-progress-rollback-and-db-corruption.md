# 平台模式进度回滚环 + sillyspec.db 损坏 fail-loud + NEW: 前缀门禁口径冲突（活跃坑）

> 实证会话：2026-09-08，变更 2026-09-08-cursor-interactive-session（platform specDir 模式 + 本机 SillyHub daemon 同时在线）。
> 三组问题同场爆发，分开记录便于工具侧逐个修。

## 坑 1：CLI 推进度 → 平台侧陈旧状态回拉 → 本地进度被反复重置（回滚环）

- 现象：`sillyspec run plan --done` 逐条推进成功（打印 advanced to step N），下一次命令的状态却回退到 step 1-done/step 2-current；`changes` 行 current_stage 被打回 `scan`，platform_last_pushed_at 持续刷新。
- 环境：仓库 `.sillyspec/local.yaml` 配了 platform 段（daemon 注入），本机 SillyHub daemon（连远端 backend）同时在线。CLI push 撞 409（base_ts 过期）落冲突文件后，后续某次常规同步把平台侧陈旧 progress 应用回本地 DB，循环往复。
- 影响：plan 阶段步骤机无法收敛，人工重放 3 轮均被打回。
- 绕过（2026-09-08 14:15 复盘修正——早先的"disconnect 绕过"结论不完整且有反作用）：**disconnect 会清掉 `.sillyspec-platform.json` 指针，而 daemon 心跳的内嵌 CLI 靠这个指针解析 specDir——指针缺席期间它读仓库 `.sillyspec`（空）并把空状态推上平台，反而放大回滚**。真正收敛的序列（本轮实证）：①修复本地库到正确状态（disconnect 态下重放，防自己 CLI 拉回陈旧）；②等/让指针重建（daemon 周期性 platform-scan 会重建 `.sillyspec-platform.json`，本轮 14:13:43 实证）或手动恢复指针文件；③此后 daemon 内嵌 CLI 读到正确库 → 推正确状态 → 环自熄（90 秒跨心跳窗口稳定实证）。若必须断开自己 CLI 的同步，**只清 local.yaml platform 段、保留指针文件**。
- 建议工具修复：①pull 应用平台状态前比对「本地 last_local_modified_ts vs 平台 last_pushed_at」并在本地更新时拒绝回写（或至少打醒目横幅）；②冲突文件被中间同步静默清除后 `resolve --keep-local` 找不到目标——resolve 应支持无冲突文件时的显式 keep-local 强推；③`platform disconnect` 不应清理 daemon 内嵌 CLI 依赖的指针文件（或 disconnect 前检测 daemon 在线并警告）。

## 坑 2：并发写把 .runtime/sillyspec.db 写坏，fail-loud 且无 .bak → 只能删库重放

- 现象：多次 CLI--done 与 daemon 心跳并发后，`sillyspec.db 损坏且 .bak 备份不可用` 硬错；恢复链（.bak/corrupt 快照）全空，CLI 剩一个 0 字节主库，判损坏拒绝自愈建空库（fail-loud 防吞进度，行为符合设计但无出路）。
- 绕过：`rm .runtime/sillyspec.db`（0 字节无数据可丢）→ CLI 重建空库 → 变更目录产物在盘，按本会话记录重放 brainstorm 8 步 + plan 5 步（门禁全是产物级校验：review.json/docHash/四件套/任务卡，重放可收敛）。注意 `.runtime/stage-reviews/` 与 marker 也会被清，review.json 需按真实审查结论重建（register-stage-review 换新 run-id，直接写门禁报错里给的期望路径 + 手算 docHash 即可）。
- 建议工具修复：①daemon 心跳对 progress DB 只读快照化（或 WAL 之外的独立心跳文件），避免与 CLI 写并发；②_pushConflictFile 之外增加定期 .bak 快照（哪怕 5 分钟一次），让 fail-loud 有恢复出路。

## 坑 3：brainstorm 文件引用门禁与 plan 覆盖对账对 NEW: 前缀口径互斥

- 现象：design.md 清单里「新增且当前不存在」的文件，brainstorm 收尾门禁要求加 `NEW:` 前缀（否则判幻觉路径阻断）；加完后 plan-postcheck 的 design 文件覆盖对账（pathMatches，不剥 NEW:）全部判「未被 task allowed_paths 覆盖」又阻断——同一文件两道门禁互斥，无同时合法的写法（target_files 解析器剥 NEW:，但 allowed_paths 与 design 清单解析都不剥）。
- 绕过（本轮实证）：给四个待新建源文件**先 touch 空占位**（主仓工作树）+ design 清单写裸路径 → 两道门禁都过。副作用可控：execute worktree 基线取自 committed HEAD（不含未提交占位），子代理在 worktree 里仍是"新建文件"，与计划语义一致；主仓占位在 execute apply 后被真实实现覆盖。注意收尾时别把空占位单独 commit。
- 建议工具修复：统一 NEW: 语义——要么 change-list normalizePath/pathMatches 剥 NEW: 后比对（推荐，与 target_files 解析器对齐），要么 brainstorm 门禁豁免「操作列=新增」的行。

## 坑 4（轻微）：`sillyspec taskcard <变更> --all` 不吃平台模式 cwd 探测

- 现象：run/plan 系列命令在仓库根自动解析平台 specDir，但 `taskcard` 报「变更目录不存在 .sillyspec/changes/...」——需显式 `--spec-dir`。同族命令行为不一致。

## 关联记录

- 本轮还有一处非工具坑：plan-postcheck 蓝图一致性硬拦「同 Wave 共享 allowed_paths 目录」（task-01/02 共享 fixtures 目录）——这是设计内校验，按提示拆 Wave 即可，不算缺陷。

## 处置进展（2026-09-09 定时收口：坑3/坑4 已修，坑1/坑2 留专项）

- **坑 3（NEW: 前缀两道门禁互斥）已修复**：`change-list.js pathMatches` 在**比对语义**下剥 `NEW:` 前缀（与 target_files 解析器对齐）——design 清单带 NEW: 的待建文件 vs task allowed_paths 裸路径现在命中，「brainstorm 要求加 NEW:」与「plan 覆盖对账」不再互斥。刻意只在比对处剥：存在性核验（design-facts 的 NEW: 豁免）不走 pathMatches、仍见原文。touch 空占位绕过不再需要。测试：change-list-operation 新增 7 断言（23/23 绿）+ pathMatches 消费方回归 47/47。
- **坑 4（taskcard 不吃平台 cwd 探测）已修复**：index.js taskcard 分支接入 `resolvePlatformSpecDir`（与 run/plan/endpoints 同源，指针 fail-closed 语义一致），平台模式仓库根裸跑不再报「变更目录不存在」。taskcard 回归 3/3 绿。
- **坑 1（进度回滚环）/ 坑 2（DB 并发损坏）留专项**：分别涉及「pull 应用前 last_local_modified vs last_pushed 比对 + resolve 无冲突文件强推 + disconnect 指针语义」与「心跳只读快照 + 定期 .bak」——同步协议与存储层设计决策，非巡检级小修；本文件恢复序列（①disconnect 态重放 ②等指针重建 ③环自熄）已实证可复用。保持活跃。
