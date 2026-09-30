---
author: flow-machine-draft
created_at: 2026-09-30T00:34:57.823Z
---
# 提案书（Proposal）— 2026-09-30-title-adopt-clobber-guard

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:4a70f56869ed36f3b7d6af564b954f1cdc419c75ceb04c2150f0dcf9995d37c6:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-title-adopt-clobber-guard 留痕重锚 -->
任务原话转写：标题收养（工作区未提交的 _ensure_change_row 改动）与文档派生两条写路径互相覆盖，且收养段写库无保护：CLI 收养中文标题后，documents 推送（_sync_change_title_from_documents service.py:1232）与全量 reparse（_apply_parsed change/service.py:2766）都会把它无条件回写成 key 派生兜底名，标题随推送顺序翻转；同时 body.changes[].title 裸 dict 无长度校验（Change.title String(500)，Postgres 强制列宽），收养段 commit 无 try/except，异常会让 progress 上行 500 且部分状态已落库。
成功标准：
- 收养后的语义标题在模板 H1 documents 推送与全量 reparse 后保持不变（不被回翻为 key 派生名）
- 自定义 H1（--title 改名通道）经 documents 推送/reparse 仍能覆盖既有标题（改名能力不回归）
- body.changes[].title 超 500 字时截断到 500 再落库，收养段写库异常仅告警不阻断 progress 上行（200 不变）
- 兜底形态判定（空/等于 key/等于去日期前缀）与 500 上限收敛到 title_norm 一处，三条写路径共用
- 相关测试全绿（platform_sync 收养/documents 交互 + title_norm 助手 + _apply_parsed 守卫）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:b73bc62f0c3413006f6dacc7fa812b6e17772f44d82c91db107132392b825561:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-title-adopt-clobber-guard 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. 收养后的语义标题在模板 H1 documents 推送与全量 reparse 后保持不变（不被回翻为 key 派生名）
2. 自定义 H1（--title 改名通道）经 documents 推送/reparse 仍能覆盖既有标题（改名能力不回归）
3. body.changes[].title 超 500 字时截断到 500 再落库，收养段写库异常仅告警不阻断 progress 上行（200 不变）
4. 兜底形态判定（空/等于 key/等于去日期前缀）与 500 上限收敛到 title_norm 一处，三条写路径共用
5. 相关测试全绿（platform_sync 收养/documents 交互 + title_norm 助手 + _apply_parsed 守卫）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:5ee570d7c8ee79d4b6c9a96d89ad31f59a47188b622087f5f6424225c90182a9:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-title-adopt-clobber-guard 留痕重锚 -->
1. 收养后的语义标题在模板 H1 documents 推送与全量 reparse 后保持不变（不被回翻为 key 派生名）
2. 自定义 H1（--title 改名通道）经 documents 推送/reparse 仍能覆盖既有标题（改名能力不回归）
3. body.changes[].title 超 500 字时截断到 500 再落库，收养段写库异常仅告警不阻断 progress 上行（200 不变）
4. 兜底形态判定（空/等于 key/等于去日期前缀）与 500 上限收敛到 title_norm 一处，三条写路径共用
5. 相关测试全绿（platform_sync 收养/documents 交互 + title_norm 助手 + _apply_parsed 守卫）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
