---
id: task-10
title: 'Wire hover panel with progress and badge'
title_zh: 'frontend 悬浮框接线（进度行内嵌/总圈挂载/计数徽标双色）+既有测试补断言'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: [task-08, task-09]
blocks: []
requirement_ids: [FR-05, FR-08]
decision_ids: ['D-009@v1', 'D-012@v2']
allowed_paths:
  - frontend/src/components/daemon/session-change-files-hover.tsx
  - frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx
target_files:
  - frontend/src/components/daemon/session-change-files-hover.tsx
  - frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx
expects_from:
  - 'task-08 ChangeProgressRow 组件'
  - 'task-09 ChangeTotalProgressRing 组件（含选取/口径纯函数）'
goal: >
  悬浮框接线：renderItem 内嵌 ChangeProgressRow（归档项不挂，D-009）、「变更」按钮旁挂 ChangeTotalProgressRing、计数徽标双态（active>0 blue 固定阶/0 绿）。
implementation:
  - 'session-change-files-hover.tsx renderItem（frontend/src/components/daemon/session-change-files-hover.tsx:125-154）非归档项底部嵌 <ChangeProgressRow change={c}/>；归档项维持现状（D-009）'
  - '按钮行（:201-219）旁挂 <ChangeTotalProgressRing changes={active}/>（内部按 D-013 选取）'
  - '计数徽标（:211-218）双态：active.length>0 → blue-600 固定阶（真信息蓝，D-012@v2，semantic.info 两主题均青不可用）；===0 → 保持 bg-emerald-600 系；running 呼吸动画条件不变'
  - '既有测试 __tests__/session-change-files-hover.test.tsx 补断言：进度行挂载/归档项无进度行/徽标双态 class/总圈挂载'
acceptance:
  - '既有用例+新增断言全绿；无进度数据会话渲染与改动前一致（零回归）'
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-change-files-hover.test.tsx
constraints:
  - '呼吸动画逻辑不变；大弹窗（文件树 Dialog）维持现状不加进度；embedded/独立定位两形态不受影响'
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
