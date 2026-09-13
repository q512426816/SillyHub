# agent 日志 ctx 归属错配：本地会话↔变更/quick 匹配不准（2026-09-11）

姊妹篇：`agent-log-hub-attribution-cross-session-contamination.md`（hub 全量重推把本地日志
挂到无关平台会话——本篇问题 C 与之同根）。本文覆盖纯本地 CLI run 的 ctx 聚合路径
（`platform_sync/service.py` 无 hub 分支：按 `(harness, coalesce(change_key, quick_id))`
分组 find-or-create `origin=tool_report` 会话 + `_bind_entry_ctx` 绑变更/quicklog）。

## 现象（2026-09-11 本机留底 vs zcode 库实证）

留底 `.sillyspec/.runtime/agent-session-log.json` 的 entry ctx 与 zcode 库真实归属大面积错配：

- `sess_0848df09`（标题「SillySpec CLI 本地agent日志与会话不对应」——用户当前对话窗口，
  从未跑过 sillyspec）被标 `change_key=2026-09-10-group-agent-direct-chat` +
  `quick_id=quick-09fb6f43`；
- `sess_b3878725`（「Pi 会话级供应商切换不支持问题」窗口）被标 group-agent-direct-chat，
  而它自己的 subagent `c8d22264`（provider-switch 的 QA 审查）标的是正确的
  session-provider-switch——父子会话被拆到两个变更；
- `sess_373e5c8c`（「群聊背景与输入框拖拽样式统一」）被标 workspace-asset-bridges；
- quick-09fb6f43 的 quick_id 同时打在 4 个互不相干的主会话/subagent 上。

## 根因

**A. ctx 打标单位是「cwd 下全部活跃日志」而非「本 run 所属 agent 会话」**（主因）。
CLI `agent-session-log.js` 每次 run 把 15 分钟窗口内 cwd 匹配的**所有**日志文件视为本次
ctx（`detected` 全量打 `change_key`/`quick_id`，last-wins 覆盖）。多窗口/多变更并行时
（本仓库常态），任何一次 `--change X` 的 run 都会把当时活跃的其它会话日志抢标为 X。
zcode 探测仅凭 workdir 标记 == cwd，无法区分会话归属（协议 §3 自认「env 门控只证明
驱动方、证明不了文件归属」）。

**B. quick/change 双键并存，分组与绑定口径相反**。协议称两键互斥，但 CLI 合并规则
`change_key: ctxChangeKey ?? prev?.change_key` 在 quick run（ctxChangeKey=null）时保留
旧 change_key 并新增 quick_id → 双键并存成为常态。平台分组 `change_key or quick_id`
（change 优先）→ quick 的日志落进**变更**会话；绑定 `_bind_entry_ctx` quick 优先 →
那个变更会话又被绑到 quicklog。quick 自己的聚合会话（`zcode|quick-xxxx`）只在 entry
无历史 change_key 时才会建。

**C. 行级单归属 + 抢标 = 日志行在不同会话间搬家**。`platform_agent_logs.agent_session_id`
单列，ctx 改写后行即离开原会话（旧变更会话日志卡片被搬空）；叠加姊妹篇的 hub 全量重推
（d4c29d95 pi 会话现挂着 9+ 条本地日志），quick 会话建了也被掏空——「quick 关联上了但
点进去没内容」的直接来源。

## 影响

- 变更详情/会话列表的「本地 agent 日志」卡片普遍张冠李戴（包括完全没跑过 sillyspec 的
  普通对话窗口也被标变更）；
- quick 执行的日志大多不落 quick 聚合会话（落变更会话或被 hub 抢走），quicklog 关联
  会话点开为空/内容错乱；
- 父子会话（主会话 vs 其 subagent）被拆到不同变更名下，无法回放一个变更的完整执行链。

## 改进建议（需 brainstorm 定方案，非 quick 级）

1. **CLI 打标收敛（根治 A）**：只给「本 run 所属 agent 会话及其 subagent（按 zcode
   parent_id / pi 会话目录）」打 ctx，不再按 cwd 活跃窗口广撒网；探测不出自有会话时
   不打 ctx（宁缺毋滥）。
2. **互斥真正落地（修 B）**：quick run 写 quick_id 时清掉 change_key（或 entry ctx 改
   多值历史，平台按时间窗查询）；平台分组与绑定统一 quick 优先。
3. **归属模型（修 C）**：日志行→会话改 M:N（或行不挂 session、按 ctx 动态关联），
   hub 分支只收本会话条目 + harness 一致性校验（姊妹篇建议）。

状态：活跃坑（结构性问题，牵涉 sillyspec CLI 协议 + daemon + 平台三端，建议开变更走
brainstorm）。

## 处置进展（2026-09-12 定时复核）

- 建议A（ctx 打标收敛到 own 会话）/建议B（quick-change 真互斥）已随 sillyspec f252557 落地（own 锚定 + 双向互斥，协议 v1.2）；建议C（M:N 归属）按 refactor design **D-005 用户否决**，替代方案为 ctx-owner 两级 find 归属解析 + 存量清理数据迁移（task-03/05 已勾）。
- 根治载体：multi-agent-platform 活跃变更 2026-09-11-agent-log-attribution-refactor（6/6 task 已勾，verify 收尾中）——待其归档后本文件随验归档（下轮巡检复核）。

## 处置记录（2026-09-12 用户指认复核，双侧落地实证，归档）

根治载体 `2026-09-11-agent-log-attribution-refactor` **verify PASS**（2026-09-12 06:52，integration-critical + task-06 跨仓真服真 CLI 全链冒烟 17KB 证据），三条建议的最终归宿：

- **建议 A（打标收敛）✅**：CLI 锚定器 + own 打标（task-01，sillyspec a8a76cc）——只给本 run 所属会话打 ctx，cwd 活跃窗口广撒网根因消除；
- **建议 B（双键互斥）✅**：quick run 清 change_key，双向互斥落地（同 task-01）；平台侧分组 quick 优先（D-006@v2）；
- **建议 C（M:N 归属）→ 等效替代落地**：字面 M:N 链接表按 D-005 用户否决；其针对的痛点（行级单归属 + 抢标 = 日志行搬家/会话被掏空）由组合方案消除——①CLI own 锚定后抢标不再发生（ctx 稳定）；②平台 ctx-owner 两级 find（task-03，cba1b9fa6：links 第一级 quicklog/change_session_links → aggregation_key 兜底，组级确定性归属）；③存量污染数据清理迁移（task-05，50295fc7a）。

**测试实证（2026-09-12 复跑）**：backend `test_agent_log_attribution.py` 8/8 passed；sillyspec 侧 121 用例随 task-02（c1134f2）全绿。

事故场景回归口径：多窗口并行下他者会话不再被抢标（own 锚定）；quick 日志落 quick 聚合会话且不再被掏空（互斥 + 两级 find）；父子会话归属随 own 锚定天然正确。归档（refactor 变更目录自身的 archive 移动由其收尾会话执行，不影响本文件结论）。
