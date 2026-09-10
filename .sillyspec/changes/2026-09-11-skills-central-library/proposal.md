---
author: qinyi
created_at: 2026-09-11 02:20:00
---
# 提案书（Proposal）

## 动机
平台技能链缺 git 技能源与按用户启用绑定（proposal §5 P1）：技能只能 sillyspec-* 代码内置或 CustomSkill 手写；想引入社区技能仓库（如 anthropics/skills）无通道；全员 bundle 无法按人裁剪。
## 关键问题
1. 无 git 源：外部技能仓库内容无法进平台分发链
2. 无启用粒度：bundle 对每人是"平台全量+自己的"，不能选配
3. 版本机制已有（content-hash 与 ai-toolbox 等价）但只覆盖 DB/文件两源
## 变更范围
- skill_source 新模块：SkillSource 表（admin CRUD）+ subprocess git 浅克隆拉取器（SSRF+上限三防线）+ 技能发现
- user_skill_enables 绑定表 + library 聚合端点 + 启用开关端点
- bundle 组装第三源（收集扩展+D-010 同名优先级去重+manifest source 标记）
- 前端技能页两新区块（源管理 admin/技能库启用）
## 不在范围内
- 收编 onboarding（Grill 实证扫描根 backend 不可达——散技能在 daemon 宿主侧 worktree；D-011 撤销，后续需 daemon RPC 通道的独立变更）
- 用户私有 git 源/定时 cron 拉取/symlink 分发/技能市场 UI/跨用户分享
- daemon 侧任何改动（manifest 向后兼容，git 技能自动随现有链路分发）
## 成功标准
- git 源技能经真实 git clone 进缓存根→发现→用户启用→进其 bundle（manifest version 变化）
- 三零回归：无源无绑定 version hash 与现状一致；sillyspec-*/CustomSkill 用例原样通过；未启用 git 技能零入任何 bundle
- 同名优先级矩阵（三源两两撞名）+ SSRF/上限/admin 门各有测试
