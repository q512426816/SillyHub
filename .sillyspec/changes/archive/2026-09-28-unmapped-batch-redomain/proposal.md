---
author: flow-machine-draft
created_at: 2026-09-28T13:38:16.466Z
---
# 提案书（Proposal）— 2026-09-28-unmapped-batch-redomain

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:06f9a40a360bcd657f7653169e9cd987d14d36b4f5dc05ce81a4439b7a76e98c:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-unmapped-batch-redomain 留痕重锚 -->
任务原话转写：知识库 unmapped 池 699 条 FR 索引分批归位（用户裁决：彻底清理，不放音）：
- 699 条来自 101 个历史变更（2026-05~08，域路由建立前归档），整池混主题无法用 redomain 整域迁移（工具缺口已留档 docs/sillyspec/fr-domain-suggest-typo-and-no-split-migration.md）
- 方法：按条目自带「变更：<name>」分组 → 读归档 change.patch 的交付路径判定目标域（backend/frontend/daemon/sillyspec 四粗域，与页面一键归位口径一致）→ 脚本搬迁（保 ID 不变，同 redomain 语义）→ 计数守恒验证（699=Σ各域新增）→ INDEX 更新 + unmapped.md 清空删除
- 映射表先出后审：patch 缺失/多域混合的变更用条目文本关键词兜底判定，映射表人工复核后才落盘

成功标准：
- 699 条全部迁入真域，计数守恒（迁移前后条目总数一致，无丢失无重复）
- fr/unmapped.md 清空删除，INDEX 路由行同步；sillyspec knowledge validate 通过
- digest 伪域归零（unmapped 池 0）
- 映射依据可追溯（每个变更→域的判定来源留档在变更目录）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:bf45f01818fb346a3902d6716d7c65172dbea023f8d92f2a1195288c9a10d305:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-unmapped-batch-redomain 留痕重锚 -->
按成功标准机械推导，共 7 条验收面：
1. 方法：按条目自带「变更：<name>」分组 → 读归档 change.patch 的交付路径判定目标域（backend/frontend/daemon/sillyspec 四粗域，与页面一键归位口径一致）→ 脚本搬迁（保 ID 不变，同 redomain 语义）→ 计数守恒验证（699=Σ各域新增）→ INDEX 更新 + unmapped.md 清空删除
2. 映射表先出后审：patch 缺失/多域混合的变更用条目文本关键词兜底判定，映射表人工复核后才落盘
3. 699 条全部迁入真域，计数守恒（迁移前后条目总数一致，无丢失无重复）
4. fr/unmapped.md 清空删除，INDEX 路由行同步
5. sillyspec knowledge validate 通过
6. digest 伪域归零（unmapped 池 0）
7. 映射依据可追溯（每个变更→域的判定来源留档在变更目录）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:e9412583a3ed881d2eb053ea01d28aa60c38b00ed887c81426d26c681a1d4feb:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-unmapped-batch-redomain 留痕重锚 -->
1. 方法：按条目自带「变更：<name>」分组 → 读归档 change.patch 的交付路径判定目标域（backend/frontend/daemon/sillyspec 四粗域，与页面一键归位口径一致）→ 脚本搬迁（保 ID 不变，同 redomain 语义）→ 计数守恒验证（699=Σ各域新增）→ INDEX 更新 + unmapped.md 清空删除
2. 映射表先出后审：patch 缺失/多域混合的变更用条目文本关键词兜底判定，映射表人工复核后才落盘
3. 699 条全部迁入真域，计数守恒（迁移前后条目总数一致，无丢失无重复）
4. fr/unmapped.md 清空删除，INDEX 路由行同步
5. sillyspec knowledge validate 通过
6. digest 伪域归零（unmapped 池 0）
7. 映射依据可追溯（每个变更→域的判定来源留档在变更目录）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
