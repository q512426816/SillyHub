---
id: task-01
title: 'ErrorBanner 公共组件 + 8 处手写红条替换'
title_zh: 'ErrorBanner 公共组件 + 8 处手写红条替换'
author: 'qinyi'
created_at: 2026-08-20 22:30:00
priority: P0
depends_on: []
blocks: [task-02, task-03]
requirement_ids: [FR-01]
decision_ids: [D-301]
allowed_paths:
  - frontend/src/components/ui/error-banner.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/explorer/page.tsx
  - frontend/src/components/workspace/shared-daemon-manager.tsx
provides:
  - contract: ErrorBanner
    fields: [message, onRetry]
goal: >
  新增统一错误条组件 ErrorBanner（可选内嵌重试按钮，destructive 语义色走主题 token 双主题跟随），
  并替换 8 处手写 bg-red-50 红条（7 个子页面 page.tsx + members 页内嵌组件 shared-daemon-manager.tsx），
  容器保留 role=alert 兼容既有测试断言，为 Wave2/3 各页套用提供公共件基础（FR-01 / D-301 公共件先行）。
implementation:
  - 新建 frontend/src/components/ui/error-banner.tsx——props 形态参照 empty-state.tsx（interface 定义 + cn 合并透传 className），签名严格按 design §7——message 字符串必填、onRetry 可选回调
  - 容器 div 必须带 role=alert——explorer-page.test.tsx:254 与 shared-daemon-manager.test.tsx:171 均有 getByRole(alert) 断言，角色缺失即测试红
  - 容器样式规格——rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive，全走 destructive 语义 token，不写 bg-red-50 与任何 tone 色值
  - onRetry 存在时右侧内嵌 shadcn Button size=sm（文案重试，点击调 onRetry）；未传时仅渲染 message 文本
  - 8 处替换（design §5 项1）——components/page.tsx:119、changes/page.tsx:514、skills/page.tsx:51、mcp/page.tsx:53、mcp-tokens/page.tsx:119、members/page.tsx:141、explorer/page.tsx 内本地组件 ExplorerStatePanel 的 124-131 行（第三种规格变体 rounded-lg px-4 py-3 text-sm 一并收敛为统一规格）、workspace/shared-daemon-manager.tsx:124（原手写条已带 role=alert，等价迁移）
  - 仅 members:141 带既有重试行为——onRetry 接 refresh 回调并保留 loading 期间禁用；其余 7 处仅传 message，错误文案逐字保留（explorer 多错误 messages.join 拼接与兜底文案在调用侧组好字符串再传 message）
acceptance:
  - error-banner.tsx 导出 ErrorBanner 且签名与 design §7 一致——message 必填 + onRetry 可选
  - 容器含 role=alert 且规格五要素齐全（rounded-md / border-destructive/30 / bg-destructive/10 / px-3 py-2 / text-xs），新组件内无 bg-red-50
  - grep bg-red-50 在 8 个替换目标文件全部清零
  - explorer-page.test.tsx:254（alert 角色含请求超时文案）与 shared-daemon-manager.test.tsx:171（alert 含错误文案）断言不改自通过
  - tsc --noEmit 0 error 且 allowed_paths 9 文件外零改动
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/components/ui/error-banner.tsx
  - cd frontend && pnpm vitest run src/app/\(dashboard\)/workspaces/\[id\]/__tests__/explorer-page.test.tsx src/components/workspace/shared-daemon-manager.test.tsx
  - cd frontend && grep -rn bg-red-50 src/app/\(dashboard\)/workspaces/\[id\]/components/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/changes/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/skills/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/mcp/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/mcp-tokens/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/members/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/explorer/page.tsx src/components/workspace/shared-daemon-manager.tsx（预期无输出）
constraints:
  - 纯样式替换零行为变更——不动数据流/API 调用/加载与空态逻辑（空态与返链属 task-02/03 范围）
  - role=alert 必须保留——两测试文件 getByRole(alert) 断言依赖，遗漏即回归
  - members 重试行为等价迁移——onRetry 接 refresh 且 loading 期间禁用，不新增不删减交互
  - 不改测试文件——alert 断言经保留设计免改；若其它断言受波及，同步归 task-06 统一验收
  - destructive 全走主题 token 不硬编码 red 色值；本卡 9 文件外零改动
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
