---
id: task-03
title: 'gen:types and frontend per-repo grouped audit card'
title_zh: 'gen:types 与前端按仓分组'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 20:03:38
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-04, FR-05, FR-06]
decision_ids: [D-002@v1, D-003@v1, D-005@v1, D-004@v2]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/components/changes/scope-audit-command-card.tsx
  - frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx
  - frontend/src/components/mobile/mobile-change-detail.test.tsx
  - frontend/src/components/changes/__tests__/quicklog-drawer.test.tsx
target_files:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/components/changes/scope-audit-command-card.tsx
  - frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx
expects_from:
  task-02: ['ScopeAuditRow.cross_repo', 'ScopeAuditResponse.repos（ScopeAuditRepo{key,anchor,anchor_label,totals,degraded,degraded_reason}）']
goal: >
  前端消费契约 v2：gen:types 重生成类型后，对账卡按仓分组渲染（全表合计 + 每仓段真实三态与
  锚点档，D-003/D-005），明细弹窗按仓分节 + 仓标徽章，无 repos 全链回退现状单段渲染（D-002）。
implementation:
  - gen:types 前预检 node_modules（cd frontend && pnpm exec tsc --version；坏则 pnpm install --force），再 cd frontend && pnpm gen:types；提交 frontend/src/lib/api-types.ts + backend/openapi.json（伴生产物只保留相关 diff）
  - frontend/src/components/changes/scope-audit-command-card.tsx 卡面：分组激活条件（repos 非空数组且 mode==='full-flow'，:301-305 分支处）→ 顶部全表合计行（锚点/文件数/+−/仓数）+ 每仓段——段头=仓标识（key==='main' → 「主仓」brand 色，否则 repo key）+ 锚点档 chip（anchor.label 文案 + anchor_label 短 hash，语义锚 null 显示 —）；段身=三态 chips（计数取 repos[].totals，不前端重算，testid=scope-audit-chip-<repo>-<verdict>）+ 该仓 files/+−；degraded=true 段不渲染 chips 整段 ⚠️ degraded_reason；卡尾 note 顶摘要层（muted 单行，:354 附近）
  - 同文件明细弹窗（:396-439）：rows 按 cross_repo 分桶（无键归 main 桶），桶序=repos[] 序（main 首位，孤儿桶尾随首现序），每桶粘性小节头（仓标识+锚点档），跨仓行加仓标徽章；行点击 diff 联动不变
  - 回退分支：repos 空/null 或 mode==='quick' → 现状渲染路径与 testid 原样（回退形态不渲染 note，兼容策略 6）
  - frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx 增用例：三仓分组渲染（chips 数字=信封 totals）/degraded 段降级文案/note 渲染/回退（无 repos 单段+旧形态跨仓行归主仓+testid 不变）/明细分桶与仓标
  - 回归 frontend/src/components/mobile/mobile-change-detail.test.tsx 与 frontend/src/components/changes/__tests__/quicklog-drawer.test.tsx（import 复用/挂载面，只跑不改为主，桩需调整时才有写面）
acceptance:
  - f85a6650 类三仓夹具：卡面显示主仓段（20/2+主仓锚）+ sub-grid-security/spdemo 段各带真实三态与锚点档（任务书验收）
  - 单仓/无 repos/quick 夹具：渲染与现状等价（回退用例断言，既有 testid 断言全绿）
  - degraded 仓段显示 ⚠️ 原因文案、无伪三态；跨仓行 null 行数显示 —
  - api-types.ts 含 cross_repo/repos 字段且 gen:types 重跑零漂移
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run src/components/changes/__tests__/scope-audit-command-card.test.tsx src/components/mobile/mobile-change-detail.test.tsx src/components/changes/__tests__/quicklog-drawer.test.tsx
constraints:
  - 布局/色阶走主题 token 与语义类（brand-* 做主仓标识、success/warning/error 既有阶），不手写 hex（CLAUDE.md 规则 20）
  - 回退形态 DOM/testid 不变（旧测试零改挂）；分组形态新 testid 带 repo 前缀防冲突
  - 移动端不做专属布局（import 复用自动继承）；禁跑全量测试（CLAUDE.md 规则 0）
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
