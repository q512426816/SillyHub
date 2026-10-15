---
id: task-02
title: "Unified timeline — pure merge function and timeline component"
title_zh: "合并纯函数与统一时间线组件（三层口径 + 三输入类取舍）"
author: qinyi
created_at: 2026-10-16 00:25:57
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-09, FR-10]
decision_ids: [D-005@v1, D-014@v1, D-016@v1]
allowed_paths:
  - NEW:frontend/src/components/changes/detail/merge-change-timeline.ts
  - NEW:frontend/src/components/changes/detail/change-unified-timeline.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/merge-change-timeline.test.ts
  - NEW:frontend/src/components/changes/detail/__tests__/change-unified-timeline.test.tsx
target_files:
  - NEW:frontend/src/components/changes/detail/merge-change-timeline.ts
  - NEW:frontend/src/components/changes/detail/change-unified-timeline.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/merge-change-timeline.test.ts
  - NEW:frontend/src/components/changes/detail/__tests__/change-unified-timeline.test.tsx
provides:
  - contract: "UnifiedRow"
    fields: [key, at, source, stage, tone, title, detail, waitReason, commitSha, commitTitle, meta]
  - contract: "TaskTimeStatus"
    fields: [status, at]
goal: >
  用一条统一时间线取代「步骤时间线 + 真实留痕时间线」两条重叠卡：合并口径确定性、零近似匹配；并导出任务时刻断裂判定 helper（TimelineTask.time=null 需区分「未勾选」与「观测断链」）。
implementation:
  - "新建 frontend/src/components/changes/detail/merge-change-timeline.ts：interface MergeInput { steps: StepTimelineEntry[] | null; events: TimelineEvent[]; bornAt: string | null } + interface UnifiedRow（字段同 design 的 Phase 3 段）+ mergeChangeTimeline(input): UnifiedRow[]（纯函数零取数）"
  - "口径三层逐条落地：①源内严格去重——步骤键 step:${{stage}}:${{ordering}}（ordering 为必填 int，见 backend/app/modules/change/schema.py 的 StepTimelineEntry）、事件键 event:${{ts}}:${{kind}}:${{label}}、诞生锚键 born；②task-done 折叠——kind 为 task-done 且 detail 命中 checked N->M 的 tasks 域（前缀为 tasks 或缺省）不产出时间线行，非 tasks 域（如 design · checked 0->6）保留为普通事件行（域白名单口径对齐 backend/app/modules/change/timeline.py 的 _TASK_DONE_RE）；③排序——有 at 者按 ISO 字符串正序，无 at 者（pending 步骤）置末尾并按阶段序稳定排序"
  - "三输入类取舍逐条落地：非 ISO completed_at 残留原串先做可解析判定，不可解析者与无时间戳者同置末尾（MUST NOT 混入字典序比较）；事件同键碰撞保留去重并在口径文案声明（MUST NOT 用序号后缀绕过）；task-done 推断断裂（checked 游标不连续）时该任务行标注「时刻不可推断（观测断链）」而非裸问号"
  - "导出 inferTaskTimeStatus(tasks: TimelineTask[], events: TimelineEvent[]): TaskTimeStatus[]（每任务 {status: checked|unchecked|broken; at: string|null}）——断裂判定照抄后端语义：checked 游标 start != cursor 即断裂且其后时刻不可信（backend/app/modules/change/timeline.py 的 _infer_task_times）"
  - "新建 frontend/src/components/changes/detail/change-unified-timeline.tsx：消费 UnifiedRow[]，用 primer Timeline/TimelineItem 渲染；每行带来源胶囊（步骤/事件/锚点）+ 阶段胶囊 + 提交短哈希（有则显）+ time；detail 非空时走 TimelineItem 的 children 展开；卡头提供阶段筛选 chips（受控）与「点击阶段可筛选；与上方阶段条联动」提示；时间线下方渲染合并口径说明（含同键去重取舍声明）"
  - "单测：frontend/src/components/changes/detail/__tests__/merge-change-timeline.test.ts（口径三层 + 三输入类 + 字段不丢 + 空输入）+ frontend/src/components/changes/detail/__tests__/change-unified-timeline.test.tsx（来源胶囊/阶段筛选/展开详情/空态）"
acceptance:
  - "源内重复条目只出现一次（同 stage+ordering 的步骤、同 ts+kind+label 的事件）；不发生跨源合并——MUST NOT 存在按名称相似度或时间窗口的跨源匹配代码路径"
  - "tasks 域 task-done 事件不作为时间线行出现；非 tasks 域同形态事件保留为普通事件行（两条断言各一例）"
  - "非 ISO completed_at 行落到输出末尾且不破坏其余行的升序；全空输入（steps/events/bornAt 皆空）返回空数组且组件渲染空态"
  - "统一时间线卡下方渲染合并口径说明，且文案中明确声明同键去重取舍（同秒同类型同文本视为同一观测的重复上报）——该断言落在 change-unified-timeline.test.tsx（组件测试），不得只由 merge 纯函数单测覆盖"
  - "两源独有字段不丢：步骤侧 stage/waitReason/detail（output）在场；事件侧 commitSha（commit 事件 detail）与 commitTitle 在场"
  - "inferTaskTimeStatus 对断裂序列返回 broken（at=null）、对未勾选返回 unchecked、对正常勾选返回 checked + 推断时刻"
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
  - "cd frontend && pnpm exec vitest run frontend/src/components/changes/detail/__tests__/merge-change-timeline.test.ts frontend/src/components/changes/detail/__tests__/change-unified-timeline.test.tsx"
constraints:
  - "纯函数零取数：merge-change-timeline.ts MUST NOT import react/fetch/react-query（可在 node 环境直接单测）"
  - "MUST NOT 引入按名称相似度或时间窗口的跨源匹配（D-014 红线）"
  - "不改两旧卡文件（change-step-timeline.tsx / change-timeline-card.tsx 由 task-07 仅卸载挂载，文件与导出保留）"
  - "组件不取数（数据由 task-06/07 注入）；禁硬编码 hex；不引入新依赖（时间格式化复用既有口径）"
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
