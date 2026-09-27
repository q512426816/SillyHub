## FR-app-pages-001 共享守护进程页面可见
变更：2026-08-28-daemon-agent-share
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1、D-008@v1、D-013@v1
场景正文：
- 场景：默认场景 — Given lender 在工作区 W 打开共享开关（grants 表存在 workspace 级行、enabled=true、daemon 在线） 共享机器离线 U 不满；When U 打开守护进程页面（/runtimes） U 查看守护进程页面 U 拉取 machines/runtimes-page
全文：.sillyspec/changes/archive/2026-08-28-daemon-agent-share/requirements.md#FR-01
最近确认：31e95cf08

## FR-app-pages-002 共享守护进程会话钉定可用
变更：2026-08-28-daemon-agent-share
状态：active
摘要：默认场景
依据决策：D-001@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given FR-01 前提成立（授权 + 在线） U 无授权（非成员/无权限/grant 停用/daemon 离线） lender 关闭共享开关（grant enable；When U 以该机器的 runtime_id 创建交互式会话 U 以该 runtime_id 创建会话 U 再以该 runtime_id 创建会话或查看页面；Then 会话创建成功（AgentSession.user_id=U、runtime=lender 的 runtime、写借用审计行含 grant_id） 维持现有 40
全文：.sillyspec/changes/archive/2026-08-28-daemon-agent-share/requirements.md#FR-02
最近确认：31e95cf08

## FR-app-pages-003 修改类操作保持 owner-only
变更：2026-08-28-daemon-agent-share
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given U 通过共享获得会话使用权；When U 调用别名/可写目录/升级/禁用/移除/清理任一修改类端点；Then 后端维持现状 owner-or-platform-admin 校验（403/404），前端共享卡片不渲染这些入口
全文：.sillyspec/changes/archive/2026-08-28-daemon-agent-share/requirements.md#FR-03
最近确认：31e95cf08

## FR-app-pages-004 平台共享智能体（管理员配置 + 全体可用 + 源码只读·指定目录可写）
变更：2026-08-28-daemon-agent-share
状态：active
摘要：默认场景
依据决策：D-002@v2、D-003@v1、D-006@v1、D-007@v1、D-008@v1、D-009@v1、D-010@v1、D-012@v1
场景正文：
- 场景：默认场景 — Given 用户是平台管理员 任意登录用户（含无 workspace/无 daemon 用户） 共享会话中 agent 读源码工作区文件（Read/Glob/Grep） 共；When 其创建共享智能体（agent_profile_id + pinned_runtime_id + source_workspace_id + writable_d
全文：.sillyspec/changes/archive/2026-08-28-daemon-agent-share/requirements.md#FR-04
最近确认：31e95cf08

## FR-app-pages-005 共享机器/智能体进入会话选择器（用户显式选择）
变更：2026-08-28-daemon-agent-share
状态：active
摘要：默认场景
依据决策：D-004@v2、D-007@v1
场景正文：
- 场景：默认场景 — Given FR-01 前提成立（共享授权 + 在线） 存在生效的平台共享智能体 用户未显式选择共享机器/智能体；When 用户在会话创建（门户/悬浮助手//runtimes 弹窗）打开机器选择器 用户打开档案选择器 悬浮助手解析默认机器；Then 候选列表含共享机器（共享徽标 + 共享人标识），用户显式选择后创建会话（FR-02 放行） 共享智能体可选（platform 可见性既有行为，带共享标识）；选中
全文：.sillyspec/changes/archive/2026-08-28-daemon-agent-share/requirements.md#FR-05
最近确认：31e95cf08

## FR-app-pages-006 git 技能源管理（admin）
变更：2026-09-11-skills-central-library
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given admin 配置源（url+branch+subdir）；When 保存/刷新；Then SSRF 断言通过→subprocess git 浅克隆进缓存根→发现含 SKILL.md 目录（≤200 文件/≤10MB）→last_commit/last
全文：.sillyspec/changes/archive/2026-09-11-skills-central-library/requirements.md#FR-01
最近确认：26daa9e63

## FR-app-pages-007 用户启用绑定与 bundle 第三源
变更：2026-09-11-skills-central-library
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given git 技能已发现（library 列出）；When 用户启用（user_skill_enables） 未启用/源禁用/目录消失；Then 其 bundle 收集该技能目录文件集（rel_path=目录名原样；同名优先级 sillyspec-*>CustomSkill>git 源，后到跳过+warn
全文：.sillyspec/changes/archive/2026-09-11-skills-central-library/requirements.md#FR-02
最近确认：26daa9e63

## FR-app-pages-008 library 聚合视图
变更：2026-09-11-skills-central-library
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户请求 GET /api/skills/library；Then 三源聚合列表（平台内置/我的 CustomSkill/已发现 git 技能）+ 我的启用态
全文：.sillyspec/changes/archive/2026-09-11-skills-central-library/requirements.md#FR-03
最近确认：26daa9e63

## FR-app-pages-009 前端技能页
变更：2026-09-11-skills-central-library
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-11-skills-central-library/requirements.md#FR-04
最近确认：26daa9e63

## FR-app-pages-010 功能零丢失对照验收
变更：2026-09-27-session-portal-ia-restructure
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更目录内存档 `feature-inventory.md`（三栏全量功能清点：左栏筛选/群聊/树/批量/行操作、中栏头部/横幅/消息流/段卡/队列/定时/团队；When 重组实现完成后逐项对照该清单；Then 每个功能点仍可达（位置/触发方式允许变化，功能语义与数据口径不变），无任何功能被删除或语义缩水
全文：.sillyspec/changes/archive/2026-09-27-session-portal-ia-restructure/requirements.md#FR-01
最近确认：e4e593b4cc5ba221ebd773df5105beb4adbd4d83

## FR-app-pages-011 中栏右列升级为会话详情侧栏（三模式）
变更：2026-09-27-session-portal-ia-restructure
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 桌面端单聊会话（SessionPanel page 模式）打开；When 用户点击头部「详情」开关或子代理卡片/目录；Then 右列在「收起 / 详情 / 子代理」三模式间切换：详情模式含三组——概览（状态/#id 点击复制/机器/工作区/共享徽标/引擎供应商/模型/档案/创建人/轮次/
全文：.sillyspec/changes/archive/2026-09-27-session-portal-ia-restructure/requirements.md#FR-02
最近确认：e4e593b4cc5ba221ebd773df5105beb4adbd4d83

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-session-portal-ia-restructure:flow:FR-02
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.ts | frontend/src/components/daemon/__tests__/session-usage-panel-mount.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-session-portal-ia-restructure
  status: active

## FR-app-pages-012 中栏头部两层化降噪
变更：2026-09-27-session-portal-ia-restructure
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 桌面端单聊会话打开；When 渲染面板头部；Then 主行仅保留：标题 + 状态徽标（StateLabel 语义）+ 视图切换（对话/进度）+ 后台目录 + 子代理目录 + 详情开关 + 搜索 + 打断；原头部一行
全文：.sillyspec/changes/archive/2026-09-27-session-portal-ia-restructure/requirements.md#FR-03
最近确认：e4e593b4cc5ba221ebd773df5105beb4adbd4d83

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-session-portal-ia-restructure:flow:FR-03
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-session-portal-ia-restructure
  status: active

## FR-app-pages-013 中栏底部堆叠收敛
变更：2026-09-27-session-portal-ia-restructure
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 桌面端单聊会话且右列详情可用；When 渲染消息流与输入区；Then 桌面端消息流上方的 SessionUsageBar 与 TaskExecutionPanel 收纳进右列详情模式（原位置不再渲染）；AgentLog 折叠栏、后
全文：.sillyspec/changes/archive/2026-09-27-session-portal-ia-restructure/requirements.md#FR-04
最近确认：e4e593b4cc5ba221ebd773df5105beb4adbd4d83

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-session-portal-ia-restructure:flow:FR-04
  tests: frontend/src/components/daemon/__tests__/session-panel-runs-request-dedup.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-session-portal-ia-restructure
  status: active

## FR-app-pages-014 左栏筛选区紧凑化
变更：2026-09-27-session-portal-ia-restructure
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话列表左栏渲染；When 筛选区布局生效；Then 搜索框与状态下拉并排一行，机器/智能体（及 workspace scope 的「关联」）下拉紧凑排布（flex-wrap 两行内），筛选联动（机器→智能体级联、
全文：.sillyspec/changes/archive/2026-09-27-session-portal-ia-restructure/requirements.md#FR-05
最近确认：e4e593b4cc5ba221ebd773df5105beb4adbd4d83

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-session-portal-ia-restructure:flow:FR-05
  tests: frontend/src/components/sessions/__tests__/session-list-panel.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-session-portal-ia-restructure
  status: active

## FR-app-pages-015 行为零改动红线
变更：2026-09-27-session-portal-ia-restructure
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本变更 diff；When 逐行审查；Then 状态机/数据流/轮询/SSE/WS 消息处理/hooks/回调签名零改动（仅 render 组织层与样式类）；深链 ?session=/?new=、四分支（群聊
全文：.sillyspec/changes/archive/2026-09-27-session-portal-ia-restructure/requirements.md#FR-06
最近确认：e4e593b4cc5ba221ebd773df5105beb4adbd4d83

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-session-portal-ia-restructure:flow:FR-06
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.ts | frontend/src/components/sessions/__tests__/sessions-portal.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-session-portal-ia-restructure
  status: active

## FR-app-pages-016 样式合规
变更：2026-09-27-session-portal-ia-restructure
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 三主题（blue/ai-native/dark）任意切换；When 渲染会话门户；Then 新增/改动代码零硬编码色值（全走 themes.ts token/CSS var/brand-* 语义阶），正文可读性下限 12px（mono 元数据 11px
全文：.sillyspec/changes/archive/2026-09-27-session-portal-ia-restructure/requirements.md#FR-07
最近确认：e4e593b4cc5ba221ebd773df5105beb4adbd4d83

## FR-app-pages-017 质量门
变更：2026-09-27-session-portal-ia-restructure
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 实现完成；When 跑相关测试与静态检查；Then 涉及文件既有测试（改断言不改意图）全绿；tsc 零新增错误；eslint 零新增
全文：.sillyspec/changes/archive/2026-09-27-session-portal-ia-restructure/requirements.md#FR-08
最近确认：e4e593b4cc5ba221ebd773df5105beb4adbd4d83
