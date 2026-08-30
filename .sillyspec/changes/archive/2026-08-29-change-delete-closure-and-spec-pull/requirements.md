---
author: qinyi
created_at: 2026-08-29 11:46:17
change: 2026-08-29-change-delete-closure-and-spec-pull
scale: large
---

# 需求 — 变更中心删除闭环与文档拉取口子

## FR-01 裸删自动收敛
本地删除整个活跃变更目录并经 spec-sync 推送后，变更中心**无需手动重扫描**即自动移除该变更（DB 行 + progress 行），收敛延迟以一次增量同步 + 自动 scoped reparse 为界。

验收：集成测试「裸删 → spec-sync → 断言列表不含该变更且无手动 reparse」通过。

## FR-02 幽灵空目录修复
apply_ops 处理 delete ops 后，被删空的变更目录从镜像磁盘消失（自底向上 rmdir，仅 ops 涉及目录，不做整树扫描）。

验收：删除目录全部文件后 `spec_root/changes/<name>/` 不存在；parser 不再产出该 key。

## FR-03 progress 与 quicklog 残留收敛
- FR-03a：删除环删 Change 行时连带删 `platform_change_progress` 对应行。
- FR-03b：镜像 `quicklog/QUICKLOG-*.md` 中已不存在的 ql_id，其 pushed 行在列表合并时不再显示（`hidden=True` 软隐藏，保留行可回滚）。

验收：裸删后 progress 表无残留行；本地删 quicklog 条目并同步后，变更中心快速修复 tab 不再显示该条目。

## FR-04 多用户防复活
平台删除（或收敛删除）后的变更，在以下四通道均不复活：
1. CLI 直跑对已删路径发 add → 拒绝（conflict 项 `platform_deleted`）；
2. daemon rename 命中墓碑 → 拒绝；
3. daemon 增量失败回退整树 tar / 手动全量同步 → 落盘集前缀排除，文件不落盘；
4. progress 上行已删 key → 拒收（409 + `code='change_deleted'`；`_ensure_change_row` 双层判据，行缺失时 manifest 兜底锚点）。

附带不变量：`location='deleted'` 行在 scoped/全量 reparse 与 `_apply_parsed` 更新路径下均不物理删、不回翻 location（审计永不 CASCADE 丢失）。

验收：四通道各一条拦截测试 + deleted 行豁免测试全部通过。

## FR-05 平台删除入口
- FR-05a：`DELETE /api/workspaces/{ws}/changes/{cid}`，权限 = `CHANGE_ARCHIVE` **或** `change.owner_id == 当前用户`；无权限 403。
- FR-05b：执行顺序 = 镜像目录软删（30 天备份区 + `platform_deleted` 标记）→ 删 progress 行 → `location='deleted'` → 写 `change_events` delete 事件（含操作者/文件数/备份路径）。
- FR-05c：已删变更在「进行中/已归档/快速修复」三个 tab 均不显示；不提供恢复 UI。
- FR-05d：前端列表操作列 + 详情页危险按钮（权限可见者渲染）+ 输入变更名末段的受控确认弹层（照原型）；移动端同步；`gen:types` 更新。

验收：权限矩阵测试（owner/非 owner 有 CHANGE_ARCHIVE/无权限）+ 前端交互测试通过。

## FR-06 网页下载 spec 包
workspace 配置卡提供「下载文档包」按钮，点击后下载服务器 spec 整树 tar（排除 `.runtime/`、`local.yaml`），文件名取 `Content-Disposition`；不新增 Next.js route handler。

验收：blob 下载集成（mock）测试；下载文件可解压且结构为 `.sillyspec` 内容根。

## FR-07 CLI 可拉取
`GET /api/changes/-/spec-bundle`：仅 shpsync_ token 可访问（对齐 spec-manifest 先例），本 workspace 可拉、跨 workspace 403、无 workspace 403；路由前置于 `/changes/{name}`。

验收：鉴权矩阵测试；CLI（跨仓）`sillyspec pull` 拉取解压为 `.sillyspec` 内容根。

## FR-08 快照元数据
bundle 响应头含 `X-Spec-Version`；tar 顶层含 `PLATFORM-BUNDLE.json`（spec_version/strategy/generated_at）；UI/CLI 文案明示快照语义（非实时，daemon 在任务/会话开始自动取新版）。

验收：响应头断言 + tar 内容断言；R-07 不推翻（配置卡不常态展示 spec_version）。

## FR-09 最后信号与进行中步骤投影（平台侧，零工具改动）
`ChangeSummary` DTO 增加 `last_pushed_at`（可空 ISO 字符串，来自 progress 行既有字段）；enrich 投影不新增查询。前端列表「待办状态」位置增加活动徽标三态：进行中（当前步 active 且最后信号 ≤30min）/ 停滞（当前步 in-progress 但最后信号 >30min，文案只陈述事实）/ 空闲（显示最后活动时间）；详情页头部同步「最后信号」；复用既有 30s 轮询；阈值常量 `ACTIVITY_STALE_MS` 前端定义。

验收：enrich 投影单测（有值/无 progress 行两态）；前端徽标测试（真值表 f(current_step_status, 最后信号年龄) 三态 + last_pushed_at 为空与畸形串回退——防御式解析复用 ISO_LIKE_RE 范式）。

## FR-10 CLI 在跑上报（跨仓，Layer 2）
- X3 步骤开始上报：CLI 步骤启动时推一次 progress（既有六表结构，该步 status=in-progress），平台投影自动变「进行中」——后端零改动。
- X4 任务边界上报：execute 每完成一个任务调一次 triggerSync，`last_pushed_at` 任务粒度刷新；tasks.md 勾选状态走既有文件同步 + task reparse。
- 旧版 CLI 无 X3/X4 时行为等同现状，FR-09 启发式仍工作（渐进增强，无硬依赖）。

验收：sillyspec 仓侧流程验收（步骤开始后平台列表徽标变「进行中」；任务完成后最后信号时间刷新）。

## FR-11 心跳（Layer 3）——本期不做
协议预留说明见 design.md §8.3（复用 progress 端点带 heartbeat 字段或专用轻量端点，将来再决策），本期不实现、不预加字段。列入 Non-Goals。

## 非功能约束

- NFR-01 Windows/Linux/macOS 兼容（路径处理、rmdir、tar）；Windows bind mount 下无整树 stat 扫描（R-03）。
- NFR-02 单 alembic revision（2 列：`spec_file_manifest.platform_deleted`、`quicklog_entries.hidden`），提交前单 head 检查。
- NFR-03 平台闭环不依赖 sillyspec 工具升级（旧 CLI 场景 FR-01~FR-05 仍成立）。
- NFR-04 只跑模块相关测试，全量留 CI（CLAUDE.md 规则 0）。
