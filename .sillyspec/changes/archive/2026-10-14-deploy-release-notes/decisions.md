---
author: qinyi
created_at: 2026-10-14 09:08:54
generated_by: sillyspec-fourpiece-init
change: 2026-10-14-deploy-release-notes
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 新建独立部署记录模块，不动现有发布审批流
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 新「版本发布记录」与现有 release 模块（发布审批流：发布单→审批→deploy→rollback）的关系
- answer: 用户裁决：新建独立模块。现有 release 审批流是人工单据流（bundle change_ids、approve、deploy、rollback），与「agent 部署后自动生成部署变化记录」是两个概念；并存不合并
- normalized_requirement: 新建独立后端模块（deploy_records 域），不修改 backend/app/modules/release/ 任何行为；两者表、端点、页面完全分离
- impacts: [FR-1, FR-2]
- evidence: backend/app/modules/release/model.py:14（Release 表）、backend/app/modules/release/router.py:61-179（审批/部署/回滚端点）；用户回答轮次 1
- 故障面: 侧边栏出现两个"发布"语义菜单（现有「发布」+ 新「部署记录」），需靠菜单命名区分（「发布记录」vs「发布」）
- 退役判据: 若现有 release 审批流确认废弃下线，可将两域合并

## D-002@v1: 顶层一级菜单，平台级聚合视图
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 「独立一个菜单」放侧边栏哪一层
- answer: 用户裁决：顶层一级菜单（像「智能体会话」/agent-profiles 那样 absolute href、不进工作区），统一看所有部署记录
- normalized_requirement: 前端新增 /deploy-records 顶层路由页 + menu-permissions.ts 新增 absolute 菜单项；数据模型为平台级表（记录可选关联 workspace_id 可空，无工作区上下文也能看）
- impacts: [FR-3, FR-4]
- evidence: frontend/src/lib/menu-permissions.ts:101-603（MENU_PERMISSION_GROUPS 单一数据源，sessions/agent-profiles 均为 absolute 顶层菜单先例）；用户回答轮次 1
- 故障面: 菜单注册表增删条目平移声明序索引，需同步重算 admin/menus 测试锚（共享断言面⑦，scripts/check-assertion-surfaces.py 门禁）
- 退役判据: 若未来要求按工作区隔离查看，再评估降级为工作区菜单

## D-003@v1: 基础版记录内容
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 每条发布记录包含哪些字段
- answer: 用户裁决：基础版——部署时间、序号/版本标识、commit 范围（上次部署→本次，含提交列表）、agent 规整的变化总结（md 渲染展示）、部署结果（成功/失败）。不含部署日志摘要/健康检查/回滚按钮
- normalized_requirement: deploy_record 行含：seq（自增序号）、deployed_at、commit_from/commit_to（SHA）、commits（JSON 列表：sha+message+author）、notes_md（Text）、status（success/failed）；前端列表 + md 详情两态，不做回滚操作
- impacts: [FR-2, FR-3]
- evidence: 用户回答轮次 1

## D-004@v1: 方案D——agent 写 md 文件 + 平台读文件渲染（用户改提，取代 API 上报）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: agent 部署完成后，怎么把部署记录送进平台
- answer: 用户裁决原话「skill步骤 加 agent 写 md 文件不行吗？平台直接读md，每次发布生成一个新 md」：skill 末尾 agent 在仓库 docs/releases/ 写一个新 md（frontmatter 放元数据 + 正文放变化总结）；平台后端只读扫描该目录，解析 frontmatter + 渲染正文，不建表、不做写端点
- normalized_requirement: ① skill 硬步骤：部署验证通过后写 docs/releases/YYYY-MM-DD-<shortsha>.md（YAML frontmatter：seq/deployed_at/commit_from/commit_to/commits/status/summary + 正文 agent 总结）；② 后端新模块 deploy_records 只读：GET 列表 + GET 详情（读 workspace root_path 下 docs/releases/*.md，容器内经 container_path_prefix 改写）；③ 前端顶层菜单页列表 + md 渲染；④ 无数据库迁移、无写 API
- impacts: [FR-1, FR-2, FR-3, FR-4]
- evidence: backend/app/core/config.py:480（container_path_prefix=/host-projects 容器读宿主文件机制现成）；deploy/docker-compose.yml（HOST_PROJECTS_DIR bind mount）；用户回答轮次 2
- 故障面: ① 依赖容器挂载能读到宿主仓库（平台与项目不在同一宿主机时读不到——当前本机部署场景成立）；② frontmatter 写坏（yaml 解析失败）需容错跳过或标记异常；③ 记录目录是约定，agent 忘写就缺记录（同方案A固有劣势）
- 退役判据: 若出现多机部署/平台与项目分离部署，读不到文件，届时升级为 API 上报 + 落库

## D-005@v1: 落选——方案A skill步骤+平台REST API上报（含凭据登录）
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: agent 部署完成后，怎么把部署记录送进平台
- answer: skill 末尾调 POST /api/deploy-records 上报，凭据用 deploy/.env bootstrap admin 登录换 JWT。当轮劣势：需设计写端点+鉴权链+数据库表，实现面大；用户主动改提「直接写 md 文件」更简单
- normalized_requirement: 不采用；不新增部署记录写 API 与数据库表
- impacts: []
- evidence: 用户回答轮次 2（主动改提方案D）
- 否决理由: 需设计写端点+鉴权链+数据库表，实现面大；用户主动改提「直接写 md 文件」（D-004）更简单且零迁移零写端点
- 复潮条件: 平台与项目分离部署（容器读不到宿主文件）时，API 上报成为必要，届时重启本方案

## D-006@v1: 落选——方案B 平台自动探测部署（commit_sha 对比）
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: agent 部署完成后，怎么把部署记录送进平台
- answer: backend 定期对比 /health commit_sha 自动建档。当轮劣势：无人写语义化 md（违背 D-003「agent 规整变化信息」核心需求）；Windows 本机部署按 skill 豁免不导出 COMMIT_SHA、commit_sha=unknown 探测锚失效；只能覆盖 SillyHub 自身、覆盖不了其他项目
- normalized_requirement: 不采用
- impacts: []
- evidence: .zcode/skills/sillyhub-docker-deploy/SKILL.md:198（Windows 本机不导出 COMMIT_SHA 的稳定性豁免）
- 否决理由: 无人写语义化 md（违背 D-003「agent 规整变化信息」核心需求）；Windows 本机部署按 skill 豁免不导出 COMMIT_SHA、探测锚恒 unknown 失效；只能覆盖 SillyHub 自身
- 复潮条件: 若未来要求零漏报兜底（agent 不读 skill 也要有记录），可作补充机制（只记 sha 变化，不写总结）

## D-007@v1: 落选——方案C 专用CLI工具封装上报
- type: architecture
- priority: P2
- status: rejected
- source: user
- question: agent 部署完成后，怎么把部署记录送进平台
- answer: 仓库提供 scripts 命令封装「查起点→取git log→上报」。当轮劣势：md 语义总结仍必须 agent 写，工具只能预填骨架，收益有限；且在方案D（写文件）下 curl/写文件都足够简单，无封装必要
- normalized_requirement: 不采用
- impacts: []
- evidence: 用户回答轮次 2
- 否决理由: md 语义总结仍必须 agent 写，工具只能预填骨架收益有限；写文件场景下 curl/写文件足够简单，无封装必要
- 复潮条件: 若写 md 的 frontmatter 格式频繁出错，可提供模板生成脚本降低出错率
