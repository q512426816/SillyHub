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
