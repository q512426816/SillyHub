---
id: task-08
title: 'Build change progress row component'
title_zh: 'frontend change-progress-row.tsx 进度行组件（全量 5 圈/轻量相位双分支+异常态+升厚分流标注+降级）+测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: [task-01]
blocks: [task-10]
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: ['D-002@v1', 'D-005@v1', 'D-006@v1', 'D-007@v1']
allowed_paths:
  - frontend/src/components/daemon/change-progress-row.tsx
  - frontend/src/components/daemon/__tests__/change-progress-row.test.tsx
target_files:
  - NEW:frontend/src/components/daemon/change-progress-row.tsx
  - NEW:frontend/src/components/daemon/__tests__/change-progress-row.test.tsx
expects_from:
  - 'task-01 contract ChangeSummary.stage_progress/task_progress/thin_flow（前置 cd frontend && pnpm gen:types 首跑拉新类型）'
goal: >
  下拉项进度行组件：全量 5 阶段圈横排（占比/打勾/耗时/异常态异色+状态字，execute 圈任务 n/m）与轻量 ①②③ 相位行（批准徽标/任务/子步/总时长/升厚/分流标注）双分支 + 字段缺失降级。
implementation:
  - '开工前 cd frontend && pnpm gen:types 拉三新字段类型（node_modules 健康先确认：pnpm exec tsc --version 可跑，CLAUDE.md 规则 21）'
  - 'change-progress-row.tsx：分支单源规则 is_thin && !upgraded → 轻量相位行；否则全量 5 圈行（含 change_type==quick 独立判 thin 场景，D-007/盲区#9）'
  - '全量支：5 圈（WORKFLOW_STAGES 序，frontend/src/components/changes/detail/change-stage-header.tsx:20 复用阶段序）——completed 打勾/in-progress 按 steps_completed/steps_total 填充/pending 空圈/异常态（waiting/blocked/revising/stale/failed）warning·error token 异色+状态字（revising 带 revision，D-002）；execute 圈旁 task_progress「n/m 任务」（盲区#2 total=0 显 —）；圈下耗时 duration_seconds 人性化（m/h 自适应）'
  - '轻量支：①→②→③ 相位指示（spec 含 awaiting_approval 待批准子态高亮）+ 批准徽标（已批准/autopilot 豁免/未批准）+ executing 显「任务 n/m」（tasks_total=0 不显，盲区#8）/closing 显「子步 n/8」+ 总时长 created_at→updated_at + adopted_from=brainstorm 小字「自头脑风暴转入」（D-006）+ upgraded 标注「已升厚→走全量」（D-007）'
  - '降级：stage_progress/thin_flow 为 null → 不渲染进度行（现状保底，FR-07/盲区#5）；未知 stage 状态值灰态+原值文字（盲区#10）'
  - 'NEW __tests__/change-progress-row.test.tsx：双分支主路径/异常态映射/升厚切换/分流标注/降级/盲区#1 #2 #8 #9 #10 用例；aria-label 文本化进度断言'
acceptance:
  - '全量 5 圈与轻量相位行按字段渲染正确；三分降级场景（无 stage_progress/无 thin_flow/全缺）不渲染不报错；主题双套无裸 hex'
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/change-progress-row.test.tsx
constraints:
  - '色阶走主题语义 token（success/warning/error，frontend/src/styles/themes.ts:46 键名）；禁 hardcoded hex；不新建请求；组件文件 ≤300 行（紧凑场景）'
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
