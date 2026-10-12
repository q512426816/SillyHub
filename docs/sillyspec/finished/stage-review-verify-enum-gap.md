# gate 要 verify 阶段 stage review，register-stage-review 枚举却没有 verify

- 记录日期：2026-10-11
- 发现变更：2026-10-10-all-engines-mcp-injection（verify 收口 + archive 全流程）
- 工具版本：本机 CLI 3.32.x（AGENTS.md SillySpec 段 v3.32.0）

## 现象

`gate verify` / `verify --done` 输出的 stage-review-hint 提示：

> 缺 verify 阶段的 stage review.json——verify/execute --done 的 Stage Review Gate 会拦。
> 先产出评审再注册：sillyspec register-stage-review --change <名> --stage verify

但按提示执行报错：

```
❌ [verify] register-stage-review: stage 无效 "verify"（应为 brainstorm|plan|execute）
```

`--help` 同样只列 `--stage <brainstorm|plan|execute>`。

## 根因

Stage Review Gate 的提示文案与 register-stage-review 的 stage 枚举不同步——gate 侧已认识 verify 阶段评审，register 命令的枚举校验未跟上。

## 影响

- 提示给出的修复命令本身不可执行（agent 照提示跑必报错，浪费一轮）。
- 实测（2026-10-11 本变更）：verify --done 并未真的被 Stage Review Gate 拦（gate 输出里该检查为 informational，探针一致性/测试门才是硬拦），全仓也从未存在过 verify-* 的 stage-review 目录——疑似提示超前于门禁实现。

## 护栏/绕过

- 遇到该提示先直接跑 verify --done 试收口：实际未拦则忽略提示（本变更实证路径）。
- 若未来版本真开始硬拦 verify 评审，register 枚举必须先补 verify，否则形成死锁（提示命令不可执行 + 门禁必拦）。

## 修复建议

二选一对齐：① register-stage-review 枚举补 verify（生成骨架/adopt 与其他 stage 同构）；② gate 提示降级为与实现一致（verify 阶段不要求 stage review）。

## 处置记录（2026-10-12）

**按方向②修复**（sillyspec 仓工作树，未提交）：期望面对齐门禁现实——Stage Review Gate
（gates.js:1513）实际只拦 `brainstorm|plan|execute`，verify 从不在列。修法：

1. **默认档 hint**（machine-interface.js e3 块）：`stage === 'verify' || 'execute'` 收窄为
   仅 execute；文案「verify/execute --done 的 Stage Review Gate 会拦」改「execute --done
   的…」。verify 不再产提示（提示命令 `--stage verify` 不可执行 + 指称的门禁不存在，
   双重误导消除）。
2. **--full 档**（e2 块）：`full-stage-review` 检查限 execute；verify 的真实门面 e1
   target-files 对账检查保留不动。
3. **测试契约同步**（gate-full-preflight.test.mjs）：F1/F2/F4 的 verify stage-review 期望
   改为「不在场」断言（原契约钉的是超前于门禁实现的期望面——即本坑病灶），新增 F5
   （verify 默认档无 hint / execute 有且文案指称 execute）。

方向①（register 枚举补 verify）不采纳：全仓从未存在 verify-* stage-review 目录，无
消费面，补枚举是铸造无人使用的新工件惯例。死锁风险（护栏②提及的「未来硬拦+枚举缺」）
随期望面收敛而消失——若未来真引入 verify 阶段评审，枚举与提示须同变更落地。

**测试**：gate-full-preflight 4/4 + gate-docs-only / gate-derive-spec-drift /
diagnostic-codes-parity / register-stage-review-cwd-deep 6/6 + stage-review 族
（align-execute-review-gate / stage-review-checklist / platform-register）11/11 全绿。归档。
