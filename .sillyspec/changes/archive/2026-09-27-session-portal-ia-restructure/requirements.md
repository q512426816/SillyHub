---
author: flow-machine-draft
created_at: 2026-09-27T10:15:36.195Z
---
# 需求规格（Requirements）— 2026-09-27-session-portal-ia-restructure

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 功能零丢失对照验收
Given 变更目录内存档 `feature-inventory.md`（三栏全量功能清点：左栏筛选/群聊/树/批量/行操作、中栏头部/横幅/消息流/段卡/队列/定时/团队/分叉/子代理/滚动/搜索、右栏文件预览/子代理详情，共 100+ 功能点）
When 重组实现完成后逐项对照该清单
Then 每个功能点仍可达（位置/触发方式允许变化，功能语义与数据口径不变），无任何功能被删除或语义缩水

### FR-02: 中栏右列升级为会话详情侧栏（三模式）
Given 桌面端单聊会话（SessionPanel page 模式）打开
When 用户点击头部「详情」开关或子代理卡片/目录
Then 右列在「收起 / 详情 / 子代理」三模式间切换：详情模式含三组——概览（状态/#id 点击复制/机器/工作区/共享徽标/引擎供应商/模型/档案/创建人/轮次/创建时间）、用量（SessionUsageBar 六项指标+按模型明细）、任务（TaskExecutionPanel 三页签，实时事件注入链路保持）；子代理模式为现有 SubagentDetailPanel 不变；开合 localStorage 记忆（模式由子代理选中态派生不落盘）；宽度沿用现有 resizer 与宽度键；desktop 全部 page 宿主可用（含分身浮层/悬浮助手，不依赖子代理宿主 props）

### FR-03: 中栏头部两层化降噪
Given 桌面端单聊会话打开
When 渲染面板头部
Then 主行仅保留：标题 + 状态徽标（StateLabel 语义）+ 视图切换（对话/进度）+ 后台目录 + 子代理目录 + 详情开关 + 搜索 + 打断；原头部一行内的 #id 短码（点击复制保留）、机器名、工作区名、平台共享徽标降级为第二行 muted 小字 meta 行；mobile ⋯ 菜单收纳逻辑不变

### FR-04: 中栏底部堆叠收敛
Given 桌面端单聊会话且右列详情可用
When 渲染消息流与输入区
Then 桌面端消息流上方的 SessionUsageBar 与 TaskExecutionPanel 收纳进右列详情模式（原位置不再渲染）；AgentLog 折叠栏、后台任务提示行、PlanApprovalCard、MessageQueueBar、ScheduledMessagesBar、输入栏、SessionConfigBar、CtxUsageBar 保持原位；mobile 端 SessionUsageBar 与 TaskExecutionPanel 维持原挂载路径不丢失

### FR-05: 左栏筛选区紧凑化
Given 会话列表左栏渲染
When 筛选区布局生效
Then 搜索框与状态下拉并排一行，机器/智能体（及 workspace scope 的「关联」）下拉紧凑排布（flex-wrap 两行内），筛选联动（机器→智能体级联、选机器清智能体）、localStorage 记忆、筛选变化重置展开等行为全部不变

### FR-06: 行为零改动红线
Given 本变更 diff
When 逐行审查
Then 状态机/数据流/轮询/SSE/WS 消息处理/hooks/回调签名零改动（仅 render 组织层与样式类）；深链 ?session=/?new=、四分支（群聊/真会话/预会话/空门户）、草稿、队列、滚动锚定、content-visibility 等行为不变；/m/ 移动端与群聊面板零波及

### FR-07: 样式合规
Given 三主题（blue/ai-native/dark）任意切换
When 渲染会话门户
Then 新增/改动代码零硬编码色值（全走 themes.ts token/CSS var/brand-* 语义阶），正文可读性下限 12px（mono 元数据 11px 例外）

### FR-08: 质量门
Given 实现完成
When 跑相关测试与静态检查
Then 涉及文件既有测试（改断言不改意图）全绿；tsc 零新增错误；eslint 零新增

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-01: `feature-inventory.md` 〇节「重组对照结论」逐条映射表（文档对照物）+ 会话域全量 `frontend/src/components/daemon/__tests__/` 与 `frontend/src/components/sessions/__tests__/` 1387/1390 全绿（3 失败为预存债基线复现，见 design 风险节）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-02: `frontend/src/components/daemon/__tests__/session-usage-panel-mount.test.tsx`「page 模式：右列『详情』打开后渲染，收到当前会话 sessionId」+ `frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx`「desktop：右列『详情』打开后用量条照常渲染」

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-03: `frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx`「不传 variant：根/头部 className 与改前字面量逐字一致，桌面 chrome 原位、无 ⋯ 菜单」（#id 复制/后台目录原位断言）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-04: `frontend/src/components/daemon/__tests__/session-panel-runs-request-dedup.test.tsx` 6 用例全绿（任务面板挂载口径：runsMeta + 任务面板各 1 条——预置详情开合记忆后口径不变）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-05: `frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`（筛选控件 id/联动断言全绿；容器重排不改 data 断言）

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-06: `git diff` 逐行审查（新增逻辑仅 detailOpen 布尔态 + localStorage 持久化 + DetailMetaRow 展示组件；其余为 JSX 挂载点搬移）+ `frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx` mobile 用例全绿（mobile 布局/收纳零回归）+ `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`（portal 层零改动）

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
- FR-07: 涉及文件 grep 无硬编码 hex（detailColumn 全部 bg-card/border-border/text-muted-foreground/brand-* token 类；#id 短码 text-[11px] 属 mono 元数据 11px 例外）
