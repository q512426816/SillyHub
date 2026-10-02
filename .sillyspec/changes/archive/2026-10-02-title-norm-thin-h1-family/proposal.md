---
author: flow-machine-draft
created_at: 2026-10-02T01:19:25.815Z
---
# 提案书（Proposal）— 2026-10-02-title-norm-thin-h1-family

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:105e7a8d5f33cc15cfe96310072aadbac051f07b67c9204b0644e5d961cd000a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-02-title-norm-thin-h1-family 留痕重锚 -->
任务原话转写：变更中心把 thin 变更标题显示成「任务注册表（Tasks）— <变更名>」：flow-draft 新模板 H1 家族（任务注册表/设计记录/决策记录/验证回执，均带「— <变更名>」后缀）未收录进 title_norm._TEMPLATE_TYPE_WORDS，documents 推送按最深阶段文档（tasks.md）重派生 ux_changes.title 时模板 H1 被误判为自定义语义标题，反把 CLI 收养的好标题覆盖。
成功标准：
- 「任务注册表（Tasks）— <变更名>」「设计记录（Design Record）— <变更名>」「决策记录（Decisions）— <变更名>」「验证回执（flow）— <变更名>」均命中 TEMPLATE_H1_RE，normalize_display_title 回退去日期前缀语义名
- is_fallback_display_title 对上述 raw 模板标题判 True（存量污染行可被后续推送/reparse 自愈刷新）
- 收养语义标题在 thin 模板四件套 documents 推送后不回翻；既有词表条目与冒号自定义标题行为不变
- backend test_title_normalization.py 新增用例全绿且既有用例无回归
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:f3836948c0fdb7200d5ba490f04f7b8b241eb2b827f9691af1a738b253a2145c:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-02-title-norm-thin-h1-family 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. 「任务注册表（Tasks）— <变更名>」「设计记录（Design Record）— <变更名>」「决策记录（Decisions）— <变更名>」「验证回执（flow）— <变更名>」均命中 TEMPLATE_H1_RE，normalize_display_title 回退去日期前缀语义名
2. is_fallback_display_title 对上述 raw 模板标题判 True（存量污染行可被后续推送/reparse 自愈刷新）
3. 收养语义标题在 thin 模板四件套 documents 推送后不回翻
4. 既有词表条目与冒号自定义标题行为不变
5. backend test_title_normalization.py 新增用例全绿且既有用例无回归
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:a4063a2b2ffc64f82afe391eb4b485381db87ba4140b5cf82816e64ce3d0d7e5:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-02-title-norm-thin-h1-family 留痕重锚 -->
1. 「任务注册表（Tasks）— <变更名>」「设计记录（Design Record）— <变更名>」「决策记录（Decisions）— <变更名>」「验证回执（flow）— <变更名>」均命中 TEMPLATE_H1_RE，normalize_display_title 回退去日期前缀语义名
2. is_fallback_display_title 对上述 raw 模板标题判 True（存量污染行可被后续推送/reparse 自愈刷新）
3. 收养语义标题在 thin 模板四件套 documents 推送后不回翻
4. 既有词表条目与冒号自定义标题行为不变
5. backend test_title_normalization.py 新增用例全绿且既有用例无回归
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
