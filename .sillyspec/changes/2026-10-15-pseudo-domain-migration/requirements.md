---
author: flow-machine-draft
created_at: 2026-10-15T08:07:59.958Z
---
# 需求规格（Requirements）— 2026-10-15-pseudo-domain-migration

## 功能需求

### FR-01: 92 条全部迁出伪域（tests --redomain --write 逐批，ID 不变），digest 伪域信号归零

- 7 个 auto-* 伪域（auto-claude 22 / auto-deploy 2 / auto-frontend 47 / auto-github 3 / auto-releases 6 / auto-sillyspec 4 / auto-zcode 8）共 92 条 FR 必须全部迁入真域（frontend_components 74 / deploy 5 / ci 3 / sillyspec 4 / deploy_records 4 等，按来源变更交付文件判定主域），FR ID 逐字不变；fr/unmapped.md 池 8 条（横断变更 2026-10-10-live-token-speed-daemon-timing，逐条按主题迁 interactive 3/types 1/daemon 2/components-daemon 1/frontend_components 1）；迁移后 knowledge digest 伪域计数必须为 0。

#### 场景：主路径

- Given 22+2 批 redomain --write 执行完成，When knowledge digest，Then 伪域条目 0（实测回执留档）。

### FR-02: 7 个 auto-*.md 删空壳，INDEX 路由无 auto-* 残留

- 全量迁移后 fr/ 目录必须无 auto-*.md（redomain 删空壳语义）；INDEX.md 必须无 auto-* 域路由行残留。

#### 场景：主路径

- When 列举 fr/ 与 grep INDEX，Then 零残留（实测回执）。

### FR-03: knowledge validate 全绿（锚点/注册/幽灵零新增）

- 迁移后 knowledge validate 必须 ok:true；决策面迁移（436 条，另见下）后同款复核。

#### 场景：主路径

- When validate --json，Then ok:true（实测回执）。

### FR-04: 决策面 442 段清偿（工具 2026-10-15-decision-redomain）：436 条迁出+数据修复+unmapped 空壳删除

- decisions/unmapped.md 442 段必须全量清偿：数据修复（1 粘连段补标题分拆、3 完全重复段去重、4 行无主残迹剥离——归档真相源核验）+ 270 批 by-change + 3 批 anchor 迁出 436 条（含 6 条无变更条目主题人工判域 daemon）；源空壳删除、INDEX 失效行清零。

#### 场景：主路径

- Given 迁移执行完成，When ls decisions/ 与 grep INDEX，Then 无 unmapped、无失效路由（实测回执）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯知识数据迁移（.sillyspec/knowledge/**），无代码测试面——验收靠 redomain 回执逐批留档 + digest 伪域 0 实测
FR-02: 不适用：同上——验收靠 fr/ 目录列举与 INDEX grep 文件系统事实
FR-03: 不适用：validate 为纯读 CLI 检查，回执留 verify-result
FR-04: 不适用：同上（决策面工具测试在 sillyspec 仓 test/decision-redomain.test.mjs 3 组——本仓为消费侧数据执行）
