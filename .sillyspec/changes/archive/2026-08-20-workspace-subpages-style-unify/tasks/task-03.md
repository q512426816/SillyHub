---
id: task-03
title: 'A 组·三页套用（changes/explorer/mcp-tokens）'
title_zh: 'A 组·三页套用（changes/explorer/mcp-tokens）'
author: 'qinyi'
created_at: 2026-08-20 22:30:00
priority: P0
depends_on: [task-01]
blocks: [task-06]
requirement_ids: [FR-02, FR-04]
decision_ids: [D-301, D-302]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/explorer/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx
expects_from:
  - task: task-01
    contract: ErrorBanner
    fields: [message, onRetry]
goal: >
  按 plan 任务总表的文件分组套用 A 组三页 changes/explorer/mcp-tokens 的共性项——
  语义色 token 化（design §5 项 4 的 5 处中本卡负责 4 处，mcp:124 归 task-02）与
  mcp-tokens 返链入 actions（§5 项 2），硬编码 tone 清零、双主题跟随（FR-02/04）。
implementation:
  - changes:520-526 重扫成功条 emerald tone（border-emerald-200 bg-emerald-50 text-emerald-700）换语义色 success——按 design §5 项 4 规格用 bg-success/10 text-success 加透明度修饰的写法
  - changes:528-538 解析警告列表 text-amber-600 换 text-warning 语义色
  - explorer:104-108 ExplorerStatePanel 三降级卡 toneClasses 的 amber/red/blue 硬编码换 warning/error/info 语义色 token（双主题跟随，卡片结构与文案不动）
  - mcp-tokens:271-276 StatCard toneClass 的 emerald/amber/red 三项换 success/warning/error 语义 token；neutral 的 bg-brand-50 text-brand-700 已是品牌语义阶保留不动
  - mcp-tokens:87-97 返链移出 PageHeader title 内嵌 Link hack，改放 actions 区，规格与 task-02 统一——文字「← 工作区」text-xs text-muted-foreground hover:text-foreground，目标 /workspaces/<id> 工作区详情页
  - 逐页自检——grep 三页 amber/emerald/blue tone 硬编码清零（bg-red-50 错误条归 task-01 不算在内）
acceptance:
  - 三页 grep 确认 amber/emerald/blue tone 硬编码清零（红条 destructive 类除外，归 task-01）
  - mcp-tokens 返链位于 actions，目标与 task-02 四页一致为 /workspaces/<id>
  - 双主题（blue/ai-native）下 success/warning/error/info 色随 html data-theme 切换
  - mcp-tokens 页面既有测试通过；changes/explorer 无断言回归
  - 零业务逻辑/API/数据流变更（纯展示层）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/app/(dashboard)/workspaces/[id]/mcp-tokens
  - cd frontend && grep -rn "amber\|emerald" 本卡三个 page.tsx 应清零（命中即回改）
constraints:
  - 不碰错误条——changes:514-518/explorer:124-131/mcp-tokens:119-123 已由 task-01 换 ErrorBanner（本卡 expects_from 消费），重复处理会冲突
  - explorer 高度锚与 antd Button 修正不在本卡（task-05）
  - changes/page.tsx 675 行大文件不拆分不重构（design §3 非目标），仅改命中行
  - mcp-tokens 的 StatCard/表格规格不动结构，只换 tone 类
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
