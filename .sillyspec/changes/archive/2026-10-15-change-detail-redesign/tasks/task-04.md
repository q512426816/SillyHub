---
id: task-04
title: "Files and audit panel — inline file tree plus scope audit"
title_zh: "文件与对账面板（文件树内嵌 + 范围对账 + 快速任务）"
author: qinyi
created_at: 2026-10-16 00:25:57
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-07, FR-11]
decision_ids: [D-004@v1, D-012@v1]
allowed_paths:
  - NEW:frontend/src/components/changes/detail/change-files-panel.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-files-panel.test.tsx
target_files:
  - NEW:frontend/src/components/changes/detail/change-files-panel.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-files-panel.test.tsx
goal: >
  承载「文件与对账」tab：文件树在 tab 内直接内嵌（左树右预览，不再以弹窗为唯一入口）、范围对账卡由侧栏常驻改为挂在本面板、关联快速任务沿用空/失败静默隐藏语义；整面板懒挂载（切到该 tab 才取数）。
implementation:
  - "新建 frontend/src/components/changes/detail/change-files-panel.tsx：props { workspaceId, changeId, changeKey, archived }；三块自上而下——变更文件（内嵌 ChangeFileTree，props 直传 workspaceId/changeId）、范围对账（复用 ScopeAuditCommandCard，target 框为 { kind: change, workspaceId, changeKey }，archived 透传）、关联的快速任务（复用 QuicklogLinkedCard）"
  - "文件树内嵌形态：直接挂载 frontend/src/components/change-file-tree.tsx 的 ChangeFileTree（该组件自渲染左树 + 右预览/diff，无 Dialog 依赖），MUST NOT 再包一层「打开」按钮 + Dialog"
  - "懒挂载：本面板由 task-07 以「仅当前 tab 挂载」方式接线（面板本体不自行判断 tab）；面板内部不额外做 request 节流（沿用组件默认）"
  - "单测 frontend/src/components/changes/detail/__tests__/change-files-panel.test.tsx：三块渲染在场、ChangeFileTree 以 props 直传（无 Dialog 包裹）、ScopeAuditCommandCard 收到 changeKey 与 archived、QuicklogLinkedCard 空态不渲染时面板其余部分不受影响"
acceptance:
  - "面板渲染三块：变更文件 / 范围对账 / 关联的快速任务（后两块按各自既有空态/隐藏语义处理）"
  - "ChangeFileTree 在面板内直接渲染（DOM 上不存在「打开」按钮作为其唯一入口）"
  - "ScopeAuditCommandCard 收到 changeKey 与 archived 透传值（用 mock 断言 props）"
  - "面板文件内无新增 fetch（仅编排与透传）"
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
  - "cd frontend && pnpm exec vitest run frontend/src/components/changes/detail/__tests__/change-files-panel.test.tsx"
constraints:
  - "不改 ChangeFileTree / ScopeAuditCommandCard / QuicklogLinkedCard 内部实现（黑盒复用；后两者导出与行为是移动端契约）"
  - "不删 change-files-card.tsx（既有消费面保留，仅桌面改由本面板承载）"
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
