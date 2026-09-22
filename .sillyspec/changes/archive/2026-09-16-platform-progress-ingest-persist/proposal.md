---
author: qinyi
created_at: '2026-09-16 07:50:00'
scale: large
---

# 提案书（Proposal）— 2026-09-16-platform-progress-ingest-persist

## 动机

sillyspec CLI 链路 A（REST 进度同步）在生产工作区走完全流程后，平台 `changes` 表行的 `current_stage`/`status`/`title` 不随推进更新（2026-09-15 生产实证：ehs-back 工作区变更 2026-09-15-ehs-reward-punishment 走完 propose→verify，表行仍 `current_stage=NULL / status='draft' / title='提案书（Proposal）'`）。CLI 侧契约已核查合规（sillyspec 仓 platform-interface-map.md 链路 A 已知问题块登记），本变更只修平台侧。

生产证据分流结论：进度 POST 已到达且被接受（收件箱行 `latest_progress` 含 `current_stage=verify / status=active`、`last_pushed_at` 新鲜），分叉根因是 ingest 写路径只写收件箱表、从不更新 `changes` 表既有行——`_ensure_change_row` 行存在即返回，预期「接管」的 reparse 路径因 owner_id 守卫对 CLI 工作流失效。

## 关键问题

1. **ingest 不落库**：`upsert_progress` 接受分支无任何 `changes` 表字段更新；`current_stage` 仅占位行建行一刻取值，`status` 硬编码 `'draft'` 永不变化。
2. **接管路径失效**：`_apply_parsed`（reparse）仅 `owner_id is None` 行更新 `current_stage`，而进度推送链必设 owner；`dispatch` 读 sillyspec.db 仅 agent 派发触发——纯 CLI 工作流两条路都不通。
3. **title 无语义且不刷新**：title 只从 proposal.md 首 H1 派生，CLI 模板 H1 是固定文案（`提案书（Proposal）`），语义名只在 change_key。
4. **status 无枚举映射**：CLI 值族（active/in_progress/archived/deleted）与平台列值域无映射表，未知值无处安放。
5. **MASTER 占位行噪音**（化妆品级）：parser 对缺席 MASTER.md 发 `exists=False` 行，MASTER 是 brainstorm 拆分产物（本仓 291 变更仅 6 个存在），单变更交付恒缺失纯噪音。

## 变更范围

- **后端 backend**（3 文件改 + 2 测试新增）：
  - `app/modules/platform_sync/service.py` — P1 ingest 权威落库 + P2a title 重派生
  - `app/modules/change/title_norm.py` — 新增共享 title 归一化 helper
  - `app/modules/change/parser.py` — `_extract_title` 接归一化 + P3 MASTER 占位行清理
  - `app/modules/platform_sync/tests/test_stage_status_ingest.py` — 新增
  - `app/modules/change/tests/test_title_normalization.py` — 新增

## 预期收益

- 变更中心 DB 表值与 CLI 实际进度一致（契约 §14.5 权威值落表）；表级消费方（通知/统计/排障查询）读到真实阶段。
- title 显示语义名（如 `ehs-reward-punishment`）而非模板文案。
- status 落库区分「未开始 draft」与「推进中 in_progress」，archived 终态表级可查。
- MASTER 噪音行消失，存量行自然清理。

## 非目标（Non-Goals）

- 不改 sillyspec 仓（双边契约加 title 字段登记 issue 备忘）。
- 不修 daemon 响应耗时 / event_loop 阻塞治理（另一问题，仅登记观察）。
- 不改读侧 enrich 投影、不做 schema 迁移、不落库 stages/step_progress 表级镜像。

## 验收标准

1. 示例 payload 重放 POST（带三 header）→ `changes` 行 `current_stage`/`status` 更新；二次重放幂等；伪造 `X-SillySpec-Base-Ts` 冲突返回 409 且不写库。
2. 回归测试覆盖：ingest 落库 / 409 冲突 / 枚举未知值告警 / 旧版 CLI（无 header）兼容 / archived 终态 / reparse 不回翻 / documents 通道 title 重派生 + 防复活守卫 / MASTER 行不发。
3. 生产验证（47.113.145.252）：sillyspec 侧触发一次 triggerSync，ehs-back 工作区该变更行 `current_stage` 变为实际阶段。
