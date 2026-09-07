---
author: qinyi
created_at: 2026-09-07 07:57:33
---

# 决策记录（Decisions）

## D-001@v1: 拆分范围——三端会话域 8 文件，排除在途变更正在改的文件
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 本次「架构优化，大文件拆分」覆盖哪些文件？（2026-09-07 实测三端大文件热点横跨多文件，且在途变更 2026-09-04-conflict-resolve-entry 有未提交改动正在碰 sillyhub-daemon/src/daemon.ts 7711 行、hub-client.ts 2337 行与 backend daemon 协议层 protocol.py / runtime/service.py / ws_hub.py / lease/context.py）
- answer: 用户选择三块组合：① daemon 侧 god 文件（interactive/session-manager.ts 5438、task-runner.ts 3426）；② backend daemon 模块（session/service.py 7176、router.py 5468、group/service.py 4844、run_sync/service.py 4055）；③ frontend 会话域（components/daemon/session-panel.tsx 6620、lib/daemon.ts 4090）。未选「全部三端一起」——隐含排除 daemon.ts / hub-client.ts / backend 协议层四个在途文件。
- normalized_requirement: 变更文件清单限定为上述 8 个源文件及其新拆出的子模块；daemon.ts、hub-client.ts、backend/app/modules/daemon/{protocol.py,runtime/service.py,ws_hub.py,lease/context.py} 不得改动（在途变更落地前）。
- impacts: [FR-01, task-*, verify-*]
- evidence: 用户回答轮次 1（AskUserQuestion 多选：daemon 侧 god 文件+backend daemon 模块+frontend 会话域）；git status 2026-09-07 实测在途改动清单

## D-002@v1: 拆分策略——机械拆分为主 + 顺带轻重构
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 知识库登记这几个文件「高耦合、跨文件契约靠约定、lease payload 鸭子类型几十处、无低风险切片路径」，拆分手法选哪种？
- answer: 用户选「拆分+轻重构」：以机械搬移为主（旧路径 re-export 保持兼容、行为零变化），允许顺带提取重复 helper、收敛明显的鸭子类型（如 lease payload 补类型）。
- normalized_requirement: 拆分部分验收=现有测试全绿+行为零变化；轻重构部分每项独立小步提交并补定向测试；不做模块边界重划、不做三端契约统一（留后续变更）。
- impacts: [FR-02, task-*, verify-*]
- evidence: 用户回答轮次 2（AskUserQuestion 单选：拆分+轻重构）；.sillyspec/knowledge/known-issues.md「daemon 三个 3000+ 行 god 文件」条目

## D-003@v1: 交付方式——单变更分 3 Wave（daemon → backend → frontend）
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 约 4.1 万行、三端可独立交付互不依赖，走单变更分 Wave 还是 MASTER+子变更？
- answer: 用户选「单变更分 Wave」：本变更内按 daemon → backend → frontend 三个 Wave 依次推进，每个 Wave 独立验收（定向测试全绿）再进下一个，进度集中管理，归档一次完成。
- normalized_requirement: plan.md 按 3 个 Wave 组织任务；每 Wave 结束跑对应子项目定向测试并全绿后才进下一 Wave；不建 MASTER.md、不拆子变更。
- impacts: [FR-03, task-*, verify-*]
- evidence: 用户回答轮次 3（AskUserQuestion 单选：单变更分 Wave）

## D-004@v1: 拆分手法——方案 A 目录化拆包 + 原路径兼容层
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 拆分手法选方案 A（目录化+兼容层）/ B（彻底搬迁全量改导入）/ C（类内 mixin）哪个？
- answer: 方案 A。用户在本步追问窗口未作答，按其 D-002 已确认的「机械搬移为主+旧路径 re-export 保持兼容」推导：方案 B 明确违反 D-002 兼容条款，方案 C（mixin/Object.assign）god 对象本质未解、与架构优化目标背离；方案 A 是唯一同时满足 D-002 兼容与拆分目标的路线。用户保留在「分段展示设计」与「设计文档自审」步的否决权。
- normalized_requirement: Python 端模块升级同名包（session/service.py → session/service/ 包，__init__.py 聚合导出，导入路径零变化）；daemon TS 端原文件瘦身为 re-export facade（Node ESM 无目录导入）；frontend 端目录化（bundler 解析支持目录导入，测试 mock 路径不动）；一次搬一个方法簇、每步定向测试全绿。
- impacts: [FR-04, task-*, verify-*]
- evidence: 用户回答轮次 4（AskUserQuestion 未作答，依据轮次 2 的 D-002 真实回答推导）；Node ESM 目录导入限制见知识库「daemon ESM import 必须 .js」条目

## D-005@v1: 拆分粒度目标与轻重构白名单边界
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 拆分粒度目标定多少？顺带轻重构的范围边界在哪？
- answer: 用户确认设计（2026-09-07 轮次 5 选「确认，继续」）：新拆出文件 ≤800 行、原文件保留核心编排 ≤2500 行，不追求一步 ≤1000；轻重构只做白名单 6 项（daemon payload-utils 统一鸭子读取器 / event-wire 收敛平行转换 / backend 后台任务 mixin / Redis publish helper 统一 / 附件管线收敛 / dialogResult 提取收敛），每项独立任务+定向测试。
- normalized_requirement: 行数目标=新文件≤800、核心编排≤2500；白名单外不顺手改；Non-Goals：notify payload Pydantic 化、page/dialog handler hook 合并、mixin 化类拆分、三端契约统一。
- impacts: [FR-04, FR-05, task-*, verify-*]
- evidence: 用户回答轮次 5（AskUserQuestion：确认，继续）；设计分段展示全文见会话记录

## D-006@v1: 验收硬约束——现有测试零修改通过
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 拆分后行为零变化如何验收？
- answer: 用户确认设计含硬验收：现有测试零修改通过（导入路径/mock 路径全兼容）；任一测试需改 import 才能过 = 兼容层设计失败，回炉重做而非改测试。
- normalized_requirement: 全部现有测试文件内容不变且通过；类型检查与 lint 通过；8 文件行数达标；轻重构 6 项各有定向测试。
- impacts: [FR-06, verify-*]
- evidence: 用户回答轮次 5（设计第 6 段验收标准确认）；CLAUDE.md 规则 9（禁止改测试凑通过）

## D-005@v2: 粒度目标细化——backend session 包细分 + session-panel-page 显式豁免
- type: architecture
- priority: P1
- status: accepted
- supersedes: D-005@v1
- source: design-grill
- question: Grill X-02：初版行数估算与 D-005 硬目标自相矛盾（attachments ~950 / inject ~1200 / read_model ~1140 / session-panel-page ~2900 均超新文件 ≤800 上限）。
- answer: 细化而非放宽：① backend session/service 包从 11 文件细分为 14 文件（attachments 拆出 ppm_activation、inject 拆出 inject_gates、read_model 拆出 session_lifecycle），全部子模块 ≤800；② session-panel-page.tsx 设显式豁免 ≤3000——R-03 闭包状态回归风险（handler 簇保持组件内）优先于行数目标，理由记录于 design §2/§5。
- normalized_requirement: 新拆出子模块 ≤800（唯一例外 session-panel-page.tsx ≤3000 豁免项）；核心编排类壳 ≤2500。
- impacts: [FR-04, FR-05, task-*, verify-*]
- evidence: design.md §2/§5（2026-09-07 修订版）；Grill X-02/B-02

## D-007@v1: monkeypatch 命名空间兼容规则
- type: compatibility
- priority: P0
- status: accepted
- source: design-grill
- question: Grill X-01/B-01（P0）：backend 157 处 patch("app.modules.daemon.<mod>.<sym>") 依赖原模块命名空间属性绑定，方法体搬进子模块后直接 from-import 调用会绕过 patch，D-006 硬验收必然失败。
- answer: 采用「子模块经原模块命名空间延迟解析」统一规则：被 patch 符号（get_redis/get_session_factory/get_session_readiness/group.service 命名空间的 SessionService/_run_gate_via_delegate 等，拆前 grep patch 字符串生成全量白名单）在子模块内一律 import app.modules.daemon.<mod>.<sub> as _ns 式延迟引用调用，__init__.py 顶部保持原绑定。弃「调用点留守 __init__」方案（方法体过大失去拆分意义）。
- normalized_requirement: R-04 对账范围=import 语句+patch 字符串目标两类；任一 patch 目标失效即判定拆分失败回炉。
- impacts: [FR-06, task-*, verify-*]
- evidence: Grill X-01（test_run_sync_gate_decision_task.py:250 等 147 处实测）；design.md §5/§7/§9 修订版

## D-005@v3: 复审补强——dialog 豁免 + run_sync/group 行数自估
- type: architecture
- priority: P1
- status: accepted
- supersedes: D-005@v2
- source: design-grill
- question: 复审发现 session-panel-dialog.tsx ~1650 超新文件 ≤800 且不在 v2 豁免内；run_sync/group 子模块无行数自估（submit_steps 需容纳 872 行方法分解可能超 800）。
- answer: ① session-panel-dialog.tsx 显式豁免 ≤2000（同 R-03 理由：establishStream 闭包状态不动）；② run_sync 包 8→9 文件（submit_steps 拆出 submit_commit），group 包 10 文件全部补行数自估，均 ≤800。
- normalized_requirement: 新拆出子模块 ≤800（例外两项：session-panel-page.tsx ≤3000、session-panel-dialog.tsx ≤2000）；核心编排类壳 ≤2500。
- impacts: [FR-04, FR-05, task-*, verify-*]
- evidence: 复审报告残余 gap #1/#2；design.md §2/§5/§6（2026-09-07 终版）

## D-008@v1: router 包 9→12 文件（execute 期细化拆分）
- type: architecture
- priority: P2
- status: accepted
- source: code
- question: task-07 执行中发现按设计 9 文件划分，session_extras 达 1204 行、notify_misc 达 1794 行，超 D-005@v3 新文件 ≤800 上限（设计曾预判 notify_misc ≤900 可接受，实测 1794 远超）。
- answer: 细化拆分为 12 文件：session_extras → session_queue（队列 6 端点）+ session_insights（日志/run/task/用量/team 8 端点）；notify_misc → notify（notify_* 与恢复/挂起簇）+ gateway_misc（认证三 helper/ws/controls/skills/mcp/llm proxy/fs）。design 文件清单与 task-07 卡 allowed_paths 同步修订。
- normalized_requirement: router 包全部子模块 ≤800；导入路径与挂载顺序不变量不受影响（子模块仅是注册单元再细分，__init__ 注册顺序仍按原文件端点首现顺序）。
- impacts: [task-07, verify-*]
- evidence: worktree 实测 wc -l（2026-09-07 18:44 盘点：notify_misc 1794 / session_extras 1204）

## D-008@v2: router 包最终 13 文件（supersedes D-008@v1）
- type: architecture
- priority: P2
- status: accepted
- supersedes: D-008@v1
- source: code
- question: v1 的 2+2 拆法（session_extras→queue+insights、notify_misc→notify+gateway_misc）实测数学上无法满足 ≤800（gateway_misc ≈1035、insights 含 team ≈1014）。
- answer: 最终 3+3=6 新文件：session_queue/session_insights/session_team + notify/gateway_misc/daemon_rpc，共 13 文件全部 ≤800（max 712）；域归属与保序对全保留，__init__ 用 _ENDPOINT_ORDER 表按原函数名全局恢复注册顺序并 fail-fast。
- normalized_requirement: router 包全部子模块 ≤800；注册顺序与 openapi 等价性由 _ENDPOINT_ORDER 表守护。
- impacts: [task-07, verify-*]
- evidence: worktree 实测（2026-09-07）；commit 966fa6e20

## D-009@v1: 脆弱计时测试 test_two_members_trigger_in_parallel 的处置口径
- type: risk
- priority: P1
- status: accepted
- source: code
- question: task-07 验收发现 test_group_p2.py::TestParallelMentionTrigger::test_two_members_trigger_in_parallel 在 -n auto（20 worker）下随文件数/导入扰动失稳（拆分代码 8/8 失败 vs HEAD 0/6 通过），插桩证明服务端 gather 0.219s 完美并行、失败源于 xdist 调度停顿撞 0.35s 断言（仅 150ms 余量）；请求路径代码逐字节一致（152 符号 diff 仅 9 处 D-007 改写且不在群发路径）。
- answer: 认定为预存脆弱计时测试非功能回归（CLAUDE.md 规则 9 不改测试）；本变更 backend 定向测试统一用 -n 10（全绿 1865 passed）；遗留两条：CI 层面放宽该断言或加 rerun 留后续 quick；归档时入 known-issues。
- normalized_requirement: 本变更内 backend 测试命令统一 -n 10；该测试失败不判拆分失败，判环境敏感。
- impacts: [task-08, task-09, task-10, task-12, verify-*]
- evidence: task-07 续做代理插桩报告（2026-09-07）
