---
id: task-05
title: 'Add observation alert bar with one-shot decision memory'
title_zh: '前端告警条（决策记忆纯函数+一次决策组件）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 00:55:16
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-007@v1]
allowed_paths:
  - frontend/src/lib/observation-alert-decisions.ts
  - frontend/src/lib/__tests__/observation-alert-decisions.test.ts
  - frontend/src/components/changes/detail/observation-alert-bar.tsx
  - frontend/src/components/changes/detail/__tests__/observation-alert-bar.test.tsx
target_files:
  - NEW:frontend/src/lib/observation-alert-decisions.ts
  - NEW:frontend/src/lib/__tests__/observation-alert-decisions.test.ts
  - NEW:frontend/src/components/changes/detail/observation-alert-bar.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/observation-alert-bar.test.tsx
provides:
  - contract: ObservationAlertBar
    fields: [alerts]
goal: >
  前端告警条：决策记忆纯函数（sessionStorage 按告警 id，容错降级）+ 告警条组件（severity
  属于 warning 或 error 的事件，新告警自动展开、每告警只自动决策一次）（D-007）。
implementation:
  - 新建 frontend/src/lib/observation-alert-decisions.ts：isAlertDecided(id)/markAlertDecided(id)/clearAlertDecisions()——sessionStorage 键 obs-alert-decided 存 JSON 数组，读写 try/catch 失败降级内存 Set（无 sessionStorage 环境 SSR 安全）
  - 新建 frontend/src/components/changes/detail/observation-alert-bar.tsx：props 收告警事件列表（severity 过滤由消费方或组件内做，取组件内做单源）；新告警（未决策）自动展开明细，已决策告警渲染单行摘要；手动收起调 markAlertDecided；样式对齐卡片既有 amber 语义类先例（change-events-card.tsx:64,97）error 用红系
  - 新建 lib/__tests__/observation-alert-decisions.test.ts：标记/判重/清空/存储损坏 JSON 降级
  - 新建 components/changes/detail/__tests__/observation-alert-bar.test.tsx：新告警自动展开一次、手动收起后重渲染不再自动展开、已决策告警渲染单行
acceptance:
  - 同一告警 id 自动展开决策至多一次（收起后轮询重拉/组件重挂载不再展开）
  - sessionStorage 不可用或损坏时功能可用（内存降级）不抛错
  - 告警条零业务逻辑（无 mutation/通知）
verify:
  - cd frontend && pnpm exec vitest run src/lib/__tests__/observation-alert-decisions.test.ts src/components/changes/detail/__tests__/observation-alert-bar.test.tsx
constraints:
  - 组件纯展示红线（不触发通知/审批/mutation）；关态不渲染由消费方 task-06 负责
  - 决策记忆仅 sessionStorage 会话语义，不做后端持久化
  - 样式走 Tailwind 语义类与主题 token，禁止内联硬编码色值
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
