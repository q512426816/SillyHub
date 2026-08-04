# QUICKLOG / tasks.md 条目标题落 (quick 任务) 占位符

> ✅ 状态：**已解决**（2026-08-04 修复，commit `2fcbbce`）。根因：`src/run/stage.js` allocateQuicklogEntry 的 `description` 取 `quickOpts.taskDescription`（= `--input` 文本），用户跑 `quick --linked-changes <c>` 启动常不带 `--input` → description 空 → `src/quicklog.js` `sanitizeDesc` 回退占位 `(quick 任务)`，QUICKLOG 条目标题与关联 tasks.md 的 task 行都成占位符。修复：①`quicklog.js` 新增导出 `deriveTitleFromLinkedChange(specBase, change)`——读首个关联变更的 proposal/design 首 `#` 标题，去「提案书 / 设计文档 —」前缀取语义标题；②`stage.js` 启动 desc 空 && linkedChanges 非空时回退 deriveTitle；③`flipEntryInContent` 翻完成时按 `--output` 的「需求：」字段刷新标题行（优先级 `--output 需求 > proposal 标题 > 占位`）。回归测试 `test/quicklog-cli-managed.test.mjs` 验收 2c（deriveTitle 三场景 proposal/design/无文档 + flipEntry 刷新，7 断言），67/67 通过。dogfood 自证：Quick C 自己的 --done 自动把标题从占位刷新成需求摘要。

## 现象

`sillyspec run quick --linked-changes <变更>` 启动时若不带 `--input`，CLI 写的 QUICKLOG 条目标题（`## ql-... | <时间> | <标题>`）与关联 tasks.md 的 `- [ ] ql-... <标题>` 都落 `(quick 任务)` 占位符，必须 `--done` 后手动精修。

## 影响

- 记录语义缺失，需手动补正（CLI 只写骨架、精修本是铁律，但标题连语义都没有加重负担）。
- dogfood 场景高频（用户常用 `--linked-changes` 不带 `--input`）。

## 关联

- 同族 quicklog 记录问题：`finished/quick-done-quicklog-duplicate-status-line.md`（CRLF 致状态行重复）。
- QUICKLOG 精修铁律不变（标题/文件多行括注/正文四段仍需 --done 后手动充实），本次仅让骨架标题有语义。
- 修复随 commit `2fcbbce`。
