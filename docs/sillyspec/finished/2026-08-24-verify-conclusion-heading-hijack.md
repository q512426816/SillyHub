# verify 结论识别被含「结果」的普通章节标题劫持

- 日期：2026-08-24
- 变更：2026-08-24-sessions-live-updates
- 状态：活跃（工具未修，文件侧规避有效）

## 现象

`verify --done` 报警告：`verify-result.md 未识别到结论章节（含 结论/Conclusion/Result/结果 的二级标题，后跟 PASS / PASS WITH NOTES / FAIL）`——但文件里明明有规范的 `## 结论` + 首行 `PASS WITH NOTES`。

## 根因（sillyspec 仓 src/stage-contract.js:461 extractVerifyConclusion）

```js
const headingRe = /^##\s[^\n]*(?:结论|conclusion|result|结果)/im  // 只取【首个】匹配
const slice = verify.slice(start, start + 400)                    // 只看该标题后 400 字符
const kw = slice.match(/\b(PASS(?:\s+WITH\s+NOTES)?|FAIL)\b/i)
```

两个叠加缺陷：
1. 正则取**首个**含关键词的二级标题——普通章节名带「结果/Result」（如 `## 测试命令与详细结果`、`## 测试结果`）排在真结论章节之前时劫持识别；
2. 只看劫持标题后 400 字符窗口——窗口内没有 PASS/FAIL 词就返回空。

后果：结论识别为空 → 空结论只出 warning 不阻断（FAIL 门仍安全），但 Change Risk Gate 消费同一提取函数，空结论使「PASS WITH NOTES 降级为 FAIL」类判定失去输入，风险门控形同虚设。

## 规避（文件侧）

verify-result.md 章节命名避开关键词：非结论章节标题不写「结果/结论/Result」（如改「测试命令与执行数据」）；结论章节固定 `## 结论` + 紧邻首行 `PASS / PASS WITH NOTES / FAIL`。

## 建议修复（工具侧，二选一或叠加）

1. 匹配所有候选标题，取其后 400 字符窗口内**含 PASS/FAIL 词**的那个（找不到再回退首个）；
2. 优先精确 `^##\s*结论\b` 类窄匹配，宽匹配只作回退。
