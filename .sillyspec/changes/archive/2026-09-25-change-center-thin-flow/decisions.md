---
author: qinyi
created_at: 2026-09-25 01:50:00
change: 2026-09-25-change-center-thin-flow
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123） -->

## D-001@v1: thin 接入形态=THIN 新辅助阶段，列表页与常规变更同列（用户裁决）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: thin 在平台变更中心以什么形态接入——新增 THIN 辅助阶段、复用 QUICK 按代数切 prompt、还是变更中心外独立入口？
- answer: 用户裁决选方案 A（THIN 新辅助阶段），并加 UX 约束原话：「列表页面上我想跟常规变更在一起，内部的逻辑展示可以不一样」——thin 变更是常规 Change 记录，进主变更列表（不像 quicklog 另开 tab），详情页内部按薄流程两段式（start→干活→done）差异化展示。依据：与上游 CLI「存量过渡」语义逐字对齐（quick 保留收尾、新工作走 thin）；新旧隔离清晰存量零风险；manual_dispatch 泛化路径零改动可用；quicklog 那种独立 tab 的形态在核对中被证伪（thin 变更的四件套/归档/事件/蒸馏全在 change 体系，独立入口割裂最重）。
- normalized_requirement: StageEnum 新增 THIN="thin" 进 spec_auxiliary_stages()（不进 TRANSITIONS/STAGE_ORDER，跑完即终态对齐 QUICK 先例）；thin 变更出现在主变更列表与阶段筛选中；详情页 thin 阶段为差异化说明卡（flow start/flow done 两命令 + 断点续语义）；quicklog tab 维持存量只读标注、不承载 thin。
- impacts: [FR-01, FR-02, FR-03, FR-04, FR-05]
- evidence: 用户方案选择轮（本会话 AskUserQuestion，2026-09-25）；三子代理核对报告（接入形态三方案对比）；backend/app/modules/change/model.py:65-72（spec_auxiliary_stages 现状）；backend/app/modules/change/dispatch.py:122-135（QUICK 独立阶段先例注释）
- 模块域: backend, frontend
- 故障面: 过渡期 quick/thin 两套辅助阶段并存——前端徽章/筛选/说明卡两态都要活，漏一处即裸显英文 "thin" 或全灰管线（核对报告前端遗漏清单已列全触点）。
- 退役判据: quick 存量变更全部收尾归档后，可另立决策下线 QUICK 阶段派发面与 quicklog 读侧（读侧至少保留一个归档周期）。

## D-002@v1: thin 中文显示名=「轻量变更」（用户裁决）
- type: ux
- priority: P1
- status: accepted
- source: user
- question: thin 流程的用户可见中文名叫什么？
- answer: 用户两轮裁决：先否决「薄流程」（原话「名字改下 别叫 薄流程 这个不好听」），后在四候选（轻流程/轻量变更/直达流程/快道）中选定「轻量变更」。
- normalized_requirement: 阶段技术值恒为 "thin"（与 sillyspec CLI 对齐不改）；所有用户可见文案（徽章 ◈ 轻量变更、阶段筛选项、详情说明卡标题与正文、CLAUDE.md/skills/模块文档措辞）统一用「轻量变更」；不与退役中的「快速任务/快速修复」混用。
- impacts: [FR-05, FR-06, FR-07]
- evidence: 用户命名轮（本会话 AskUserQuestion，2026-09-25）；原型 prototype-change-center-thin-flow.html 已同步替换。
- 模块域: frontend, sillyspec
- 故障面: 无技术风险；文案漂移风险——后续 design/tasks/实现逐层引用时防回退到「薄流程」措辞。
- 退役判据: 不适用（命名决策）。

## D-003@v1: _stage_group_order 排序契约变更致 test_step_progress.py 两断言更新（执行期裁决）

- **歧义描述**：task-01 卡要求 `_stage_group_order` 把 thin 排进已知序（quick 之后、未知阶段之前），实现后未知阶段排序键从 `(5, name)` 变 `(7, name)`；task-01 的 verify 命令包含的存量回归 `app/modules/change/tests/test_step_progress.py` 有两个用例断言旧契约（quick 与未知并列 index 5 按名混排），必红——但该文件不在 task-01 allowed_paths。
- **选择**：更新两用例断言至新契约（quick→5、thin→6、未知→7），随 task-01 一并落地；不改排序实现（实现忠于 design「thin 排 quick 后、未知前」）。
- **理由**：plan.md 全局验收标准 1 要求聚焦测试全绿、verify 命令显式包含该文件；断言值跟契约走是测试更新而非「改测试躲红」——测试逻辑（排序键/时间线顺序校验）本身未动。改共享测试文件属可逆局部动作，无删测试/跳门禁。
- **影响 task**：task-01（越界文件：backend/app/modules/change/tests/test_step_progress.py，仅断言值两处）；task-09 同类引用（不另立条）：frontend/src/components/changes/__tests__/quicklog-table.test.tsx 空态断言跟新文案走（该测试即 task-09 verify 命令所跑，仅一处断言）；task-08 同类引用：frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx quick 卡断言跟「已退役·存量收尾」新文案走并顺带补 thin 卡两段式断言（该测试即 task-08 verify 命令所跑）。
