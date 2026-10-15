---
author: qinyi
created_at: 2026-10-14 09:08:54
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
平台目前由宿主 agent 经 `sillyhub-docker-deploy` skill 用 docker compose 部署。每次部署改了什么、部署是否成功，只散落在会话记录与 git log 里——没有一个地方能按时间线回看「每次部署的变化信息」。用户要求：每次 agent 部署时，agent 规整本次部署的变化信息（md 形式），SillyHub 主平台出独立菜单统一查看（用户原话见 decisions.md D-004）。

## 关键问题
1. **部署不可见**：部署动作发生在宿主 agent CLI 侧，平台内零感知——事后想知道「上次部署到哪个 commit、改了什么」只能翻会话或手敲 git log。
2. **变化信息没人规整**：git log 是机器视角的提交流水，不是人能直接读的「本次发布改了什么」总结；这个语义化总结只有执行部署的 agent 有上下文能写。
3. **现有 release 模块不承载此事**：`backend/app/modules/release/` 是人工发布审批流（发布单→审批→deploy→rollback），概念与「agent 部署后自动留痕」不同（D-001 裁决不合并）。

## 变更范围
1. **agent 侧**：`sillyhub-docker-deploy` skill 增「发布记录」硬步骤——部署验证后查平台最近记录取 commit 起点 → git log → 规整成中文变化总结 → 写 `docs/releases/YYYY-MM-DD-<序号>-<shortsha>.md`（frontmatter 元数据 + 正文总结）；失败部署也写（status: failed）。
2. **后端**：新模块 `deploy_records`（只读）：`GET /api/deploy-records` 列表 + `GET /api/deploy-records/{record_id}` 详情——扫各 workspace root_path 下 `docs/releases/*.md`（容器内经既有 host→container 路径改写），解析 frontmatter；零数据表、零写端点。新增 `deploy_record:read` 权限 + 存量角色种子迁移。
3. **前端**：顶层路由 `/deploy-records`「发布记录」菜单（协作治理组）——左记录列表 + 右 md 详情渲染；`pnpm gen:types` 再生成。

## 不在范围内（显式清单）
- 不做回滚按钮、部署日志摘要、健康检查展示（D-003 基础版裁剪）
- 不做写 API / 数据库表（D-004：记录即仓库文件）
- 不做平台与项目分离部署（多机读不到宿主文件）的支持（D-004 退役判据）
- 不动现有 release 审批流模块（D-001）
- 不自动 git commit 推送（md 文件随部署工作成果一起提交，由 agent 惯例处理）

## 成功标准（可验证）
- skill 指引下完成一次部署后，仓库 `docs/releases/` 出现合规新 md（frontmatter 字段齐全、正文为语义化总结）
- 平台前端「发布记录」菜单可见，列表展示该记录（序号/状态/时间/工作区/摘要），点开渲染 md 正文
- frontmatter 解析失败的文件不炸列表（容错标记）
- 后端新增模块测试 + 前端页面测试通过；`pnpm gen:types` 无漂移
