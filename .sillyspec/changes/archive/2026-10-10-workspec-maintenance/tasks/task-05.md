---
id: task-05
title: 'frontend 关联仓卡片——列表/Modal 表单/我的路径/状态列/立即同步/空态，双主题（FR-06）'
title_zh: 'frontend 关联仓卡片——列表/Modal 表单/我的路径/状态列/立即同步/空态，双主题（FR-06）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 19:04:59
priority: P0
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-006@v1, D-007@v1]
depends_on: [task-02, task-03]
allowed_paths:
  - frontend/src/components/workspace/linked-repos-card.tsx
  - frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/lib/linked-repos.ts
target_files:
  - NEW:frontend/src/components/workspace/linked-repos-card.tsx
  - NEW:frontend/src/components/workspace/linked-repos-form.tsx
  - NEW:frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx
  - NEW:frontend/src/lib/linked-repos.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
provides:
  linked-repos-ui:
    component: "LinkedReposCard（工作区详情挂载）"
    api-lib: "frontend/src/lib/linked-repos.ts（list/create/update/remove/saveMyPath/syncNow）"
expects_from:
  task-02:
    crud-api: "五端点形状与权限（见 task-02 provides.crud-api）"
  task-03:
    sync-rpc: "sync 触发端点与 summary 聚合口径（见 task-03 provides.sync-rpc）"
goal: >
  工作区详情「关联仓」卡片：列表（含我的本地路径与逐层落盘状态）+ 管理员 Modal 表单 +
  成员路径小 Modal + 删除确认 + 立即同步 + 空态，双主题（FR-06，对照原型
  prototype-workspace-linked-repos.html）。
implementation:
  - 新建 frontend/src/lib/linked-repos.ts：API 封装（apiFetch 惯例）；组件内部
    interface 定义响应形状（api-types.ts 由 task-06 统一再生成后对齐，不手写 api-types）
  - 新建 frontend/src/components/workspace/linked-repos-card.tsx：SectionCard 形态，
    列表列=名称+描述/仓库地址/我的本地路径（未配置琥珀提示）/逐层状态徽标/操作；
    新增编辑 Modal（名称必填+地址+描述+约定相对路径）；我的路径 Modal（含「仅保存给
    我自己」说明）；删除确认；立即同步按钮（受理后轮询 GET 刷新状态）；空态引导
  - 样式：对齐 .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md 工作台页面规范
    （primer 结构组件 + antd 控件；brand-* 语义阶；双主题 themes.ts 单一源；空值 —）
  - 挂载：frontend/src/app/(dashboard)/workspaces/[id]/page.tsx 引入卡片
  - 测试：__tests__/linked-repos-card.test.tsx 渲染/权限差异（管理员 vs 成员）/
    Modal 交互/空态/同步受理用例（mock api）
acceptance:
  - FR-06 GWT 全过；对照原型交互一致（无类型选择、成员级路径列）
  - 普通成员看不到共享字段编辑入口，仅我的路径/立即同步；owner/admin 全功能
  - vitest 用例全绿
verify:
  - cd frontend && pnpm vitest run src/components/workspace/__tests__/linked-repos-card.test.tsx
constraints:
  - 不手写 frontend/src/lib/api-types.ts（CLAUDE.md 规则 21，task-06 统一 gen:types）
  - 硬编码 hex 禁用（主题铁律）；不动移动端页面（m/ 路径，非目标）
  - 禁跑全量 vitest（CLAUDE.md 规则 0）
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
