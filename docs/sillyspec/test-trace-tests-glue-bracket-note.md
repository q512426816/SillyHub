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
