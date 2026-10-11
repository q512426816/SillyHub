---
author: flow-machine-draft
created_at: 2026-10-11T09:38:34.760Z
---
# 设计记录（Design Record）— 2026-10-11-sync-conflict-tri-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

三处闭环修复 spec 同步乐观锁冲突的「报而不修、修无入口」断裂：

1. **前端（platform-sync-section.tsx）**：把注册表开放行中「版本冲突面」非空的行，按 conflicting_paths 用 `^changes/(?:archive/)?([^/]+)/` 归因出变更名，去重后并入 renderRows 渲染为 spec 型冲突行——复用既有「查看对比 → ConflictCompareModal → 保本地/取平台」裁决通道。堵「横幅 1 条、区块 0 条、无裁决入口」的口径分裂。
2. **daemon（sillyhub-daemon/src/spec-sync.ts postSpecSyncImpl）**：增量推送收到 conflict=true 且 server_versions 非空时，用响应自带的 server_versions 就地改写**内存**清单缓存（LocalManifest.files[path].version），重算 computeIncrementalOps 并重试恰好一次。多数「他端先推/重复推送」型冲突（生产实证 workflow 工作区：镜像哈希已与本地一致）re-base 后同内容豁免或 base 匹配即全绿；backend 注册表行随全绿自动关闭，形成自愈闭环。真分叉重试仍冲突 → 照旧抛 SpecPushConflict 走人工裁决（此时缺口 1 的行给出入口）。
3. **CLI（sillyspec 仓，跨仓改动）**：`platform sync` 无 --change 从「报错要变更名」改为全树 spec 同步（syncSpecTree 本就是全树 diff，changeName 仅作冲突归因标签，空值时按冲突路径归因：单一变更名兼容 per-change resolve，跨变更归并 'full-tree'）；assertSafeChangeName 字符集扩 CJK `一-鿿`（对齐 assertDatedChangeName slug 集——路径穿越消毒才是该守卫的本职，ASCII 限制是历史误伤，磁盘既有中文名变更由此可同步/裁决）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- **前端**：无 HTTP API 变化。renderRows 数据结构扩展（注册表归因行：`{change, type:'spec-tree', createdAt:注册表行 created_at, qlId:null, isTomb:false}`）；卡头「未决冲突」= renderRows.length。一行多变更名时按名拆行（逐名可裁决），单变更行场景与横幅计数一致。
- **daemon**：无协议/端点/签名变化。postSpecSyncImpl 内部新增一次性 re-base 重试（rebaseManifestVersions 辅助）；SpecPushConflict 抛出条件由「首次 conflict」收紧为「re-base 重试后仍 conflict 或 server_versions 空时的首次 conflict」。
- **CLI**：`platform sync` 无 --change 的 CLI 行为变化（新能力，原为报错）；assertSafeChangeName 对 CJK 放行影响所有经该守卫的入口（run 族 --change、platform sync/pull/resolve）——新建名仍被下游 assertDatedChangeName 日期前缀门约束，不回归。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：成立。re-base 数据取自本次冲突响应（服务端时点值）；重试窗口内他端再推进 → 重试再 conflict → 有界上抛（恰好一次，无活锁）。前端注册表行 60s 轮询最终一致。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：两 daemon 同推一工作区 → 各自按自己的冲突响应 re-base、各重试一次，乐观锁保证不覆盖；均失败则注册表幂等单行（同 stage 只更新不重复建），横幅/区块一致可见。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：安全。re-base 仅改内存对象，中断/崩溃不留半写缓存；磁盘缓存仅由成功路径 buildManifestFromLocal 全量回写（含 hash/mtime 记账单一来源）。CLI 全树同步中断 → 下轮以服务器清单为锚重 diff，幂等。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不会。daemon 清单缓存按 wsId 分键（~/.sillyhub/daemon/manifests/{ws}.json）、注册表按 workspace_id、前端按工作区查询、CLI token 绑工作区——无跨工作区串台面。CLI 侧改动在 sillyspec 仓（跨仓），不触本仓数据。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：daemon 持续真冲突下推送量放大 2×（每次同步 conflict→re-base→再 conflict）——有界一次，可接受；换来「他端先推」型冲突的全自动闭环。

已弃方案：
① daemon 拉 `GET /changes/-/spec-manifest` 做全量 re-base——该端点收紧为 shpsync_ token（CLI 通道）专用，daemon 的 shk_live_ 403；改鉴权面过大，弃（冲突响应自带 server_versions，足够定点 re-base）。
② 冲突即回退全量 tar——违反既有设计 NFR-02「不静默覆盖」，弃。
③ re-base 结果在失败路径落盘——磁盘缓存 hash/mtime 与 mtime 快路径耦合，部分回写易不一致，改为仅成功路径全量回写。
④ re-base 后空 ops 特判分支（review 评审时发现为不可达死代码：op 生成条件与 version 无关，重算 ops 恒与首推同集）——删除，同内容豁免由服务端 apply_ops 承担。

评审后加固（review findings 处置，2026-10-11）：
- P2「重试传输失败落 tar 回退」：已修——重试轮传输类失败转抛 SpecPushConflict（首推冲突面），不落 tar、不写 pending_push（spec-sync-incremental 新用例锁定）。
- P2「非 changes/ 路径归因失败」：**声明边界（可接受）**——注册表版本冲突面全为 docs/、quicklog/ 等非变更路径时（整树同步对象冲突，当前生产无实证案例）前端归因不出变更名不渲染行，横幅仍可见；裁决入口待后续按「路径域」扩展 compare 语义再开，留 knowledge 信号。
- P3「空 ops 分支无关闭时机」：随④删除死代码消解。
- P3「change.patch 冻结件混入并行变更 linked-repo-workspace-ref 的模块文档 diff」：冻结配方=baseline→工作区全量 diff，并行在途变更无法剔除——已知噪音，归档读者以 commit 链（1e8a4a275/c83531fe1/e0b1ce16+评审加固提交）为准。

遗留（记录不修）：经 daemon 通道撞出的冲突，机器 CLI 侧无 sync-conflict 文件，前端裁决指令在机器上可能回执「当前无 sync-conflict 文件」——缺口 2 上线后此类行基本自愈，残余真分叉以对比弹窗两侧内容为准人工处置。
