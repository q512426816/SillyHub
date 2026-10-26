---
id: task-09
title: 'Build total progress ring component'
title_zh: 'frontend change-total-progress-ring.tsx 入口总进度圈（双口径单源函数+updated_at 显式重排选取）+测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: [task-01]
blocks: [task-10]
requirement_ids: [FR-05]
decision_ids: ['D-003@v1', 'D-013@v1']
allowed_paths:
  - frontend/src/components/daemon/change-total-progress-ring.tsx
  - frontend/src/components/daemon/__tests__/change-total-progress-ring.test.tsx
target_files:
  - NEW:frontend/src/components/daemon/change-total-progress-ring.tsx
  - NEW:frontend/src/components/daemon/__tests__/change-total-progress-ring.test.tsx
expects_from:
  - 'task-01 contract ChangeSummary 三新字段 + 既有 step_progress'
goal: >
  入口旁单个总进度圆环+百分比：全量口径=step_progress.steps_completed/step_total，轻量口径=相位加权（spec=0.1/awaiting_approval=0.15/executing=0.33+0.34×tasks_done/max(tasks_total,1)/closing=0.67+0.33×substeps_done/8）；目标变更=updated_at 显式重排取最新。
implementation:
  - '选取函数（纯函数导出）：[...active].sort(updated_at desc，次序键回退 change_key 稳定)[0]——禁用后端列表序（D-013；后端序=未归档优先+created_at desc，frontend/src/components/daemon/session-change-files-hover.tsx:63 注释）'
  - '口径函数（纯函数导出单源）：全量 steps_completed/step_total；轻量相位加权公式（design FR-05）；数据缺失（无 step_progress 且无 thin_flow）→ null'
  - 'ring 组件：SVG 圆环 stroke-dasharray 百分比+中心百分比文字+aria-label 文本化；null → 不渲染（FR-05 降级）'
  - 'NEW __tests__：口径函数单测（全量比/轻量四相位加权/缺失 null）/选取函数（多变更 updated_at 重排/并列回退 change_key，盲区#6）/组件渲染断言'
acceptance:
  - '口径与选取函数测试全绿；目标数据缺失时环不渲染按钮区不受影响'
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/change-total-progress-ring.test.tsx
constraints:
  - '口径公式单源（两纯函数导出，不散落组件）；不依赖后端返回序；aria-label 文本化'
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
