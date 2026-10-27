---
id: task-06
title: 'frontend 运行中计数（空闲态提示）（FR-04）'
title_zh: 'frontend 运行中计数（空闲态提示）（FR-04）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-27 13:02:37
priority: P1
depends_on: ["task-05"]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1,D-002@v1]
allowed_paths:
  - frontend/src/components/agent-log/tool-renderers.tsx
  - frontend/src/components/agent-log/normalize.ts
  - frontend/src/lib/daemon/session-sse.ts
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/agent-log/__tests__/bg-task-final.test.ts
target_files: []
goal: >
  运行中计数：活动流事件配对（run_in_background 启动∪bg_task_final 终态）纯函数推导运行中集合；会话空闲态状态区显示「后台任务 N 个运行中」（N=0 不显示）。落点组件随 task-01 定位。
implementation:
  - 推导纯函数（启动-终态配对，乱序/重放容错）+单测
  - 状态区挂计数显示（会话空闲态条件，既有折叠逻辑位）
acceptance:
  - N 推导正确（乱序/重放/孤儿边界单测）
  - N=0 不渲染
  - 无心跳计数兜底（D-002 防复潮）
verify:
  - cd frontend && pnpm vitest run <推导函数套件>
constraints:
  - 纯函数无副作用
  - 不动会话空闲折叠交互逻辑
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
