---
author: WhaleFall
created_at: 2026-07-14T10:20:00
scale: large
---

# 设计文档（Design）— /ppm/projects 页样式规范化

> 变更 `2026-07-14-ppm-projects-style-redesign` · 纯样式调整
> 原型 `prototype-ppm-projects-style.html`
> 依据样式系统 `2026-06-21-frontend-style-system`（已归档，地基已落地）

## 1. 背景

用户要求「按规范重新设计 `/ppm/projects` 页面的样式以及配色」。调研定位现状与前端样式系统规范（方案 B：Token 单一源 + shadcn 视觉组件 + antd 业务组件）之间的差距：

- `/ppm/projects`（`app/(dashboard)/ppm/projects/page.tsx`）页面本身很薄（199 行），核心视觉由共享组件 `components/ppm-resource-table.tsx` 承担，被 **3 个 ppm 列表页**（项目维护/客户/干系人）复用；其「成员管理」抽屉又内嵌第二个共享组件 `components/ppm-project-members-table.tsx`（被项目成员独立页复用）。
- 两个共享组件**已部分消费**样式系统地基（用了 `PageContainer`/`PageHeader`/`SectionCard`/`DataTable`/`Button`，inputCls 用了语义变量 `border-input`/`bg-background`），但仍有大量「不达标」点：
  - **状态/类型用 antd `Tag` 预设色**（`processing`/`success`/`warning`/`blue`/`cyan`/`geekblue`），与 token 语义脱节；项目已有 `StatusBadge`（带圆点 pill）却未被使用。
  - **5 处浮层全手写**：`PpmResourceDrawer` / `DeleteConfirm` / `MemberFormDrawer` / `DeleteMemberConfirm` / `ProjectMembersDrawer`，均用 `fixed inset-0 z-40/50 bg-black/30` 手写遮罩 + `✕` emoji 关闭按钮 + 原生 `<select>`/`<input>`。
  - **toast 硬编码** `border-emerald-300 bg-emerald-50 text-emerald-700`（2 个组件共 4 处）。
  - **搜索区按钮与字段挤在同一行**，与原型「字段行 + 右侧查询/重置 + 标题右侧导出/新增」的布局不符。
  - **表格无主名/副名层次**（原型 `.proj-name` 加粗 + `.proj-sub` 灰）。

## 2. 设计目标

- 将 `/ppm/projects` 及其依赖的两个共享组件，对照「现代明亮活力」原型（主色 `#2563EB` + cyan/emerald 辅 + slate 中性 + 圆角 12 + 柔和阴影 + Inter）深度规范化。
- **状态**改用现成 `StatusBadge`（带圆点 pill，语义色），**类型**改用 antd `Tag` + token 预设色名。
- **浮层**统一为 antd `Drawer`（编辑表单/成员管理）+ antd `Modal`（删除确认），消除手写遮罩/emoji/原生控件。
- **toast / error** 提示语义化，消除硬编码色。
- **搜索区 + 表格**细节对齐原型（操作按钮分区、主名加粗+副名灰）。
- 4 个 ppm 列表页（项目/客户/干系人/项目成员）随共享组件改造一并达标。

## 3. 非目标

- ❌ 不改业务逻辑 / API / 数据流 / 字段定义（纯样式）
- ❌ 不改 antd `Table`/`Pagination`/`Form`/`Select` 组件本体（只调消费方式与渲染分支）
- ❌ 不改 AppShell / 侧边栏 / 顶栏（样式系统 P5 已落地）
- ❌ 不引入新 npm 依赖（antd 6 / radix / lucide 均已装，D-005）
- ❌ 不动 customers 的 `striped` 斑马纹选项（保留）
- ❌ 不做暗色模式 / 移动端响应式（沿用样式系统非目标）

## 4. 拆分判断

单一变更，不拆分、不批量。理由：本次是「共享组件视觉规范化 → 5 页面自动受益」的连贯整体，改两个共享组件即覆盖全部目标页面；无多角色/跨页流转/低耦合独立模块，不满足拆分条件；非「模板 × 数据」，不满足批量模式。多文件适配由 plan 阶段 Wave 分组管理。

## 5. 总体方案（分 Wave，plan 细化）

| Wave | 内容 | 类型 |
|---|---|---|
| W1 | `PpmResourceTable` 改造：① select 字段渲染分支（`statusKind`→StatusBadge / `color`→Tag / `color="default"`→灰 Tag）② 浮层换 antd Drawer（`PpmResourceDrawer`）+ Modal（`DeleteConfirm`）③ toast/error 语义化 ④ 搜索区**完全保持现状布局**(Step13 用户反馈):操作按钮行在字段**上方右对齐**,分两组——**数据组**(导出/新增)在左、**基础组**(查询/重置/展开)在最右、中间分隔;下方 4 列字段网格(≤4 + 展开收起,`visibleSearchFields` 逻辑不变);只规范化按钮/控件样式,不动布局。撤销「导出/新增上移标题右侧」——PageHeader 仅标题/副标题(D-006)⑤ 表格 `project_name` 列文字加粗强调（不强制与编号合并双行，见 G3）| 核心 |
| W2 | `PpmProjectMembersTable` 改造：① 浮层换 antd Drawer（`MemberFormDrawer`）+ Modal（`DeleteMemberConfirm`）② 角色 `Tag color="blue"` 多个 → 多 `Badge`（或保留 Tag 用 token 色）③ toast/error 语义化 | 核心 |
| W3 | `projects/page.tsx` 枚举改造：`PROJECT_STATUS_OPTIONS` 加 `statusKind`（进行中=info/已完成=success/已暂停=warning）；`PROJECT_TYPE_OPTIONS` color 改 token 预设名（研发=blue/实施=cyan/运维=default）；`ProjectMembersDrawer` 换 antd Drawer（D-002） | 核心 |
| W4 | 联调验收：`tsc --noEmit` + `pnpm lint` + Docker rebuild 实测 4 个 ppm 页（项目/客户/干系人/项目成员）+ 成员管理抽屉；grep 验证无 `bg-black/30`/`✕`/`emerald-300` 残留（ppm 范围） | 收尾 |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `frontend/src/components/ppm-resource-table.tsx` | select 渲染分支(StatusBadge/Tag)；`PpmResourceDrawer`→antd Drawer；`DeleteConfirm`→antd Modal；toast/error 语义化；搜索区按钮分区；首列主名/副名层次支持；`PpmFieldOption` 新增 `statusKind` |
| 修改 | `frontend/src/components/ppm-project-members-table.tsx` | `MemberFormDrawer`→antd Drawer；`DeleteMemberConfirm`→antd Modal；角色 Tag→Badge/token 色；toast/error 语义化 |
| 修改 | `frontend/src/app/(dashboard)/ppm/projects/page.tsx` | `PROJECT_STATUS_OPTIONS` 加 statusKind；`PROJECT_TYPE_OPTIONS` color 改 blue/cyan/default；`ProjectMembersDrawer` 换 antd Drawer |
| 新增 | `.sillyspec/changes/2026-07-14-ppm-projects-style-redesign/prototype-ppm-projects-style.html` | 目标视觉原型（已生成） |

> 无新增组件文件、无新增 npm 依赖、无后端改动。

## 7. 接口定义（关键签名变更）

```ts
// ppm-resource-table.tsx —— PpmFieldOption 扩展(D-003/D-004)
import type { StatusKind } from "@/components/ui/status-badge";

export interface PpmFieldOption {
  label: string;
  value: string;
  /** antd Tag 预设色名(blue/cyan/...)；"default"=默认灰 Tag；无 statusKind 时生效。 */
  color?: string;
  /** 有则渲染 StatusBadge(带圆点 pill,语义色),优先级高于 color。 */
  statusKind?: StatusKind;
}

// select 字段渲染分支(ppm-resource-table.tsx columns.render 内):
// 1. hit.statusKind → <StatusBadge kind={hit.statusKind}>{hit.label}</StatusBadge>
// 2. hit.color === "default" → <Tag>{hit.label}</Tag>          // 默认灰
// 3. hit.color → <Tag color={hit.color}>{hit.label}</Tag>      // 预设色
// 4. 否则 → 纯文本 hit.label
```

```ts
// projects/page.tsx —— 枚举改造(D-004)
const PROJECT_TYPE_OPTIONS = [
  { label: "研发项目", value: "research", color: "blue" },
  { label: "实施项目", value: "implementation", color: "cyan" },
  { label: "运维项目", value: "maintenance", color: "default" }, // 原 geekblue → 灰
];
const PROJECT_STATUS_OPTIONS = [
  { label: "进行中", value: "ongoing", statusKind: "info" },
  { label: "已完成", value: "completed", statusKind: "success" },
  { label: "已暂停", value: "paused", statusKind: "warning" },
];
```

```ts
// 浮层(D-002/D-006)——antd Drawer/Modal 签名
import { Drawer, Modal } from "antd";
// 编辑表单:<Drawer open={open} onClose width={520} maskClosable={false} title={`编辑${entityLabel}`}> ...Form... </Drawer>
// 删除确认:<Modal open={open} onCancel title={`确认删除${entityLabel}？`} maskClosable={false} onOk> ... </Modal>
// 注:maskClosable={false} = 点遮罩不关(防误关丢失输入);ESC 与右上角关闭按钮照常(D-006)。
```

> 无后端接口 / DTO 变更。

## 8. 数据模型

不涉及（纯前端样式，无表结构 / 字段变更）。

## 9. 兼容策略（brownfield）

- 项目未上线，无版本兼容负担（CLAUDE.md 规则 11）。
- `PpmFieldOption.statusKind` / `color="default"` 为**新增可选字段**，不传时渲染逻辑与现状完全一致（向后兼容，不影响 customers/stakeholders 现有字段配置）。
- `customers` 页 `striped` / `serverSidePagination` 等现有 props 不变。
- 回退路径：若 antd Drawer/Modal 视觉异常，可回退到手写浮层（保留原实现于 git 历史）；select 渲染分支保持「无 statusKind 无 color → 纯文本」兜底。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | antd Drawer/Modal 与 shadcn 视觉割裂 | P2 | antd 浮层自动消费 ConfigProvider 主题 token（主色 #2563EB/圆角/字体，样式系统 P1 已配）；Docker 实测对比 |
| R-02 | 改 `PpmResourceTable` 撑破 customers/stakeholders 页布局 | P2 | `statusKind`/`color="default"` 向后兼容；逐 Wave 改后 Docker 实测 4 页；保留 striped 等现有 props |
| R-03 | `PpmFieldOption.color="default"` 与 antd Tag 默认行为理解偏差 | P3 | 渲染分支显式判断 `=== "default"` 渲染无 color 的 `<Tag>`；execute 时实测 3 种类型色 |
| R-04 | Docker 前端不热重载，需 rebuild 实测 | P2 | verify 阶段 rebuild + 实际打开页面核对，不只靠 tsc |
| R-05 | grep 残留手写浮层 / 硬编码色遗漏 | P3 | verify 全量 grep `bg-black/30` / `✕` / `emerald-300`（ppm 范围）兜底 |
| R-06 | projects「成员管理」抽屉(antd Drawer)内嵌成员表,其「编辑成员」再开 antd Drawer → Drawer 嵌套两层 | P2 | 内层 Drawer 默认 z-index 高于外层(antd 自动叠加);ESC 默认关最上层;或嵌套场景成员编辑改用 Modal(居中)避免双 Drawer;Docker 实测验证层级与遮罩(G1) |

## 11. 决策追踪

见 `decisions.md`。当前版本决策均被本设计覆盖：
- D-001@v1（范围含两个共享组件）→ §1/§5/§6
- D-002@v1（浮层用 antd Drawer/Modal）→ §5 W1/W2/W3/§7
- D-003@v1（状态 StatusBadge / 类型 Tag）→ §2/§7
- D-004@v1（状态/类型色彩映射）→ §7
- D-005@v1（不引入新依赖）→ §3/§6
- D-006@v1（浮层遮罩不关闭 + 搜索条件布局不变）→ §5 W1④/§7

无未解决决策，无剩余风险。

## 12. 自审

| 检查项 | 结果 |
|---|---|
| 需求覆盖（深度对齐原型/含共享组件/浮层规范/状态配色） | ✅ §2/§5 全覆盖 |
| decisions 引用（D-001~D-005） | ✅ §11 全引用 |
| 约束一致（CONVENTIONS：shadcn 放 ui/、@/ 别名、Tailwind utility-first、antd 业务组件） | ✅ 沿用；复用现有 ui/layout/antd |
| 真实性（路径/类名/字段） | ✅ 来自真实代码（page.tsx / ppm-resource-table.tsx / ppm-project-members-table.tsx / status-badge.tsx / tokens.ts） |
| YAGNI | ✅ 非目标明确；不新增组件/依赖 |
| 验收标准具体可测 | ✅ 见下 |
| 生命周期契约表 | ⬜ 不适用（纯前端样式，无 session/lease/daemon/lifecycle） |
| 兼容/回退 | ✅ §9 |

### 12.1 Design Grill 交叉审查修正（Step 12）

| 编号 | 问题 | 结论 |
|---|---|---|
| G1 | projects「成员管理」抽屉(antd Drawer)内嵌成员表,其编辑/删除再开浮层 → Drawer 嵌套两层 | 补 R-06；内层 z-index 自动叠加,ESC 关最上层,嵌套场景成员编辑可改 Modal |
| G2 | 「导出/新增上移标题右侧」依赖 PageHeader 支持 actions | ✅ 已确认 `page-header.tsx` 有 `actions` 插槽;但 Step13 用户反馈要求按钮留在搜索区上方(布局保持现状),本次不用 actions,PageHeader 仅标题 |
| G3 | 表格「主名加粗+副名灰双行」对 projects 页(编号/名称本就两独立列)是过度设计 | 降级:W1⑤ 改为 project_name 列加粗,不强制双行合并(YAGNI) |
| G4 | toast 是否改 antd message | 待 plan 定,非矛盾 |
| G5 | layout 已有 SearchBar/SearchBarActions 未被 PpmResourceTable 复用 | 本次不复用(保留手写搜索区的展开/收起交互),仅调样式,控制范围 |

**验收标准**（verify 对照）：
1. `ppm` 范围内 grep 不到 `bg-black/30`、emoji `✕` 关闭按钮、`emerald-300` 硬编码色。
2. projects 页状态列 = 带圆点 pill（进行中蓝/已完成绿/已暂停橙）；类型列 = Tag 色块（研发蓝/实施青/运维灰）。
3. 编辑/删除/成员管理浮层均为 antd Drawer/Modal（ESC 关闭、遮罩、动画正常）。
4. 4 个 ppm 列表页（项目/客户/干系人/项目成员）+ 成员管理抽屉功能不回归（CRUD/搜索/导出）。
5. `tsc --noEmit` + `pnpm lint` 通过；Docker rebuild 后实测核心页与原型视觉对照。
