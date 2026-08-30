---
author: qinyi
created_at: 2026-08-29 11:46:17
change: 2026-08-29-change-delete-closure-and-spec-pull
scale: large
---

# 提案 — 变更中心删除闭环与文档拉取口子

## 问题

1. **变更中心无删除入口**：`modules/change` 无 DELETE 端点、前端无删除按钮，唯一删除路径是手动「重新扫描」全量对账。
2. **sillyspec 触发的删除不收敛**：裸删变更目录后 DB 行永久停在「进行中」（scoped reparse 零删除红线 R-08 + apply_ops 不清幽灵空目录双堵点）；`platform_change_progress` 与 quicklog pushed 行永久残留。
3. **多用户共用工作区**：数据按 workspace 共享、owner 漂移到最新推送人；存在四条复活通道（CLI add、daemon rename、daemon 全量回退、progress 占位重建），任何删除设计不拦复活即失效。
4. **拉取口子缺失**：服务端 spec 文档（变更/扫描/知识库）只有 daemon 能拉（bundle tar，任务/会话开始时机）；浏览器用户与 CLI 直跑均无下载/拉取入口。
5. **进行中感知盲区**（revision 1 并入）：CLI→平台全部信号是每步 `--done` 时点快照，步骤进行中（execute 数小时）零信号；纯 CLI 模式平台无法区分「长跑中/挂死/没在跑」，进度表既有的 `last_pushed_at` 从未投影到前端。

## 方案（详见 design.md，方案 A 镜像驱动收敛 + CLI 墓碑增强）

- **波 1 删除自动收敛 + 防复活基建**：修幽灵空目录 → scoped 定向删除（R-08 收窄）→ progress 联动清理 → `platform_deleted` 标记四通道拦截（含 Grill B-1/B-2 加固：删除环豁免 deleted 行、持久锚点兜底、落盘级前缀排除）→ quicklog 对账软隐藏。
- **波 2 平台删除入口**：`DELETE /changes/{cid}`（CHANGE_ARCHIVE 权限或 owner 本人）→ 镜像软删 30 天备份区 → `location='deleted'` 软删隐藏 → change_events 审计；前端列表/详情/移动端 + 受控确认弹层（原型已定稿）。
- **波 3 拉取口子**：`GET /changes/-/spec-bundle`（shpsync 可拉）+ `X-Spec-Version` 头 + tar 内 PLATFORM-BUNDLE.json；前端配置卡「下载文档包」按钮；CLI `sillyspec pull` 命令（跨仓）。时机口径：机器拉维持现状（lease claim 驱动），人拉为主动快照。
- **波 4 进行中可见性（revision 1 并入）**：Layer 1 平台侧投影 `last_pushed_at` + 前端活动徽标三态（进行中/停滞/空闲，零工具改动零 migration）；Layer 2 CLI 步骤开始 + 任务边界上报（跨仓，后端零改动）；心跳 Layer 3 不做（协议预留）。

## 预期收益

- 本地裸删/归档/quicklog 清理后变更中心自动收敛，无需手动重扫描。
- 平台删除一处入口、权限受控、留痕、多用户不复活。
- 用户可随时把服务端整套 spec 文档拉到本地（浏览器一键 / CLI 一条命令）。
- 纯 CLI 跑变更时，平台能看见「正在跑哪一步、最后信号多久前」（revision 1 波 4）。

## 不在范围内 / Non-Goals

- 回收站/恢复 UI；物理删除 Change 行；推翻 R-07（配置卡常态展示 spec_version）。
- daemon 侧任何改动（pull/push 时机维持现状）；会话中自动刷新。
- 多工作区批量删除；quicklog pushed 行硬删；60s 心跳实现（Layer 3 协议预留不实现）。
- 本仓内实现 sillyspec CLI 代码（跨仓任务仅在 tasks.md 标注交付物）。

## 风险（摘要，全表见 design.md §14）

R-01 scoped 误删（scope 收窄+双断言红测）/ R-02 复活漏网（通道清单化测试）/ R-03 Windows bind mount 性能（仅 ops 涉及目录）/ R-04 owner 漂移误删（接受语义+防呆+审计）/ R-05 alembic 多 head / R-06 路由前置 / R-07 CLI 滞后 / R-08~R-10 已加固项回归测试 / R-11 plan 细化 / R-12 停滞启发式误报（文案只陈述事实）/ R-13 推送频率（轻量+无差异短路）。

## 决策

D-001 删除权限（owner 也可删）· D-002 软删隐藏 · D-003 单变更三波 · D-004 同时改 CLI（跨仓）· D-005 方案 A · D-006 Grill 加固 · D-007 进行中可见性并入为波 4（三层方案，心跳不做）。详见 decisions.md。
