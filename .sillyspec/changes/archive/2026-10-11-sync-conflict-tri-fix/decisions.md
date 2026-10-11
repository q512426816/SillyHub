---
author: flow-machine-draft
created_at: 2026-10-11T10:56:21.702Z
---
# 决策记录（Decisions）— 2026-10-11-sync-conflict-tri-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：daemon 持续真冲突下推送量放大 2×（每次同步 conflict→re-base→再 conflict）——有界一次，可接受；换来「他端先推」型冲突的全自动闭环。 已弃方案： ① daemon 拉 `GET /changes/-/spec-manifest` 做全量 re-base——该端点收紧为 shpsync_ token（CLI 通道）专用，daemon 的 shk_live_ 403；改鉴权面过大，弃（冲突响应自带 server_versions，足够定点 re-base）。 ② 冲突即回退全量 tar——违反既有设计 NFR-02「不静默覆盖」，弃。 ③ re-base 结果在失败路径落盘——磁盘缓存 hash/mtime 与 mtime 快路径耦合，部分回写易不一致，改为仅成功路径全量回写。 ④ re-base 后空 ops 特判分支（review 评审时发现为不可达死代码：op 生成条件与 version 无关，重算 ops 恒与首推同集）——删除，同内容豁免由服务端 apply_ops 承担。 评审后加固（review findings 处置，2026-10-11）： - P2「重试传输失败落 tar 回退」：已修——重试轮传输类失败转抛 SpecPushConflict（首推冲突面），不落 tar、不写 pending_push（spec-sync-incremental 新用例锁定）。 - P2「非 changes/ 路径归因失败」：**声明边界（可接受）**——注册表版本冲突面全为 docs/、quicklog/ 等非变更路径时（整树同步对象冲突，当前生产无实证案例）前端归因不出变更名不渲染行，横幅仍可见；裁决入口待后续按「路径域」扩展 compare 语义再开，留 knowledge 信号。 - P3「空 ops 分支无关闭时机」：随④删除死代码消解。 - P3「change.patch 冻结件混入并行变更 linked-repo-workspace-ref 的模块文档 diff」：冻结配方=baseline→工作区全量 diff，并行在途变更无法剔除——已知噪音，归档读者以 commit 链（1e8a4a275/c83531fe1/e0b1ce16+评审加固提交）为准。 遗留（记录不修）：经 daemon 通道撞出的冲突，机器 CLI 侧无 sync-conflict 文件，前端裁决指令在机器上可能回执「当前无 sync-conflict 文件」——缺口 2 上线后此类行基本自愈，残余真分叉以对比弹窗两侧内容为准人工处置。
