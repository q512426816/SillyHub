---
id: task-04
title: '表格规格统一（members/mcp-tokens）+ members 中文化'
title_zh: '表格规格统一（members/mcp-tokens）+ members 中文化'
author: 'qinyi'
created_at: 2026-08-20 22:30:00
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-05]
decision_ids: [D-302, D-303]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx
  - frontend/src/components/workspace-member-row.tsx
goal: >
  members 与 mcp-tokens 两张手写表的表头/行规格逐字段统一（D-303——不换 DataTable，
  只对齐规格），workspace-member-row 行补 hover；members 页 UI 文案全中文化（design
  §5 项 6/8，FR-05）。W3 任务，与 W2 共文件靠 Wave 串行错开，须 W2 完成后执行。
implementation:
  - members:180-195 表头对齐 mcp-tokens:175-184 统一规格——表头行 border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground，th 统一 px-4 py-3 font-semibold（操作列 text-right）
  - workspace-member-row.tsx:61 tr 由 border-t border-border 补 hover:bg-muted/25，行内 td 的 px-3 py-2 同步对齐 px-4 py-3（以 mcp-tokens:191-196 行规格为基准）
  - mcp-tokens 表复核与 members 逐字段一致——mcp-tokens:191 已有 hover:bg-muted/25、td 已 px-4 py-3，若有出入以统一规格为准修正
  - members 中文化——:183-192 表头 User/Role/Granted At/Actions 换 用户/角色/授权时间/操作；:136 按钮文案 + Add Member 换 + 添加成员；:133 subtitle 管理 workspace 成员 换 管理工作区成员
  - 自检——grep members/page.tsx 确认 User/Role/Granted At/Actions/Add Member 英文 UI 文案清零
acceptance:
  - 两表表头规格逐字段一致（px-4 py-3 bg-muted/40 等），行 hover:bg-muted/25 两表均有
  - members 页表头/按钮/subtitle 无英文 UI 文案
  - member-row 与 mcp-tokens 既有测试通过（members 页无测试，design R-02 实证）
  - 表结构/列数/数据绑定零变更（只改类名与文案）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/workspace-member-row.test.tsx src/app/(dashboard)/workspaces/[id]/mcp-tokens
  - cd frontend && grep -n "User\|Role\|Granted At\|Actions\|Add Member" src/app/(dashboard)/workspaces/[id]/members/page.tsx 应清零（命中即回改，注意 is_current_user 等代码标识不算 UI 文案）
constraints:
  - 不换 DataTable——两页表结构简单换动过大（D-303，design §5 项 6）
  - 空态/错误条不在本卡——members:141 错误条归 task-01、members:167 空态归 task-02，W3 执行时二者已就位，勿回退
  - 中文化仅限指定清单（表头四项/添加成员按钮/subtitle），不扩大到 confirm 弹窗与注释
  - 成员行 role dropdown 的 h-7 select 规格不在本卡统一范围（保持现状，避免与 task-02 的按钮规范混淆）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
