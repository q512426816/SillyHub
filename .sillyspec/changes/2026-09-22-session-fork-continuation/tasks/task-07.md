---
id: task-07
title: '前端分叉发起——sessions.ts forkSession API+轮头「从此分叉」三重门控（caps/终态/锚点）+确认弹层档位标注+组件测试（depends_on: task-05）'
title_zh: '前端分叉发起——sessions.ts forkSession API+轮头「从此分叉」三重门控（caps/终态/锚点）+确认弹层档位标注+组件测试（depends_on: task-05）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-22 20:33:49
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-001@v1, D-004@v1]
expects_from:
  - task-05 POST /api/daemon/sessions/{id}/fork API 与 SessionRead fork 三字段
allowed_paths:
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/daemon/session-fork/fork-confirm-modal.tsx
  - frontend/src/components/daemon/__tests__/session-fork-entry.test.tsx
target_files:
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/components/daemon/turn-segment-views.tsx
  - NEW:frontend/src/components/daemon/session-fork/fork-confirm-modal.tsx
  - NEW:frontend/src/components/daemon/__tests__/session-fork-entry.test.tsx
goal: >
  用户入口：任意会话轮头「从此分叉」（caps≠none/终态轮/native 锚点缺失三重门控）+确认弹层（引擎档位语义标注：native 真截断 / seed 前情转述有损）+forkSession API 封装。
implementation:
  - frontend/src/lib/daemon/sessions.ts 增 forkSession() 封装 + SessionRead fork 三字段手写镜像补齐（gen:types 覆盖不到处惯例）
  - frontend/src/components/daemon/turn-segment-views.tsx 轮头动作区增「⑂ 从此分叉」入口：caps sessionFork=none 不渲染、run 进行中置灰、native 档该轮 engine_anchor 缺失置灰（提示缺锚点/可退种子档）
  - 新建 frontend/src/components/daemon/session-fork/fork-confirm-modal.tsx：分叉点信息+档位语义标注（对齐原型 prototype-session-fork.html 确认弹层）+继承快照说明；确认后调 forkSession 并跳转新会话
  - 新建 frontend/src/components/daemon/__tests__/session-fork-entry.test.tsx：三重门控矩阵/弹层档位文案/确认调用断言
acceptance:
  - cursor（none）会话无入口；进行中轮/缺锚点轮置灰不可点
  - 弹层 native/seed 两档文案正确（seed 明示「前情转述·非原生上下文」）
  - 确认后调 POST fork 并按响应跳转 B 会话
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-fork-entry.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 样式走 brand-* 语义阶+主题 token（themes.ts 单一源），对齐 AI-Native 双主题铁律
  - 溯源块/浮层属 task-08，本卡只做入口+弹层+API
  - 禁跑全量测试
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
