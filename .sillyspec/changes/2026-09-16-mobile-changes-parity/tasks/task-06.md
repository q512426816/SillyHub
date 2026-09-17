---
id: task-06
title: mobile-detail-three-cards-and-stage-focus-linkage
title_zh: 'MobileChangeDetail 三卡挂载（ChangeLastSignal/ChangeUsageCard/ScopeAuditCommandCard）+ 阶段联动（StageStepper 可点 + focusStage + 清除 chip）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 21:19:19
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05, FR-06]
decision_ids: [D-004@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/mobile/mobile-change-detail.tsx
  - frontend/src/components/mobile/mobile-change-detail.test.tsx
related_tests: [frontend/src/components/mobile/mobile-change-detail.test.tsx]
target_files:
  - frontend/src/components/mobile/mobile-change-detail.tsx
  - frontend/src/components/mobile/mobile-change-detail.test.tsx
goal: >
  为 MobileChangeDetail 补齐桌面详情页既有的最后信号/执行用量/范围对账三卡与阶段-时间线
  筛选联动（FR-05/FR-06，D-004@v1），三卡全部 import 既有组件复用挂载（D-005@v1）。
implementation:
  - 'import 复用（D-005 禁重写）：ChangeLastSignal + lastSignalFromSteps（@/components/changes/change-activity-badge，lastSignalFromSteps 为已导出纯函数）、ChangeUsageCard（@/components/changes/detail/change-usage-card）、ScopeAuditCommandCard（@/components/changes/scope-audit-command-card）'
  - 'StageStepper（mobile-change-detail.tsx:168-221 模块私有）签名扩为 { currentStage, stepStages, focusStage, onStageClick }（design 接口定义）：节点从纯 span 升为 button——仅 stepStages 含有的阶段可点（触摸热区 ≥44px、aria-pressed 标选中），未含阶段保持纯展示不可点'
  - 'MobileChangeDetail 内新增 focusStage state 与 stepStages 派生：stepStages 对齐桌面 [cid]/page.tsx:249-252（steps 非空时 Array.from(new Set(steps.map(e => e.stage)))，否则 []）；onStageClick 对齐桌面 :320-322（setFocusStage(prev => prev === stage ? null : stage)，再点同阶段取消）'
  - 'StageStepper 下方区块流按桌面顺序（总体方案点 6）挂三卡：ChangeLastSignal lastPushedAt={lastSignalFromSteps(change.steps)}（无信号组件内不渲染）→ ChangeUsageCard kind="change" workspaceId refKey={changeId}（组件自取数不加门控）→ ScopeAuditCommandCard target={{ kind: "change", workspaceId, changeKey: change.change_key }}（已归档也可查）'
  - '时间线卡（SecCard m-change-timeline-card）卡头加清除 chip：focusStage 非空时渲染「{STAGE_LABELS[focusStage] ?? focusStage} ✕」按钮（aria-label 清除阶段筛选，onClick setFocusStage(null)）；ChangeStepTimeline 透传 focusStage（prop 已支持，change-step-timeline.tsx:262）'
  - '更新文件头区块清单注释（补三卡与联动）；跑既有 mobile-change-detail.test.tsx 修正受新增区块影响的既有断言（不新增用例，新用例归 task-08）'
acceptance:
  - '详情渲染时 StageStepper 下方依次出现最后信号行（data-testid=change-last-signal）、执行用量卡、范围对账卡；steps 无 completed_at（或 steps 缺失）时最后信号不渲染（FR-05）'
  - '点击 steps 中有条目的阶段节点 → 时间线仅显示该阶段条目且卡头出现「阶段名 ✕」清除 chip；再点同节点或点 chip 恢复全量（FR-06）'
  - 'steps 中无条目的阶段节点不可点（无筛选效果）；current_stage 非线性（quick 等）时步骤条整体不渲染，联动入口自然缺席、focusStage 恒为 null 无副作用'
  - '三卡均 import 复用：grep 确认 ChangeLastSignal / ChangeUsageCard / ScopeAuditCommandCard 均 import 复用、无第二份实现（D-005）'
  - 'cd frontend && pnpm exec tsc --noEmit 通过，既有 mobile-change-detail.test.tsx 全绿'
verify:
  - 'cd frontend && pnpm exec tsc --noEmit'
  - 'cd frontend && pnpm test -- "src/components/mobile/mobile-change-detail.test.tsx"'
constraints:
  - 'D-005：三卡直接 import 复用，禁止重写组件或复制数据层实现；小屏 390px 实测溢出时就地加移动断点样式，不重写组件（R-01）'
  - 'ChangeLastSignal 无信号（steps 缺失/全部无 completed_at）不渲染；ChangeUsageCard/ScopeAuditCommandCard 挂载不加门控（对齐桌面接线惯例）'
  - 'stepStages 派生口径与桌面 [cid]/page.tsx:249-252 逐字一致；非线性 stage（quick 等）步骤条不渲染、联动自然缺席'
  - 'StageStepper 保持模块私有组件；不改 STEPPER_STAGES / STAGE_LABELS / WORKFLOW_STAGES 等复用常量来源与既有审批/文档/时间线区块顺序'
  - '不含删除入口（task-07 范围）与新增测试用例（task-08 范围）；仅允许修正既有测试受新增区块影响的断言'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
