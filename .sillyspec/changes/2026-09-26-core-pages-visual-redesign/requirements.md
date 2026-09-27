---
author: qinyi
created_at: 2026-09-27 00:58:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 开发者 | 平台使用者（qinyi 及协作者），通过五页面管理变更/工作区/会话 |
| 管理员 | 平台管理员，额外可见工作区设置与成员管理 |

## 功能需求

### FR-01: primer 共享组件库
覆盖决策：D-001@v1, D-002@v1
Given frontend/src/components/primer/ 目录新建完成
When 任意页面 import primer 组件
Then MUST 提供 StateLabel/Counter/UnderlineNav/IssueRow/Timeline/MetaPanel/PageHead/StatGrid/EmptyState/StateIcon 十个原语（props 契约见 design.md 接口定义），MUST 各配 vitest 单测且全绿；组件内 MUST NOT 出现硬编码 hex 色值（全部经主题 token / tailwind 语义类）。

#### 场景：StateLabel 六变体
Given StateLabel 的 variant 取 open/merged/attention/done/error/neutral 任一
When 渲染
Then MUST 输出浅底深字细边框胶囊（含 12px 状态图标 withIcon 默认 true），色值经 themes.ts semantic soft 阶；thin/quick 出身口径 MUST 承接 FR-auto-frontend-020 的徽章语义（轻量出身在归档后仍可辨识）。

### FR-02: themes.ts semantic soft 阶扩展
覆盖决策：D-001@v1
承接: FR-styles-004, FR-styles-007
Given themes.ts 现有 semantic 五档单值结构
When 扩展 soft 浅底阶
Then 三主题（blue/ai-native/dark）MUST 各配 soft 值（dark 用语义色半透明底模式）；既有 semantic 单值字段 MUST 保留（消费方零破坏）；antd ConfigProvider token 取值 MUST NOT 回退手写。

### FR-03: 变更中心列表页重排
覆盖决策：D-001@v1, D-003@v1
承接: FR-auto-frontend-011
Given 用户进入工作区变更中心页
When 页面渲染
Then MUST 呈现四层结构（面包屑→PageHead 标题+计数+主按钮→工具条→UnderlineNav 状态 tab+IssueRow 列表）；antd Table MUST 退役；状态 tab 过滤 MUST 即时切换且 Counter 计数实时刷新（quicklog tab 筛选语义承接）；智能轮询（30s 全终态停轮）、深链、批量操作、排序 MUST 保留；PlatformSyncSection 与解析警告 MUST 收敛为页头下方单条可展开 flash 告警条（无冲突/警告时 MUST NOT 占用空间）。

### FR-04: 变更详情页重排
覆盖决策：D-001@v1, D-003@v1
承接: FR-auto-frontend-013, FR-auto-frontend-019, FR-auto-frontend-020
Given 用户进入某变更详情页
When 页面渲染
Then MUST 呈现六阶段 checks 横条（当前阶段高亮、可点筛选，阶段-时间线联动语义承接）+ 左主列 Timeline（事件流+Agent 执行日志内嵌可折叠）+ 右侧 296px MetaPanel（负责人/消耗/变更文件/关联会话/快速任务/观测事件分组）；沉淀资产卡挂载 MUST 保留（FR-auto-frontend-019 承接）；次线既有五张异构卡 MUST 收敛进 MetaPanel/时间线两区，MUST NOT 丢失任何既有信息字段。

### FR-05: 工作区列表页重排
覆盖决策：D-001@v1, D-003@v1
承接: FR-auto-frontend-008, FR-auto-frontend-009, FR-auto-frontend-010
Given 用户进入工作区选择页
When 页面渲染
Then MUST 呈现 Repositories 行式列表（状态点+名称+路径 mono+技术栈+守护状态 StateLabel+进行中 Counter+更新时间），workspace-card 卡片网格 MUST 退役；拖拽排序 MUST 保留（drag-grid 改造为纵向行容器）；重新扫描入口/列表卡片信息字段/排序切换与 URL 参数 MUST 全部承接；手写「上一页/下一页」分页 MUST 替换为规范分页；删除确认 MUST 从 window.confirm 改为 antd Modal（MUST NOT 保留 window.confirm）。

### FR-06: 工作区概览页重排
覆盖决策：D-001@v1, D-003@v1
Given 用户进入某工作区概览页
When 页面渲染
Then MUST 呈现白底页头（方块头像+名称+可见性胶囊+操作组）+守护状态横幅+StatGrid 统计四格+左右两栏（活跃变更/最近会话+About 侧栏）；深色渐变 Hero MUST 退役；原生 select/input/textarea 表单控件 MUST 替换为 antd 控件；amber 硬编码横幅 MUST 换语义 token。

### FR-07: 会话门户展示层重做
覆盖决策：D-001@v1, D-003@v1
Given 用户进入会话门户
When 三栏渲染
Then 左栏条目 MUST 为两段式（状态点+标题+相对时间/引擎+轮数）且选中态左缘 2px 指示条；中栏四分支（群聊/真会话/预会话/空门户）MUST 全部 Primer 化（空门户用 EmptyState）；消息块、代码块、工具调用胶囊 MUST 按原型样式；红线：MUST NOT 改动 props 接口、状态机、数据流、轮询与 WS 消息处理逻辑（仅 render 与样式类）。

### FR-08: 交互统一修复
覆盖决策：D-003@v1
Given 五页面内存在删除/危险操作与列表操作
When 触发
Then 删除类操作 MUST 走 antd Modal（高危场景名称输入确认，对齐 FRONTEND_PAGE_STYLE §8）；列表行 hover MUST 浮现快捷操作；空列表 MUST 呈现 EmptyState（MUST NOT 呈现破碎的 `—` 表格空态）。

### FR-09: 规范回写与硬编码色清零
覆盖决策：D-002@v1
Given 五页面迁移完成
When 规范回写
Then FRONTEND_PAGE_STYLE.md MUST 增补 primer 组件用法章节并改写 D-304 双体系豁免条款（按钮统一 primer preset）；本次涉及文件内 MUST NOT 残留 bg-green-50/text-slate-800/border-amber-300 类硬编码色（grep 清零核对）；top-bar 面包屑 slate MUST 换语义 token。

### FR-10: 三主题兼容验证
覆盖决策：D-001@v1
承接: FR-styles-004, FR-styles-007
Given blue/ai-native/dark 三主题
When 逐页切换主题查看五个页面
Then 观感 MUST 达标（GitHub 布局语言不变、色值随主题），dark 主题 MUST NOT 依赖新增的逐类补丁；浅色两主题既有页面 MUST 零回归（FR-styles-007 承接）。

## 非功能需求

- 兼容性：三主题全兼容；antd 控件（Input/Select/Modal/Tooltip）与 ConfigProvider token 机制不变；既有 API 类型零改动。
- 可回退：全部改动单变更原子交付，verify 失败整变更 git revert 即回退，无数据迁移。
- 可测试：primer 组件单测覆盖变体矩阵；页面测试改断言不改意图（规则 9）；正文可读性下限 MUST 12px（数据密集 mono 元数据 MAY 11px）。
- 性能：纯展示层改动，MUST NOT 新增网络请求或轮询频率。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-10 | 风格=G 对应三层落地与三主题铁律 |
| D-002@v1 | FR-01, FR-09 | 方案二：组件库先行 + 五页一次迁移 + 规范回写 |
| D-003@v1 | FR-03~FR-08 | 深度=含交互；范围=五页面；非目标写入 design 非目标节 |
