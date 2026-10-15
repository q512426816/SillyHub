---
id: task-05
title: "Task progress checklist with inferred check times"
title_zh: "任务进度清单（勾选态 + 推断时刻 + 断链标注）"
author: qinyi
created_at: 2026-10-16 00:25:57
priority: P1
depends_on: [task-02]
blocks: []
requirement_ids: [FR-10]
decision_ids: [D-014@v1, D-016@v1]
allowed_paths:
  - NEW:frontend/src/components/changes/detail/change-task-checklist.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-task-checklist.test.tsx
target_files:
  - NEW:frontend/src/components/changes/detail/change-task-checklist.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-task-checklist.test.tsx
expects_from:
  task-02:
    - contract: "TaskTimeStatus"
      needs: [status, at]
goal: >
  用独立清单承载任务面（tasks[] 勾选态 + 推断勾选时刻 + 提交锚 + 勾选比），使时间线不必再显示 task-done 事件；断裂序列显式标注「时刻不可推断（观测断链）」而非裸问号。
implementation:
  - "新建 frontend/src/components/changes/detail/change-task-checklist.tsx：props { tasks: TimelineTask[]; timeStatus: TaskTimeStatus[] }（消费 task-02 的 inferTaskTimeStatus 输出，避免本卡重复实现断裂判定）"
  - "渲染：卡头「任务进度」+ 勾选比（勾选 checked/total · 勾选时间 approx 为推断值）；每行 ☑/☐ + task id（等宽）+ 描述（truncate + title 全文）+ 提交短哈希（有则显，brand 色）+ 推断时刻"
  - "时刻三态：checked -> approx MM-DD HH:mm；unchecked -> 空；broken -> 「时刻不可推断（观测断链）」文案（MUST NOT 显示裸问号）"
  - "顺序沿用 tasks[] 原序（与 tasks.md 行序一致），不重排"
  - "单测 frontend/src/components/changes/detail/__tests__/change-task-checklist.test.tsx：勾选比、三态时刻渲染、提交锚、空清单（tasks 空 -> 整卡不渲染，沿用既有卡的空态隐藏语义）"
acceptance:
  - "卡头勾选比与 tasks 数据一致（checked/total）"
  - "三态时刻渲染正确：checked 显示 approx 前缀时刻、unchecked 不显示时刻、broken 显示「时刻不可推断（观测断链）」"
  - "提交锚（commit_sha）渲染为等宽短哈希；无锚则不占位"
  - "tasks 为空数组时不渲染空壳"
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
  - "cd frontend && pnpm exec vitest run frontend/src/components/changes/detail/__tests__/change-task-checklist.test.tsx"
constraints:
  - "不在本卡重复实现断裂判定（必须消费 task-02 的 TaskTimeStatus）"
  - "不改此后端端点/DTO（TimelineTask 形状不变）"
  - "禁硬编码 hex；不引入新依赖；文案中文"
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
