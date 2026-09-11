---
author: qinyi
created_at: 2026-09-11 02:20:00
---
# 需求规格（Requirements）

## 角色
admin（配源）/ 普通用户（启用）/ daemon（既有 manifest 消费，零改动）

## 功能需求
### FR-01: git 技能源管理（admin）
覆盖：D-002, D-006, D-007
Given admin 配置源（url+branch+subdir）
When 保存/刷新
Then SSRF 断言通过→subprocess git 浅克隆进缓存根→发现含 SKILL.md 目录（≤200 文件/≤10MB）→last_commit/last_error 记录；保存即拉取失败不阻塞保存；git 缺失 422 明确

### FR-02: 用户启用绑定与 bundle 第三源
覆盖：D-003, D-005, D-010
Given git 技能已发现（library 列出）
When 用户启用（user_skill_enables）
Then 其 bundle 收集该技能目录文件集（rel_path=目录名原样；同名优先级 sillyspec-*>CustomSkill>git 源，后到跳过+warn）；manifest items 带 source 标记；version hash 自然变化
When 未启用/源禁用/目录消失
Then 零收集（悬空绑定保留无害）

### FR-03: library 聚合视图
Given 用户请求 GET /api/skills/library
Then 三源聚合列表（平台内置/我的 CustomSkill/已发现 git 技能）+ 我的启用态

### FR-04: 前端技能页
两新区块：源管理（admin：源卡 CRUD+刷新+错误显示）/ 技能库（git 技能列表+启用开关）；我的技能现状不动

## 非功能需求
- 兼容三零回归（测试锁定）；daemon manifest 向后兼容（实证只读 version/sha256）
- 安全：admin 门+SSRF+大小数量上限+子进程超时（GIT_TERMINAL_PROMPT=0）
- 门禁：ruff/mypy/gen:types 联动零漂移
