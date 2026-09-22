---
author: qinyi
created_at: 2026-09-09T00:40:00
scale: large
risk_level: unit-sufficient
prototype: prototype-sessions-file-browser.html
---

# 设计文档（Design）— 会话页三分屏：会话 ⇄ 工作区文件浏览器

## 1. 背景

用户在会话页对话时经常需要查看工作区里的文件（「刚才那个文件改了什么」「这个配置长什么样」），现状必须切到工作区详情的「文件」tab，离开会话上下文，回来后会话列表滚动位置/筛选态可能已丢。用户明确要求（原话）：会话工作区中加切换按钮切到工作区文件目录（带返回会话按钮），点文件在会话窗口右侧再分一列展示内容——三分屏（结构树 / 会话窗 / 文件内容），三栏可自由调整宽度。

四端能力已全部存在（2026-08-18-workspace-file-browser 落地）：backend explorer 模块（`/workspaces/{wid}/explorer/tree|file|download|search`，daemon WS RPC 代理 + root containment 安全校验）、前端 `lib/explorer.ts`（useExplorerTree/useExplorerFile）、`components/explorer/file-explorer.tsx`（树+搜索+懒加载）、`file-preview.tsx`（代码高亮/图片/Markdown/二进制/全屏/下载）、`ui/panel-resizer.tsx`（usePanelWidth + PanelResizer 拖宽通用件，localStorage 记忆）。本变更是**纯前端组合复用**，零后端/daemon 改动。

## 2. 设计目标

- FR-01 左栏二模：会话列表 ⇄ 工作区文件树，头部按钮切换；文件模式头部固定「← 返回会话」。
- FR-02 两入口都支持：scope 入口（workspace/change/quicklog）直切本工作区；全局 /sessions 跟随当前选中（会话/群聊/预会话）解析工作区，无选中时切换按钮置灰 + 悬浮提示。
- FR-03 右侧文件内容列：点文件才展开（不占空间），FilePreview 只读预览；「✕」关闭整列；切回会话列表保留已打开文件（边聊边看）。
- FR-04 三栏宽度均可拖拽调整（PanelResizer：拖拽/双击复位/键盘微调，localStorage 记忆），中栏自动伸缩。
- FR-05 预览状态按 {workspaceId, path} 存储防跨工作区串档。

## 3. 非目标

- 不做文件编辑/保存（explorer API 只读，编辑走变更文件镜像链路）。
- 不动后端/daemon/数据库/接口契约（api-types 不重生成）；生命周期契约：无/N/A——不改任何会话/群聊/daemon 会话状态机，leftMode/filePreview/selectedWorkspaceId 均为纯前端视图态。
- 不改工作区详情「文件」tab 页（explorer 页保持独立入口）。
- 不在 dialog 弹窗/悬浮会话宿主加文件浏览（仅 SessionsPortal 页面形态）。
- 移动端 variant 不做三栏（窄屏拖宽无意义，文件浏览走工作区 explorer 页）。

## 4. 拆分判断

单变更收口：交互闭环是一个整体（切换↔树↔预览↔三栏布局），拆两个变更会把中间态搞成半屏残废。规模 large（新增 1 组件文件 + 改 portal/list-panel 两文件 + 2 测试文件 ≈ 5 文件、有状态机二模/上下文解析），走 plan 拆 Wave。

## 5. 总体方案

### 5.A 布局结构（portal 主栅格改造）

现状 `grid-cols-[320px_minmax(0,1fr)]` 改为 flex 行（宽度受控于 usePanelWidth）：

```
PageContainer(h-[calc(100vh-64px)])
├── PageHeader（不变）
└── <div flex min-h-0 flex-1>                    ← 原 grid 换 flex
    ├── [左栏 style=leftWidth]                    ← leftMode 二模
    │   ├── sessions 模式：SessionListPanel（headerExtra 注入「📁」切换钮）
    │   └── files 模式：PortalFileTreePanel（← 返回会话 + 工作区文件 + FileExplorer）
    ├── PanelResizer(左栏 240–560，默认 320，key sessions.left)
    ├── [中栏 flex-1 min-w-0]                     ← 既有四分支不动（群/会话/预会话/空态）
    └── filePreview 时追加：
        ├── PanelResizer(右列 320–860，默认 480，key sessions.filePreview)
        └── [右列 style=previewWidth] PortalFilePreviewPanel（✕ 关闭 + FilePreview）
```

- 会话模式下左栏同样可拖宽（原 320px 固定 → 可调，顺带收益，行为对齐 FR-04「三栏」语义）。
- files 模式卸载 SessionListPanel（react-query 缓存恢复列表数据；筛选/展开态本就 localStorage 持久化，重挂无损）。

### 5.B 工作区上下文解析（fileWorkspaceId）

**主链：各选中点显式快照**（Grill 审查修正——派生链有两处永不到达缺口：群深链只 setSelectedGroupId 不回填 selectedGroup；旁路列表 limit=100/archived:false 之外的选中会话 find 永不命中）。新增 state `selectedWorkspaceId: string | null`，在每个选中变化点同步维护：

| 选中点 | 快照来源 | 清除时机 |
|---|---|---|
| 列表 onSelect(s) | `s.workspace_id`（行对象直取，非列表查找） | 同点写入 |
| 群 onSelectGroup(group) / handleGroupCreated | `group.workspace_id`（必填） | 同点写入 |
| 群深链 ?session=<gid> | getAgentSession 返回体 `workspace_id`（深链验证请求已带全字段，session_kind=group 同样返回） | 同点写入 |
| 会话深链 ?session=<id> | 同上（getAgentSession.workspace_id，天然覆盖 100 条外/已归档） | 同点写入 |
| enterPreSession（预会话） | preContext.workspaceId（可能 null=非工作区组） | 同点写入 |
| 删除/归档等清选中路径 | — | 置 null |

派生兜底（快照缺席的瞬态）：scope 入口恒 `scope.workspaceId`；全局模式 selectedWorkspaceId null 时按钮置灰，title「请先选择一个会话，再查看其所属工作区的文件」。

解析是纯 state 派生，随选中变化自动跟随；files 模式中切换选中（中栏还在）不强制退出文件模式——树保持当前 fileWorkspaceId（进模式时快照），避免树闪跳。预览列状态独立：`filePreview: { workspaceId, path } | null`，点文件时以**当时树的工作区**落值，关列才清。

### 5.C 组件与状态

**新文件 `components/sessions/portal-file-panels.tsx`**（薄壳，~150 行）：
- `PortalFileTreePanel({ workspaceId, onBack, onSelectFile })`：头部（← 返回会话按钮 + 「工作区文件」标题）+ `<FileExplorer workspaceId onSelectFile>`（自带搜索/懒加载/错误态/刷新）。
- `PortalFilePreviewPanel({ workspaceId, filePath, onClose })`：头部（✕ 关闭 + 文件路径 + FilePreview 自带头部的下载/全屏在其内部）+ `<FilePreview workspaceId filePath>`。
- 导出宽度常量与 storageKey：`SESSIONS_LEFT_PANEL_WIDTH_LS_KEY`（默认 320，240–560）、`SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY`（默认 480，320–860）。

**`sessions-portal.tsx` 增量**：
- state：`leftMode: "sessions" | "files"`（初始 sessions）、`filePreview: { workspaceId: string; path: string } | null`。
- `fileWorkspaceId` useMemo（5.B 链）；`filesModeWorkspaceId` 进模式时快照（state），返回会话清快照不清预览。
- `SessionListPanel` 加可选 prop `headerExtra?: ReactNode`（渲染在头部「共 N 个」右侧），portal 传「📁」切换按钮（aria-label「查看工作区文件」；disabled=title 提示）。其余 scope 消费方不传零变化。
- 布局按 5.A 组装；`aria-label`/`data-testid` 锚点：`sessions-left-files-toggle`、`sessions-files-back`、`sessions-file-preview-column`、`sessions-file-preview-close`。

### 5.D 交互细节

- 点文件 → `setFilePreview({ workspaceId: filesModeWorkspaceId, path })`（同文件重复点幂等）；预览列内 FilePreview 自带 loading/错误/二进制降级。
- 「✕」→ `setFilePreview(null)` 整列（含把手）收起，中栏回宽。
- 「← 返回会话」→ leftMode=sessions（filePreview 保留）；再次进文件模式时若 fileWorkspaceId 已变（用户切了会话）→ 树按新工作区重建，预览列保留旧文件仍可读（explorer 端点按其 workspaceId 取数，不串档）。
- 拖宽把手 aria：左「调整会话列表宽度」/右「调整文件预览宽度」；把手在对应列隐藏时一并卸载。

## 6. 文件变更清单

| 文件 | 动作 | 说明 |
|---|---|---|
| NEW:frontend/src/components/sessions/portal-file-panels.tsx | 新增 | 文件模式左栏壳 + 预览列壳 + 宽度常量 |
| frontend/src/components/sessions/sessions-portal.tsx | 修改 | leftMode/filePreview/selectedWorkspaceId 状态、fileWorkspaceId 解析、flex 三栏布局、headerExtra 注入 |
| frontend/src/components/sessions/session-list-panel.tsx | 修改 | 仅加 `headerExtra?: ReactNode` 可选 prop（头部右侧插槽） |
| frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | 修改 | 新增 describe：切换/置灰/三栏渲染/保留行为（mock explorer 两组件） |
| NEW:frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx | 新增 | 两壳组件：返回/关闭回调、FileExplorer/FilePreview 接线（mock lib/explorer） |

## 7. 接口定义（组件契约）

```ts
// portal-file-panels.tsx
export interface PortalFileTreePanelProps {
  workspaceId: string;          // 文件树目标工作区（进模式时快照）
  onBack: () => void;           // ← 返回会话
  onSelectFile: (path: string) => void;  // FileExplorer 回调直通
}
export interface PortalFilePreviewPanelProps {
  workspaceId: string;          // 预览归属工作区（防串档）
  filePath: string;             // 相对工作区根 POSIX 路径
  onClose: () => void;          // ✕ 关闭整列
}
export const SESSIONS_LEFT_PANEL_WIDTH_LS_KEY: string;   // 默认 320 / 240–560
export const SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY: string; // 默认 480 / 320–860

// session-list-panel.tsx（新增可选 prop，其余不变）
export interface SessionListPanelProps { /* ...既有... */
  headerExtra?: ReactNode;      // 头部「共 N 个」右侧插槽（portal 切换按钮）
}
```

## 8. 决策记录

- **D-001 纯前端复用，不新写任何 explorer 逻辑**：四端链路已存在且带测试；本变更只组合。方案 B（跳转/iframe explorer 页）否决——不同屏；方案 C（新建三栏页重包组件）否决——重复代码回归面大。
- **D-002 切换按钮放左栏头部（headerExtra 插槽）而非 PageHeader**：贴近列表视线焦点；PageHeader 是页面级标题区，承载视图内二模过重。插槽而非侵入式 prop 保证 SessionListPanel 其它消费点零变化。
- **D-003 files 模式卸载 SessionListPanel**：列表数据在 react-query 缓存、筛选/展开态 localStorage 持久化，重挂无损；保持挂载会让两套列表轮询/SSE 并存浪费。
- **D-004 进模式快照工作区 + 预览列独立 {workspaceId, path}**：防「树随选中闪跳」与「跨工作区串档」两类脏状态；预览列生命周期独立于左栏模式（用户确认：切回会话保留）。
- **D-005 左栏默认 320px 与现状一致**：可调是增量能力，默认值不变避免老用户观感突变。
- **D-006 fileWorkspaceId 主链=选中点显式快照 selectedWorkspaceId**（Grill 修正，原 preContext>group>session 派生链否决——群深链不回填 selectedGroup、旁路列表 limit=100/archived:false 外 find 永不命中两处缺口）：快照在各选中点写入（含深链 getAgentSession 返回体 workspace_id，天然覆盖 100 条外/归档），scope 入口恒定 scope.workspaceId。

## 9. 风险与对策

- **R-01 portal 布局改 flex 影响既有四分支高度链**：中栏 min-w-0 + 内部 flex 链与原 grid 等价（grid 1fr ↔ flex-1 min-w-0），sessions-portal 既有 39 用例 + 截图回归兜底。
- **R-02 explorer 端点权限（成员绑定）**：未绑定/daemon 离线返回 404/502，FileExplorer/FilePreview 自带错误卡——工作区页同款降级，无需新处理。
- **R-03 窄视口三栏挤压**：中栏 min-w-0 保证会话窗优先收缩；左/右各有 min（240/320），低于总宽时外层 overflow-hidden + 用户可拖窄/关列。移动端不做（非目标）。
- **R-04 mock 面爆炸**：portal 测试 mock `@/components/explorer/file-explorer|file-preview`（薄壳接线归 portal-file-panels.test，其再 mock `@/lib/explorer` 取数）——两层各测各的，不叠真实渲染。
- **R-05 深链 ?session= 异步解析**：快照来自深链验证请求（getAgentSession）的返回体，验证完成即写入——验证前的短暂置灰是暂态非 bug；测试覆盖深链（含群深链）后按钮翻转。

## 10. 验收标准

1. /workspaces/[id]/sessions：左栏头部「📁」→ 文件树（本工作区），头部「← 返回会话」可回；点文件右侧展开预览列；「✕」收起。
2. /sessions 全局：选中带工作区的会话后「📁」可点；未选中置灰 + title 提示；选中群聊同样可解析。
3. 切回会话列表后预览列保留；重进文件模式树按最新工作区。
4. 左栏/右列把手可拖宽（双击复位），刷新页面宽度记忆。
5. tsc 0 新错误、eslint 0 新告警、sessions-portal + portal-file-panels 测试全绿、既有 explorer 页测试零回归。

## 11. 自审（Self-Review）

- **章节完整性**：背景/目标/非目标/拆分判断/总体方案/文件清单（NEW: 前缀）/接口定义/决策/风险/验收/自审齐备；frontmatter 含 author/created_at/scale/risk_level。
- **与用户确认一致**：三栏结构/切换/返回/调宽 = 用户原话；两入口与「点文件才展开可关闭」= AskUserQuestion 两答；无越权新增决策。
- **独立审查闭环**：Design Grill（independent 子代理）pass/pass，两结构性缺口（群深链不回填 selectedGroup、旁路列表 limit=100 外/归档 find 永不命中）已在 §5.B/D-006/R-005 当日修正为选中点显式快照链，docHash 已 --refresh-hash 对齐。
- **代码事实核对**：PanelResizer/FileExplorer/FilePreview props、GroupChatListItemRead.workspace_id 必填、portal 现状栅格——均经审查子代理 grep 证实（panel-resizer.tsx:21-30、file-explorer.tsx:54-59、file-preview.tsx:341-346、api-types.ts:14825、sessions-portal.tsx:542）。
- **risk_level 修正依据**：CLI 关键词判 integration-critical 系误伤——design 文中 daemon/backend 仅作背景引用（复用既有链路），本变更零后端/daemon 代码改动，纯前端组件组合 + mock 分层测试（R-04），unit-sufficient 足够；浏览器实拍验收（task-04）作人工兜底。
