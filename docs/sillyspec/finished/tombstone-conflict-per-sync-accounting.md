# 墓碑拒收冲突三缺陷（按同步标签记账 / UI 不露根因 / 平台删除无本机收敛）

> 记录时间：2026-10-09 · 来源：阿里云平台侧 91 条未决同步冲突排查（sillyspec 仓 c84182bc 工作区）
> 状态：活跃坑（本次已按路线 B 人工收口：本地删 salv 留证目录 db3d6ea8 + 清 91 条记录 + doctor 清 ghost；机制未修，可复发）

## 事实（2026-10-09 实证）

- sillyspec 仓 `.sillyspec/.runtime/` 攒了 91 条 `spec-sync-conflict-*.json`，**全部**为纯墓碑形态
  （`conflicting_paths` 为空、`platform_deleted` 并集只有 `changes/salv/tasks/task-01.md` 与
  `changes/salv/verify-result.md` 两个路径）——一个根因伪装成 91 个不同变更的冲突。
- 该仓 spec 镜像自 09-29 起冻结：整批推送被防复活守卫（`platform_sync/service.py` `_change_key_deleted`）
  全拒，任何文件都落不了（与 2026-09-25 runbook `finished/spec-push-conflict-recovery-runbook.md`
  记录的是同一类病：镜像冻结 + 知识命中断流）。

## 缺陷一：纯墓碑拒收按「当轮同步标签」记账，不归因到被删变更（sillyspec CLI）

现象：spec 同步是整树 diff 一次性 POST（`spec-sync.js` `walkSpecTree` → `computeSpecOps`），
`--change` 只是标签不隔离路径；墓碑路径永远算脏 → 每批必拒 → 每次按当轮标签落一条
`spec-sync-conflict-<当轮变更名>.json`。这批变更随后归档，再也不会以同名同步成功，
`clearSpecConflictMarker` 永远没机会清它们 → 记录单调累积，永不自清。

期望修复：纯墓碑形态（版本冲突面为空）时按**被删变更**归因记账——每被删变更一条记录
（或聚合成单一根因清单），并在横幅/状态直接指向真凶；避免 N 条无信息量记录。

## 缺陷二：冲突记录里的 platform_deleted / note 字段，前端不消费（platform frontend）

现象：记录内容已带 `platform_deleted` 路径与「resolve 重推无效，走 manifest-heal」note，
但变更中心冲突行只展示 变更名+type+时间——91 条墓碑噪音看不出是同一个 salv，
用户视角等于 91 个独立问题；「保本地/取平台」裁决入口照常给出但对该形态必然无效。

期望修复：冲突行读取 `platform_deleted`/`note`，命中时改展示「非版本冲突 · 平台已删除
（N 路径）」并给 heal/本地清理指引，隐藏（或降级）无效的 resolve 裁决入口。

## 缺陷三：平台侧删除变更无本机收敛通道（platform + daemon）

现象：平台删除变更写墓碑（`change/service.py` `_soft_delete_change_dir`），但 daemon
sillyspec 指令集只有 `resolve` / `ghost_cleanup` 两个 action，没有「变更已删，请收敛本地
目录」指令——平台删了、本机留着目录（或事后从 git 历史/救援件把路径带回本地，salv 即此），
就进入死循环：每批必拒 → 镜像冻结 → 记录累积，只能人工发现并拍板（heal 或本地 rm）。

期望修复（任一即断根）：① 平台删除流程向绑定数据源机器下发本地目录收敛指令
  （daemon 新 action）；② CLI 遇纯墓碑拒收且本地路径在位时，横幅给出一键处置
  （本地 rm 留证 git / 提示管理员 heal）。

## 复发条件（修工具前的事实风险）

1. 平台 UI 删除变更，本机目录未同步删除（无自动通道）；
2. 本地从 git 历史/救援分支恢复平台已删路径（本次 salv 的触发方式）；
3. 归档相关边角 bug（历史冤案墓碑一类，2026-09-23 已修过一例，不敢保证绝迹）。

## 附：快速识别与处置（运维口径）

- 识别：冲突记录 `conflicting_paths` 空 + `platform_deleted` 非空 = 墓碑拒收，非版本冲突，
  `resolve --keep-local` 无效；
- 处置 A（认平台删除）：本地 `git rm` 对应目录 + 删 `.runtime/spec-sync-conflict-*` 陈旧
  记录 + `doctor --cleanup-ghosts --confirm` + 重同步（2026-10-09 已验证全绿）；
- 处置 B（保本地）：平台恢复变更 + `POST /spec-workspace/manifest-heal` 清墓碑 + 重同步；
- 预防习惯：同一工作区保持单写者（daemon 自动同步或 CLI 手动同步二选一，runbook 教训）。


## 执行期发现：CLI 跨仓 trace 绑定悬空（2026-10-09 续）

 的机器 candidate 行从跨仓 task 卡（repo: sillyspec）target_files 抄 tests 路径（仓根相对），verify 实测门  用**主仓 cwd**  解析 → 跨仓路径恒悬空 fail-fast；修理工  对变更期局部锚（FR-01）只读不可删。期望修复：行携 repo 归属（或 tests 记跨仓限定路径），悬空判定与残差执行按行 repo 解析。绕过：行标 superseded + verify-result 矩阵承接证据。


## 执行期发现：verify 收口 13 轮 gate 回滚 / 实测重复执行 45 分钟（2026-10-09 续）

**现象**：verify 阶段总耗时 72 分钟，其中实测门累计执行 13 轮 × ~3.5 分钟 = 45 分钟纯测试时间（动态子集 144 文件：deps 86+FR 关联回归 67+跨仓 npm test）——代码零改动的文档/声明修正轮也全量重测，12/13 轮实测为纯重复。CLI friction-tally 自记 gate 回滚 13 次。

**根因（双层）**：
1. 产物侧（8 处声明偏差触发重跑）：执行期落点裁决（测试文件就近扩展/零改动文件）未同步回写 design 清单与 task 卡 target_files → apply 对账/verify 对账逐处拦截；verify-result 移交表缺类型列/矩阵锚点形态不符。每处=1 轮 --done 重跑。
2. 工具侧（放大器）：①门禁「逐门报错」——一轮只报当轮撞的门，修完重跑又撞下一个（「一次性全列」提示直到后段才出现）；②每轮 --done 无实测缓存/增量——文档面修正也触发完整 3.5 分钟实测面；③跨仓三层主仓视角缺陷（wt-commit 不认跨仓 worktree/trace 路径主仓解析悬空/对账锚点窗口 HEAD~1..HEAD 对多笔提交假信号）。

**护栏建议**：①执行期任何落点/范围裁决当场回写 design 清单+task 卡 target_files（本变更 8 处欠账的教训）；②verify 门禁首轮即全列所有未过项（已有机制前移到首撞）；③实测结果按代码 diff 指纹缓存——git HEAD+scope 文件未变的重跑直接复用上轮结论；④跨仓 task 的 trace/对账/wt-commit 按行 repo 归属解析。

**证据**：.sillyspec/.runtime/verify-runs/2026100905*~06* 共 19 个 run 目录、13 个 test-result.json 累计 2701s；friction-tally-2026-10-09-tombstone-conflict-root-fix.json gate 回滚 13 次。

## 处置记录（2026-10-10）

**三缺陷已全部断根**（`2026-10-09-tombstone-conflict-root-fix`，5 任务 6 提交两仓，
verify PASS WITH NOTES，归档 75c673dbd）——本日逐项复核验证：

1. **缺陷一（CLI 归因记账）✅**：`41edfc3e`——纯墓碑拒收按**被删变更**落
   `spec-sync-conflict-<被删变更>.json`（幂等合并 + kind=tombstone），不再按当轮同步
   标签累积；全绿轮自动清理陈旧纯墓碑记录（kind 无关判定）；横幅按被删变更单根因
   叙事。本日复跑归因矩阵 + 回执 + 横幅去重套件 14/14 绿。
2. **缺陷二（前端不露根因）✅**：`e0999476`——冲突行消费 `platform_deleted`/`note`，
   墓碑形态改「非版本冲突 · 平台已删除」三态展示（混合行 `conflicting_paths ∖
   platform_deleted` 判定，不误 hide 有效裁决入口）。本日复跑
   platform-sync-section.test.tsx 20/20 绿。
3. **缺陷三（无本机收敛通道）✅**：backend 指令通道（`dc2397a3`）+ 平台删除环下发
   （`93c61da3`+`86fa83cce`）+ daemon 执行器（`c2a42fcb`）——`tombstone_cleanup`
   action 收敛本机目录至 `.runtime/tombstone-quarantine/` 隔离区留证。

**遗留（设计 backlog，坑内执行期发现，随变更归档留档）**：① CLI 跨仓 trace 绑定悬空
（行携 repo 归属解析——绕过已记录：行标 superseded + verify-result 矩阵承接）；②
verify 13 轮 gate 回滚 postmortem 的四条护栏建议（落点裁决当场回写/首轮全列/实测
diff 指纹缓存/跨仓按行 repo 解析）——均提案级，需要时另立变更。归档。
