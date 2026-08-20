---
author: qinyi
created_at: 2026-08-20T17:20:00
scale: large
source_change: 2026-08-20-workspace-subpages-style-unify
---

# 设计文档（Design）— 工作区子页面样式统一（批量）

> 基线：概览页工作台式（2026-08-20-workspace-overview-redesign 已上线）+ FRONTEND_PAGE_STYLE.md §0.5 主题系统。
> 摸底：本会话 Explore 代理 8 页逐页调研（差距清单含 file:line，存于会话记录；本设计引用其结论）。

## 1. 背景

概览页工作台化后，8 个子页面（components/changes/sessions/explorer/skills/mcp/mcp-tokens/members）风格掉队：灰调硬编码已清零（品牌蓝清扫覆盖），但共性交互模式各自为政——6 页手写错误条、4 页 PageHeader title 内嵌返回链接 hack、4 页手写空态、3 页 h-7 自写小按钮、5 处语义色硬编码、2 页手写表格规格互异、列表卡无 hover、members 中英文混杂。

## 2. 设计目标

8 页对齐工作台风格：共性模式抽公共组件/规范，逐页套用；全部走主题系统（双主题跟随）。

## 3. 非目标

- ❌ 不拆 changes/page.tsx 675 行大文件（重构另立项）
- ❌ 不改业务逻辑/数据流/API 调用
- ❌ 不重设计各页信息架构（只统一模式与质感）
- ❌ 不再做 HTML 原型（风格已由概览页+主题系统定型，本变更是模式套用）

## 4. 拆分判断

批量模式（8 相似页 × 统一模板）：公共件先行一个 Wave，逐页套用分 Wave，任务 ≤10。

## 5. 总体方案（9 项共性修复）

| # | 项 | 方案 | 覆盖页 |
|---|---|---|---|
| 1 | 错误条统一 | 新组件 `components/ui/error-banner.tsx`（destructive 语义色走主题 token，内嵌可选"重试"shadcn Button size=sm；规格：rounded-md border-destructive/30 bg-destructive/10 px-3 py-2 text-xs） | **8 处**：components:119/changes:514/skills:51/mcp:53/mcp-tokens:119/members:141 + explorer:124-131（ExplorerStatePanel 第三种规格变体）+ workspace/shared-daemon-manager.tsx:124（members 页内嵌组件，Grill 补） |
| 2 | 返回链接规范化 | 移除 title 内 span hack，统一放 PageHeader actions（`← 工作区` 文字链接 text-xs text-muted-foreground hover:text-foreground）；**返回目标统一为 /workspaces/${id} 详情页**（components 现指向列表页，一并收敛） | components/skills/mcp/mcp-tokens（4 页） |
| 3 | 空态统一 | 手写居中 div 换现成 EmptyState 组件（mcp-tokens 已在用的那个） | skills/mcp/members/components（4 页） |
| 4 | 语义色 token 化 | amber/emerald/red/blue tone 卡与文字改主题类（**warning/success/error/info 语义色 + 透明度修饰**，如 bg-warning/10 text-warning；changes:521,530、explorer:105-107、mcp:124、mcp-tokens:271-276） | 4 页 5 处 |
| 5 | 小按钮规范 | h-7 自写按钮换 shadcn Button size="sm" variant="outline"/"ghost"；**components 页的 10 个 NAV Link 用 buttonVariants 组合**（changes:19 先例），搜索 input 同步规格 | components/skills/mcp（3 页） |
| 6 | 表格规格统一 | members/mcp-tokens 手写表对齐统一规格（表头 px-4 py-3 bg-muted/40、行 hover:bg-muted/25、文字规格同 FRONTEND_PAGE_STYLE §4 精神；不换 DataTable——两页表结构简单换动过大） | 2 页 |
| 7 | 列表卡 hover | skills/mcp 每项一卡的列表加 SectionCard hover="lift" | 2 页 |
| 8 | 中文化 | members 表头（User/Role/Granted At/**Actions**→用户/角色/授权时间/操作）、按钮（+ Add Member→+ 添加成员）、subtitle（管理 workspace 成员→管理工作区成员） | members |
| 9 | 容器/锚修正 | sessions 右侧自写 rounded-md border div → SectionCard（workspace-session-section.tsx:242）；explorer 高度锚 56px→64px（TopBar h-16 后过时，:166）+ antd Button 混用换 shadcn | sessions/explorer |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/ui/error-banner.tsx` | 统一错误条（含可选重试） |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx` | 按上表逐项套用（返链/空态/NAV 按钮） |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` | 语义色 2 处（错误条归 task-01） |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/sessions/page.tsx` | 薄壳页无样式改动（容器修正在 session-section 组件）——不入 task allowed_paths，本行仅说明 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/explorer/page.tsx` | 语义色/错误条（本地组件）/高度锚/按钮 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx` | 返链/空态/hover/h-7 按钮/错误条 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx` | 返链/空态/hover/h-7 按钮/amber/错误条 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx` | 返链/语义色/表头规格/错误条 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx` | 空态/表头/中文化/错误条 |
| 修改 | `frontend/src/components/workspace-session-section.tsx` | 右侧容器 SectionCard 化 |
| 修改 | `frontend/src/components/workspace/shared-daemon-manager.tsx` | :124 错误条换 ErrorBanner（Grill 补） |
| 修改 | `frontend/src/components/workspace-member-row.tsx` | 行 hover 统一（tr :61 现 hover 缺失，Grill 补） |
| 修改 | 受影响测试（各页 __tests__ 若断言旧类名/文案——members 中文化会命中） | 断言同步 |

## 7. 接口定义

```tsx
// error-banner.tsx
export function ErrorBanner(props: { message: string; onRetry?: () => void }): JSX.Element;
```

其余为既有组件复用（EmptyState/PageHeader actions/SectionCard hover/shadcn Button），无新契约。

## 8. 生命周期契约

不涉及生命周期契约（纯前端样式/展示层，无 session/lease/daemon 状态变更）。

## 9. 数据模型 / 兼容策略

不涉及数据模型。兼容：纯展示层零行为变更；members 中文化属文案变更（若测试断言英文需同步）；回退=单 commit revert。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 8 页逐项套用遗漏/错改（9 项 × 8 页矩阵大） | P1 | plan 按页分 Wave 逐页闭环+逐页 grep 自检；统一验收清单 |
| R-02 | 空态/文案断言失败（实证位置：skills:90 / mcp:116 / changes:424 空态文案；members 无测试） | P1 | 逐页跑相关测试，断言同步改写 |
| R-03 | explorer 高度锚改动影响布局（56→64 错位） | P2 | Docker 实测该页滚动/分栏 |
| R-04 | explorer 页 antd Button→shadcn 的行为差异（loading 态等） | P2 | explorer 仅 2 处 Button（:23,:180）换 shadcn，交互简单；changes 页实测无 antd Button（仅表单件），不动 |

## 11. 决策追踪

decisions.md：D-301 抽公共组件策略（方案 A）、D-302 批量模式不重复出原型（风格已定型）、D-303 手写表不换 DataTable（保守统一规格）、**D-304 规范适用范围**（FRONTEND_PAGE_STYLE 旧 antd 全量条款以 PPM 列表页为基准；工作区工作台式页面按 §0.5+概览页基线 shadcn 方向执行，§4 DataTable 强制/§5 antd Button 强制/§9 bg-red-50 模板/§11 Don't 在本范围不适用——规范文件头部已加适用范围声明）。无未解决决策。

## 12. 自审（Self-Review）

| 检查项 | 结果 |
|---|---|
| 需求覆盖（8 页×9 项） | ✅ §5 矩阵+§6 清单 |
| 非目标明确 | ✅ §3 |
| 章节齐全 | ✅ |
| 文件清单真实性 | ✅ 摸底代理逐页 file:line 实证 |
| YAGNI | ✅ 不拆大文件/不换 DataTable/不重做原型 |
| 验收可测 | ✅ 逐页 grep+测试+Docker 抽查 |
| ⚠️ 自审存疑 | 无 |
