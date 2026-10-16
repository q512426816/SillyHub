---
author: flow-machine-draft
created_at: 2026-10-16T13:19:13.371Z
---
# 设计记录（Design Record）— 2026-10-16-change-title-condense-backfill

## 做法概述

变更中心两类烂标题（完整变更=变更名兜底、轻量变更=50 字截断长句）的病根在 CLI 侧（另变更处理），但存量已入库的坏 title 只能平台侧修：平台 `changes.description` 列已存有动机段提取文本（2026-09-28-change-list-description），是现成的语义来源。本变更三件事：

1. `title_norm.py` 新增 `condense_title` 纯函数——自然标点截断（强边界 优先，弱边界兜底，区间 `[8,30]`，无边界硬截加 `…`），与将来 CLI 侧同规则实现行为对齐（两边各留一份、用同一组实证样本锚定，防漂移靠测试样本一致）。
2. 收养口防御：`_ensure_change_row` 采纳 CLI 上行标题前，超 30 字先提炼再入库——防旧版 CLI 继续推长标题进来（存量修完再进新的就没意义了）。
3. 存量回填：新服务 `title_backfill.py` + 薄脚本 `scripts/backfill_change_titles.py`（dry-run 缺省 / `--apply` 落库 / `--yes` 门，照抄 `backfill_run_change_context.py` 先例骨架）。选中规则 = `location IN ('active','archive')` 且（title 兜底形态 或 title >30 字）且 description 非空；新 title = `condense_title(description)`。

回填只救「有 description 的行」；无 description 的老行跳过计数（不猜、不去盘上读 proposal——保持脚本纯 DB 面，读盘归 reparse 职责）。

## 接口契约

- 新增 `app.modules.change.title_norm.condense_title(text: str | None, *, min_len: int = 10, floor_len: int = 8, max_len: int = 30) -> str`——纯函数，模块级常量 `TITLE_CONDENSE_MIN_LEN=10`（10-30 必须带，用户口径 2026-10-16）/ `TITLE_CONDENSE_FLOOR_LEN=8`（兜底带下限）/ `TITLE_CONDENSE_MAX_LEN=30` 供调用方共享口径；硬截产物总长恰 `max_len`。
- 修改 `PlatformSyncService._ensure_change_row` 既有行收养分支 + 占位建行分支：title 超过 `TITLE_CONDENSE_MAX_LEN` 时先 `condense_title`，提炼为空则放弃收养/回落 change_key；≤30 字行为不变。
- 新增 `app.modules.change.title_backfill.TitleBackfillService`：`async backfill_workspace(ws_id, *, apply: bool) -> TitleBackfillStats`（含命中明细列表供脚本打印）；`TitleBackfillStats` dataclass 计数字段（scanned/selected/updated/skipped_no_description/skipped_empty_or_same）。
- 新增 `backend/scripts/backfill_change_titles.py`（一次性运维脚本，非包成员，sys.path 引导同先例）：CLI 参数 `--apply` / `--workspace UUID`（可多次）/ `--yes`。
- 新增 `PATCH /workspaces/{workspace_id}/changes/{change_id}/title`（rename，task-06）：请求 `ChangeRenameRequest{title}`、响应 `ChangeRenameResponse{id, change_key, title}`；组合权限在端点内做（delete_change 同款：owner OR `has_permission(CHANGE_ARCHIVE)`，require_permission 依赖工厂不支持行级 OR）；服务层 `ChangeService.rename_title` 校验 10-30（422 越带）、404/409 语义对齐 delete、`change_events` 落 event_type='rename' 事件。`change:update` 权限是 2026-10-08-rbac-dead-permissions-cleanup 清理的死权限，不复活——改名走与删除同款三元组组合（用户口径同组）。
- 前端（task-07）：详情页 PageHead actions 区新增「改名」动作（`DetailRenameAction`，照 DetailDeleteAction 受控弹层范式），权限可见性复用 `useChangeDeleteAccess`+`canDeleteChange` 三元组启发式；api-types 走 `pnpm gen:types` + `pnpm -C sillyhub-daemon gen:types` 生成（规则 21）。
- 无新表、无迁移；前端/daemon 类型文件与 openapi.json 随本变更再生成提交。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：回填后若 CLI 侧后续又推来兜底形态 title（老版本 CLI），收养守卫会再次采纳兜底值——但 CLI 侧同规则修复上线后新推送即语义标题；过渡期最坏情形=个别行回退为 key 名，重跑本脚本幂等修复；人工改名后的语义 title 不被兜底回翻（is_fallback 守卫），仅自定义 H1 文档推送可覆盖（CLI --title 改名通道语义保留）。迟到 documents 推送不会回翻语义 title（既有守卫，已测）。
2. 并发写：回填单事务逐行 UPDATE title，与 reparse/platform_sync 并发时以最后写者为准；title 是展示元信息非权威数据，最后写者胜无一致性风险；改名端点单行 UPDATE + 事件同事务提交，与回填并发同理取最后写者。脚本建议低峰跑（先例同款建议）。
3. 切换/生命周期：dry-run 用单事务回滚（先例 `_DryRunRollback` 模式）保证零触碰；apply 单事务原子提交，中断即整体回滚，重跑幂等（回填后产物全量带宽内不再命中选中条件，本地实测重跑回填恒 0）；改名失败路径（403/404/409/422）零写库。
4. 作用域：回填服务按 workspace_id 过滤（脚本缺省遍历全部工作区、`--workspace` 可定向），行级更新只触 `changes.title`，无跨工作区串台面；`location='deleted'` 行明确排除（防复活守卫语义不被搅动）；改名端点 workspace+change 联合定位（get 404 口径）无越权串台。

## 风险与死路

最大风险：提炼结果语义跑偏（标点切断点选错把句子切成病句）。缓解：强边界（句读完整处）优先、必须带 [10,30] 内取首个边界、本仓实证坏样本全部进单测人工核过产出；且 title 只是展示面，错了可由人工改名端点（FR-05/06）随时纠正——这也是补改名能力的动机：提炼是兜底自动化，最终命名权在人。

试过放弃的方案：(a) 在前端展示层动态截 title——治标不治数据，详情页/搜索/通知等其余消费面仍旧烂，弃；(b) 回填脚本去工作区盘上重读 proposal.md 取动机——读盘逻辑与 reparse 职责重叠且工作区可能已迁移/不可达，description 列已是同源提取结果，弃；(c) 放宽收养守卫让 CLI 短标题覆盖平台已有语义标题——动 2026-09-30-title-adopt-clobber-guard 的防回翻语义，影响面大，存量修复不需要它，弃；(d) 复活 change:update 权限做改名——该权限 2026-10-08 刚因零消费被清理，改名复用删除端点已验证的 owner OR CHANGE_ARCHIVE 三元组（与用户点名组完全一致），弃。
