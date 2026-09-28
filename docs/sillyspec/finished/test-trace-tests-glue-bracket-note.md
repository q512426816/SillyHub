# test-trace tests[] 把「用例名」注解粘进路径（flow done 补全解析缺陷）— 活跃坑

- 发现日：2026-09-27（sillyspec 仓 `2026-09-27-ui-visual-guidance` 变更归档件实证）
- 影响工具：SillySpec CLI `flow done` 自动补全（tests[] 生成侧），版本 3.31.0
- 状态：**活跃**——CLI 侧未修；平台读侧已防御（见「已做缓解」）

## 现象

requirements.md 测试绑定槽按约定写「项目相对全路径＋用例名」，用例名用「」包裹：

```
test/ui-visual-guidance.test.mjs「detectUiTouch 正例：页面/前端/UI/视觉/组件/tsx」
```

`flow done` 把整串（路径＋首个「注解」）收进 `test-trace.json` 的 `tests[]`，FR-01~04/06 六行有五行带注解粘联（同槽多段注解只粘首段；槽内以空格分隔的写法如 `path 全部 12 用例（…）` 则被按空白切开、未粘联——粘联与否取决于「」是否紧跟路径）。

## 危害

平台变更详情页「沉淀资产」卡的测试文件点击按归一后 basename 调 explorer search，粘联路径必然零命中 → 用户恒见「未在仓库中找到该测试文件」误报（文件其实就在仓库里）。sillyspec 仓 `2026-09-27-ui-visual-guidance` 归档后五条 FR 的测试锚点全部不可点开。

## 已做缓解（平台读侧，2026-09-27-assets-testfile-bracket-note）

`frontend/src/components/changes/detail/change-assets-card.tsx` 的 `normalizeTestFilePath` 增加 `/「[^」]*」/g` 剥离，存量粘联数据点开即恢复。

## 待 CLI 侧修复

`flow done` 补全生成 `tests[]` 时应把路径与「用例名」注解拆开，`tests[]` 只存纯路径（用例名走已有 raw_binding / 摘录通道）。修复后本记录移 `docs/sillyspec/finished/`。

## 处置记录（2026-09-28）

**定性与前坑对账**：「路径＋『』注解粘联」不是缺陷，是 2026-09-26-binding-anchor-fidelity
（`c5db711a`）落定的书写原形契约——tests[] 条目携带用例锚四形态（「」组/#/::/>），与
前一坑 test-trace-extract-truncates-case-suffix 的诉求（「摘录保真、`::用例` 后缀不截」）
是同一件事的两面；「tests[] 只存纯路径」属设计反转，会把前坑重新打开，不采纳。粘联形态
的正确消费契约是**文件面剥锚**：CLI 侧 `testAnchorFile` 单源（残差实测/watcher 归属/rot
覆盖/unbind/FR 覆盖/flow 声明面，全部已接），平台读侧 `normalizeTestFilePath` 剥「」
（`a1e5f85fe`，2026-09-27-assets-testfile-bracket-note，存量数据点开恢复）。

**本轮补齐的真实缺口（sillyspec 仓工作树，未提交）**：坑观察到的「同槽多段注解只粘
首段」边角——`path「a」「b」` 此前静默丢弃「b」。`extractTestAnchors` 改为路径后连续
锚段逐段各产一条（无锚纯路径行为零变化；跨形态连写如 `#a::b` 按贪心单锚收，书写歧义
不拆译、剥锚后同归一路径）。测试：`flow-draft-binding-extract.test.mjs` 追加⑤多段锚
全收用例，8/8 全绿；test-bindings / fr-index / knowledge-digest / flow-protocol 回归
42 例全绿。

归档（危害面双端已防；保真契约维持；多段锚缺口已补）。
