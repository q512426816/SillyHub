# flow done lint 门 FAIL 时「命令与输出尾部见上」实际无输出

- 坑编号：flowdone-lint-fail-no-output
- 发现日期：2026-10-03
- 状态：活跃坑（待工具修复）
- 影响版本：sillyspec v3.29.3（src/run/quick-audit.js + src/flow.js 路径）

## 现象

`flow done` 测试门报 `❌ 测试门 FAIL：实测失败：lint（命令与输出尾部见上；修复后重跑 --done 不丢进度）`，
但该次输出的**上方从未打印 lint 段的命令与任何输出尾部**——quick-audit 的 lint 执行
（runVerifyLintCheck）全程静默，`printVerifyLintCheck` 未在 flow done 路径调用；flow.js 的
「FAIL 三件套」（失败行样本 + 结果文件 + 可粘贴重放批命令）只对 test 结果实现，lint 无同款。
test-result.json 也只落 test 模块，lint 结果（含 outputTail/reason/failureFiles）不落盘。
verify-lint-tally.json 只记 `lint 命令退出码 1` 一句话。

后果：lint 门红时 agent 拿不到失败原因，只能盲猜或全链手跑。本次实测三轮失败排查
（2026-10-03-usage-ingest-session-concurrency）靠 `node -e "import('…/verify-postcheck.js').then(m => m.runVerifyLintCheck({cwd, specBase}))"`
直调同参复现才定位（真实原因是我的 mypy 债，见下「顺带确认」）。

## 期望

lint 门 FAIL 时输出 lint 命令 + outputTail 末 N 行（对齐 test 的 FAIL 三件套），
并把 lint 结果对象写入 verify-runs/*/test-result.json（modules 数组并列一节）。

## 排障绕过（工具修复前）

```bash
node -e "
import('file:///<sillyspec 安装目录>/src/verify-postcheck.js').then(m => {
  const r = m.runVerifyLintCheck({ cwd: process.cwd(), specBase: require('path').join(process.cwd(), '.sillyspec') });
  console.log(r.status, r.reason, String(r.outputTail||'').slice(-1500));
})"
```

sillyspec 安装目录可用 `which sillyspec` 反推（本机 `C:/nvm4w/nodejs/node_modules/sillyspec`）。

## 顺带确认（非本坑，记录备查）

- lint 门无快照时超时预算 = 默认 3 分钟（`timeoutMs` 仅快照路径传 5 分钟）——全链
  冷缓存逼近该值；Windows 下 execSync 超时 `e.status` 为 null 会被记成「退出码 1」
  （verify-postcheck.js:292），超时与真实失败在该口径下不可区分。local.yaml 可配
  `lint_timeout_sec` 提升。
- quick-audit lint 失败归属鉴定（triageLintOwnership）在 failureFiles 与本会话文件
  有交集时维持硬拦——正确行为，但要求 lint 失败输出必须可见（回到本坑）。

## 关联变更

2026-10-03-usage-ingest-session-concurrency（thin→thick，两轮独立评审 PASS）

## 处置记录（2026-10-04）

**已修**（sillyspec 仓工作树，未提交），两件套 + 排障中挖出的潜伏 bug：

1. **lint FAIL 件套**（flow.js FAIL 块）：对齐 test 三件套——lint 命令（含 reason）+ 输出尾部
   后 15 行（`| ` 前缀逐行）+ 失败文件前 10 + 结果文件路径。「命令与输出尾部见上」从此名副其实。
2. **lint 结果持久化**（verify-postcheck.js 新增 `persistLintResult`）：优先并入 test 的
   test-result.json（modules 并列一节 `lint` 字段）；test 无结果文件（skipped）而 lint 实跑时
   独立落盘（`kind: 'lint'` 标识）；skipped 不落。quick-audit 门函数接线，快照模式随 P6b
   FAIL 回拷生效，resultPath 同款重映射。
3. **潜伏 bug（排障副产物，比本坑更重）**：`runQuickTestLintGate` 的 `const failed = []` 声明
   在 try 块内——finally 的快照证据回拷 + resultPath 重映射读 `failed.length` 抛
   ReferenceError 被空 catch 吞掉，**P6b（2026-09-28-split-guard-and-gate-report）自落地即
   死代码**：快照 FAIL 时 verify-runs 随临时目录蒸发、FAIL 三件套的结果文件路径恒死链。
   修复：failed 提升到函数作用域。插桩实证（DBG-COPYBACK-THREW: failed is not defined）。

**测试**：`test/flowdone-lint-fail-output.test.mjs` 2/2（persistLintResult 三态单元 + flow done
lint FAIL e2e——夹具注意：交付须是 src/ 代码文件才触门，非代码文件 test/lint 双 — 假绿）；
flow-protocol / change-title-flow / quick-audit×2 / quick-gate×3 / verify-gate-command-missing
回归 74 例全绿。

**留档不修**（坑文「顺带确认」，已有配置面缓解）：非快照 lint 超时默认 3min（local.yaml
`lint_timeout_sec` 可调）；Windows execSync 超时 e.status=null 记为退出码 1 与真实失败不可
区分（超时语义已有 reason 标注兜底）。归档。
