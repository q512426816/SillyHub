# redomain 干跑预览无视 --by-change（预览/落盘口径不一致）

- 发现日期：2026-10-02
- 工具版本：sillyspec@3.29.x（全局链接本机 dev 仓 `C:\Users\qinyi\IdeaProjects\sillyspec`）
- 影响命令：`sillyspec tests --redomain --from <域> --to <域> --by-change <变更名>`

## 现象

带 `--by-change` 干跑（不带 `--write`）时，预览列出**源域全部条目**而非该变更
的分批子集；实际 `--write` 落盘时 `redomainFrEntries` 正确按「变更：<名>」过滤，
只迁该变更条目。预览与落盘口径不一致。

## 根因

sillyspec `src/index.js` redomain 分支：预览路径 `planRedomain({ from, to, anchors })`
未传 `byChange` 参数（该函数也无此形参）；只有写路径 `redomainFrEntries` 接收并
应用 `byChange`。`--by-change` 正是为 `redomainFrEntries` 的分批键设计的（注释
引坑 fr-domain-suggest-typo-and-no-split-migration 缺陷2），预览侧漏接。

## 风险

用户按预览理解会发生「整域 16 条全迁」的误判；若因此放弃分批直接 `--write`，
会错置混合池里其它变更的条目（auto-* 伪域是混合池，整域迁移天然错置）。

## 规避（当前可用）

用多个 `--anchor <FR-id>` 替代 `--by-change` 做分批——预览与落盘两路径都接收
anchors，口径一致：

```
sillyspec tests --redomain --from auto-sillyspec --to change \
  --anchor FR-auto-sillyspec-040 --anchor FR-auto-sillyspec-041 ... [--write]
```

## 修复建议（工具侧）

`planRedomain` 增加 `byChange` 形参与过滤（复用 redomainFrEntries 的条目过滤键），
index.js 预览调用处透传 `byChange: byChangeD`。
