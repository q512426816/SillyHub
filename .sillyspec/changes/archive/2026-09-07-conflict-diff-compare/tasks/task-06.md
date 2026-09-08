---
id: task-06
title: 'frontend 弹窗与行改造测试先行（含总览卡 ql 标题单测）'
title_zh: 'frontend 弹窗与行改造测试先行（含总览卡 ql 标题单测）'
author: 'qinyi'
created_at: 2026-09-07 13:53:21
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-002@v1, D-003@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  - frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx
target_files:
  - NEW:frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  - frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx
goal: >
  为 Phase 3 行改造与对比弹窗先写测试钉死契约（design §5 Phase 3、§7.2），让 task-07/08 实现有据可依。
implementation:
  - NEW conflict-compare-modal.test.tsx——仿 platform-sync-section.test.tsx 惯例（vi.hoisted mock @/lib/daemon、QueryClientProvider retry:false、AntApp 包裹）；spec-tree/progress 双模式渲染、diff_rows 差异高亮（delete 红/insert 绿）、裁决按钮权限、loading/失败重试、截断提示与二进制占位
  - 适配 platform-sync-section.test.tsx——行内保本地/取平台与 modal.confirm 流程断言改为「查看对比」单按钮；ql_id 存在显示【ql-编号】+ 小字原始 ID、缺失兜底变更名；离线禁用查看对比
  - changes-overview-card.test.tsx 补 ql 标题单测——ql_id 存在显示【ql-编号】、缺失兜底原名
  - 本卡只写测试，实现留 task-07/08；新测试当前红属预期
acceptance:
  - 弹窗测试覆盖双模式、差异高亮、裁决权限、loading/重试、截断与二进制占位（锚定 §7.2：status 四枚举、diff_rows type 三枚举、progress_rows 四字段）
  - section 适配断言行上只剩「查看对比」、ql 标题、离线禁用；行内裁决旧断言不再存在
  - 总览卡单测覆盖 ql 标题显示与兜底两分支
verify:
  - cd frontend && pnpm vitest run src/components/changes/__tests__/conflict-compare-modal.test.tsx src/components/changes/__tests__/platform-sync-section.test.tsx
constraints:
  - 测试先行，本卡不改 platform-sync-section.tsx / changes-overview-card.tsx / 新建弹窗组件
  - 既有断言失效属适配范围（行内保本地/取平台、modal.confirm 流程），按 design 改断言而非迁就现状
  - 仅跑本变更相关测试文件，不跑前端全量（CLAUDE.md 规则 0）
related_tests:
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
  - frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx
expects_from:
  task-04:
    - contract: SillySpecConflictCompareResponse
      needs: [files, progress_rows, local_updated_at, platform_updated_at, ql_id]
  task-05:
    - contract: ApiTypes
      needs: [SillySpecConflictCompareResponse, DaemonHeartbeatSillySpecConflict.ql_id]
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
