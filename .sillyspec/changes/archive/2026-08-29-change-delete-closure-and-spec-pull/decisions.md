---
author: qinyi
created_at: 2026-08-29 11:20:00
---

# 决策记录 — 2026-08-29-change-delete-closure-and-spec-pull

## D-001@v1 : 删除权限口径 = 变更 owner + 工作区所有者 + 平台管理员
状态：decided
source: user
question: 多用户共用工作区，变更中心删除入口谁能用？
answer: 用户拍板「变更 owner 本人也可删」——owner_id 取当前值并接受漂移语义（owner=最新推送人）；owner_id 为空（从未上行过进度）时仅工作区所有者/平台管理员可删。实现上端点挂 `Permission.CHANGE_ARCHIVE`（workspace_owner 角色已内置、platform_admin 短路），另加 `change.owner_id == current_user` 的 OR 分支。
evidence: brainstorm step3 需求澄清第 1 轮用户作答。

## D-002@v1 : 删除形态 = 软删隐藏（location='deleted'），不做恢复 UI
状态：decided
source: user
question: 平台删除变更后数据怎么处理？
answer: 用户采纳推荐：`location='deleted'` 第三区，现有 active/archive 两 tab 显式传参天然不显示；镜像文件移 30 天备份区；写 `change_events` delete 审计事件（行保留故 FK 不级联丢审计）；不做恢复界面。
evidence: brainstorm step3 需求澄清第 1 轮用户作答。

## D-003@v1 : 打包 = 单变更三波交付（删除收敛+防复活基建 / 删除入口 / 拉取口子）
状态：decided
source: user
question: 三条线怎么打包？
answer: 用户采纳推荐：一个变更三波。波与波共享防复活基建（波 1 建）。
evidence: brainstorm step3 需求澄清第 1 轮用户作答。

## D-004@v1 : CLI 边界 = 同时改 sillyspec 工具（跨仓配套）
状态：decided
source: user
question: sillyspec 工具本体的配套改动（CLI 删除上报墓碑、pull 命令）做不做？
answer: 用户选择「同时改 sillyspec 工具」。平台侧先行并提供端点；CLI 侧（删除/归档时上行 status='deleted' 墓碑、`sillyspec pull` 命令）作为跨仓任务列入 tasks，在 sillyspec 仓执行。
evidence: brainstorm step3 需求澄清第 1 轮用户作答。

## D-005@v1 : 删除自动收敛架构 = 方案 A 镜像驱动收敛（+CLI 墓碑上报增强）
状态：decided
source: architect（用户跳过逐项勾选，按其 D-004/多用户表态推导；分段展示步骤可推翻）
question: 删除自动收敛的驱动机制：A 镜像驱动 / B 墓碑上行驱动 / C 全量对账常态化？
answer: 选 A。平台以镜像文件树为唯一权威：修 apply_ops 幽灵空目录 → scoped reparse 定向删除（R-08 收窄修订：仅 scope∩磁盘确认消失可删）→ 全量删除环顺手清 progress 行 → 防复活标记（manifest 墓碑升级）四处拦截（apply_ops add/rename 复活分支、_write_spec_root 全量对齐、_ensure_change_row 占位重建、progress 上行）。CLI 墓碑上报叠加为增强（收敛更及时 + 挡 CLI 本地库仍注册的进度复活），平台闭环不依赖它。
理由：B 旧版 CLI 不发墓碑照旧残留、与多用户混用场景冲突，且平台删除入口仍需 A 的防复活基建；C 撞已知坑（Windows bind mount stat 性能断崖 + 全量 reparse 93s 超时史）。A 误删面最小（scope 收窄 + 7 天占位保护 + 30 天备份区）。
evidence: brainstorm step4 方案对比（三方案表）；用户 AskUserQuestion 跳过，未勾选。

## D-006@v1 : Design Grill 加固 — 删除环豁免 deleted 行 + 持久锚点兜底 + 落盘级拦截
状态：accepted
type: consistency
priority: P1
source: design-grill
question: 独立审查发现 B-1（删除环会物理删 location='deleted' 墓碑行→审计 CASCADE 丢失+_ensure_change_row 锚点失效→幽灵复活）与 B-2（全量 tar 回退仅挡 manifest 对齐环，文件落回磁盘后 _apply_parsed 翻回 active）如何处置？
answer: 三点加固：① scoped 与全量两处删除环 + `_apply_parsed` 更新路径均豁免 `location='deleted'` 行（不删不回翻）；② `_ensure_change_row` 拒收判据双层——Change 行 location='deleted' 为主，行缺失时兜底探测 manifest platform_deleted 前缀（LIKE 转义）；③ `_write_spec_root` 落盘集计算阶段排除 platform_deleted 路径（文件不落盘）。附带修正：delete op 对 platform_deleted 幂等放行（仅拦 add/rename）；CLI 墓碑处理移到 progress POST 写路径；spec-bundle 鉴权口径为 _write_auth（仅 shpsync_）；progress 拒收 409 用 code=change_deleted 结构化区分。
evidence: brainstorm step7 独立审查子代理 review.json（brainstorm-review-2026-08-29-112321），fail→修复后复审。

## D-007@v1 : 进行中可见性并入本变更为波 4（三层方案，心跳不做）
状态：decided
source: user
question: 纯 CLI 模式下平台感知不到「正在跑」（所有信号都是每步 --done 时点快照），这块能力并入当前变更还是另开变更？
answer: 用户拍板「并入，继续」。以 revision 1 重开 brainstorm 并入为波 4：Layer 1 平台侧投影 `last_pushed_at` + 前端活动徽标三态（进行中/停滞/空闲，零工具改动零 migration）；Layer 2 CLI 步骤开始上报（X3）+ execute 任务边界上报（X4）（跨仓，后端零改动，渐进增强无硬依赖）；Layer 3 心跳本期不实现（协议预留，见 design §8.3）。
依据：只读调查结论——last_pushed_at 字段已存在未投影、30s 轮询已就绪、current_step_status 投影已存在，Layer 1/2 改动极小；与波 1-3 同文件（platform_sync/change/changes 页面），并入避免并行变更冲突（规则 19）。
evidence: brainstorm revision 1（step 3-8 重做），用户对话原话「并入 继续吧」。

## D-008@v1 : X1 墓碑触发面收窄——裸删不发墓碑，仅归档/unregister 触发（design §5.5 修订）
状态：accepted
type: risk
priority: P1
source: audit-fix（2026-08-29 审计修复轮，B1）
question: CLI「实体目录双失」判定无法区分「本地裸删」与「platform pull 只写 DB 不建目录的无目录态」——后者误发墓碑会把活跃变更在平台软删（全体成员生效）。如何收口？
answer: 收窄 tombstoneDue 为仅 `DB status='archived'`（unregister/归档链）触发；删除 entityDirGone 判据。裸删收敛不损失：镜像链（spec-sync delete ops → scoped 定向删除 FR-01）本就是权威闭环，墓碑只是加速器；该加速器在无目录态下风险大于收益。跨仓实现 cefd811。
supersedes: 无（修订 D-005@v1 中 X1 的触发面描述，不推翻方案 A）
evidence: 审计报告 P1-2（三审计代理之一发现+主代理复核）；修复后 X1 测试改为「目录双失不发墓碑」断言。

