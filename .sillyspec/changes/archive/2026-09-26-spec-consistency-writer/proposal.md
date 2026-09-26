---
author: flow-machine-draft
created_at: 2026-09-26T00:02:17.792Z
---
# 提案书（Proposal）— 2026-09-26-spec-consistency-writer

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:272bba6c8d1a411693ae1bb379d51d926586db6b4b37a850e4c06fef93dc5ad3:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-consistency-writer 留痕重锚 -->
任务原话转写：动机：spec 镜像/清单/本地树三份快照无一致性校验（2026-09-25 生产实证：c84182bc 镜像缺 13 个知识文件、b97 缺整个 generated/ 41 个，靠手写对账脚本才发现）；同步端点身份不透明（daemon 与 CLI platform sync 双写者互不知情，manifest 基线漂移是 SpecPushConflict 一周僵局根因）。

成功标准：
- 新端点 GET /workspaces/{id}/spec-workspace/consistency：对账镜像磁盘树（spec_root rglob）与 SpecFileManifest 行，输出四类分歧——disk_only（磁盘有清单无）、manifest_ghost（行 exists=True 但磁盘缺）、tombstoned_on_disk（行 platform_deleted=True 且磁盘文件在——残留）、counts 汇总；返回结构化 DTO
- spec-workspace 读模型（GET /spec-workspace）增 last_writer 字段：每次 apply_sync/apply_ops 记录写入方身份（daemon X-API-Key 的 runtime_id / CLI Bearer 的 principal 摘要），前端 spec 面板可显示「最后写入方 + 时间」；写方切换（不同 principal 连续写入）记 structlog warning（双写者漂移信号）
- 单测：四类分歧各一用例（构造镜像/清单错位）+ last_writer 记录与切换告警
- gen:types 契约同步；既有 spec_workspace 测试零回归
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:7d32ec547982828b5047851dd1f41a0839ecd7af2e991f93463004a8b8c57214:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-consistency-writer 留痕重锚 -->
按成功标准机械推导，共 8 条验收面：
1. 新端点 GET /workspaces/{id}/spec-workspace/consistency：对账镜像磁盘树（spec_root rglob）与 SpecFileManifest 行，输出四类分歧——disk_only（磁盘有清单无）、manifest_ghost（行 exists=True 但磁盘缺）、tombstoned_on_disk（行 platform_deleted=True 且磁盘文件在——残留）、counts 汇总
2. 返回结构化 DTO
3. spec-workspace 读模型（GET /spec-workspace）增 last_writer 字段：每次 apply_sync/apply_ops 记录写入方身份（daemon X-API-Key 的 runtime_id / CLI Bearer 的 principal 摘要），前端 spec 面板可显示「最后写入方 + 时间」
4. 写方切换（不同 principal 连续写入）记 structlog warning（双写者漂移信号）
5. 单测：四类分歧各一用例（构造镜像
6. 清单错位）+ last_writer 记录与切换告警
7. gen:types 契约同步
8. 既有 spec_workspace 测试零回归
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:5e8172c9bfe45237d5d290d8806aa00db6911e6c7f25dc60472aaf3e78a5122d:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-spec-consistency-writer 留痕重锚 -->
1. 新端点 GET /workspaces/{id}/spec-workspace/consistency：对账镜像磁盘树（spec_root rglob）与 SpecFileManifest 行，输出四类分歧——disk_only（磁盘有清单无）、manifest_ghost（行 exists=True 但磁盘缺）、tombstoned_on_disk（行 platform_deleted=True 且磁盘文件在——残留）、counts 汇总
2. 返回结构化 DTO
3. spec-workspace 读模型（GET /spec-workspace）增 last_writer 字段：每次 apply_sync/apply_ops 记录写入方身份（daemon X-API-Key 的 runtime_id / CLI Bearer 的 principal 摘要），前端 spec 面板可显示「最后写入方 + 时间」
4. 写方切换（不同 principal 连续写入）记 structlog warning（双写者漂移信号）
5. 单测：四类分歧各一用例（构造镜像
6. 清单错位）+ last_writer 记录与切换告警
7. gen:types 契约同步
8. 既有 spec_workspace 测试零回归
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
