# verify-postcheck 解析 local.yaml modules 块不剥离 CRLF → 恒回退全量对账 — 已修复

- 发现日期：2026-08-20（变更 2026-08-20-runtime-readpoint-repo-first verify 实测对账）
- 状态：已修复（工具仓 commit `f191fc4`，随 3.26.13 发布）：`extractModules` / `extractKnownFailures` 解析入口统一 `normalizeLineEndings` 归一（建议方案落地），附带修复 `parseFlowValue` 双引号值不解 `\"` 转义。测试 `verify-postcheck-crlf.test.mjs` + `verify-crlf-module-subset-e2e.test.mjs`（本机 2026-08-21 实跑通过）

## 现象

`test_strategy: module` + modules 块格式正确（inline flow、两空格缩进、顶层 key），
verify 对账仍报「local.yaml 未配置有效的 modules: 块，回退全量」，然后跑全量
`commands.test`（backend 全量 pytest + frontend 全量 + daemon 全量）——在 600s
默认超时下跑到 61% 被杀，verify 被阻断（reason: 测试命令超时）。

## 根因

`verify-postcheck.js` 的 `extractModules` 逐行 `line.match(/^  ([A-Za-z0-9_.\-]+):\s*(.*)$/)`
在 CRLF 文件上捕获组 2 尾部带 `\r`，`parseFlowValue` 随之失配——**所有条目解析失败**，
modules 返回 null。本仓 local.yaml 全文件 CRLF（150/150 行，Windows 环境正常形态），
故 module 子集**从未生效过**（此前各变更的 verify 对账其实都在跑全量或恰好全量能过）。

同文件 `extractTestStrategy` 的 `^\s*test_strategy:\s*([A-Za-z_]+)\s*(?:#.*)?$` 因
字符类不含 `\r` 反而能命中（`\r` 落在 `(?:#.*)?$` 的 `$` 前 `.*` 之外——实测
test_strategy 解析正常、modules 全灭，行为分裂可证）。

## 影响

- verify 阶段 CLI 对账无法按模块收窄：全量跑一次 ~10-17min（三端），600s 默认超时
  下 backend 全量（~2min 常态、并发负载下更久）+ frontend + daemon 串联必超时；
- 用户被误导以为是 modules 块写错，反复改配置无效。

## 绕过（当前可用）

跑 verify --done 前设环境变量调大对账超时，让全量真实跑完：

```
SILLYSPEC_TEST_TIMEOUT_MS=2400000 sillyspec run verify --change <名> --done ...
```

或临时把 local.yaml 转 LF（会触发 git 与工具链的其它行为差异，不推荐常开）。

## 建议工具修复（sillyspec 仓）

`extractModules`（及同文件所有逐行正则）统一在 split 后先 `line.replace(/\r$/, '')`，
或在读文件处一次性 `yamlText.replace(/\r\n/g, '\n')`——一处收口，全文件受益
（`extractKnownFailures` / `parseFlowValue` 同查）。
