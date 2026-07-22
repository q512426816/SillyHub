# quick --done 在 QUICKLOG 产生重复「状态」行

> ✅ 状态：**已解决**（2026-07-22 修复并归档）。根因是 **CRLF**：`flipEntryInContent`（`src/quicklog.js`）用 `lines[i] === '状态：进行中'` 精确匹配，Windows CRLF 文件 `split('\n')` 后行尾带 `\r` 恒匹配失败 → 走「兜底插入」产生重复。修复：状态行匹配改为前缀匹配容忍 `\r`（`/ ^状态：进行中\r?$/`），替换而非插入；写入保持 `状态：已完成`（无 `\r`），不破坏文件现有行尾。回归测试 `test/quicklog-cli-managed.test.mjs` 验收 7b（CRLF flip：恰好一条已完成 + 无进行中残留 + 结果行追加），43 断言全过。
>
> 「`--output` 只落「结果：」且偏简」为**格式偏好、非 bug**：CLI 写入内容即 `--output` 参数原文，丰富格式（需求/方案/结果/影响/遗留/坑）由使用者在 `--output` 里自行组织，或事后手动展开——属工作流，不改代码。

## 现象

`sillyspec run quick --done --output "..."` 收尾 QUICKLOG 条目时，**不替换**原「状态：进行中」行，而是在其上方**插入**「状态：已完成」，导致条目内同时出现两行「状态」：

```
状态：已完成
状态：进行中
```

语义矛盾，且易把该 ql 条目误判为仍在进行。

另外，`--done --output "..."` 的内容只落到条目的「结果：」字段且偏简，**不会**自动展开为归档丰富格式（需求/方案/结果/影响/遗留/坑）。

## 影响

- 轻微。quick 流程正常推进（3/3 完成），功能与暂存不受影响。
- 记录不干净，需手动补正。

## 规避 / 手动补正

每次 `quick --done` 后，检查 `.sillyspec/quicklog/QUICKLOG-<user>.md` 对应 ql-ID 条目：

1. 删掉重复的「状态：进行中」行（保留「状态：已完成」）；
2. 将「结果：」字段补写为归档丰富格式（需求/方案/结果/影响/遗留/坑），对齐既有条目风格（参考 commit `dad887ac` 的改写格式）。

## 关联

- 同类 quick `--done` 已知坑：`docs/sillyspec/finished/` 内相关记录 + memory `sillyspec-quick-done-unreliable-specroot`（--output guard 不落盘 / specRoot 双根）。
