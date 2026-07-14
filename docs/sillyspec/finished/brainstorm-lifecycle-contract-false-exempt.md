---
author: qinyi
created_at: 2026-07-13 00:27:00
type: sillyspec-tool-defect
status: resolved
resolved_at: 2026-07-13 13:20:00
resolved_by: ql-20260713-001-3e46
---

> ✅ **已解决（ql-20260713-001-3e46, 2026-07-13）**：收紧 `sillyspec/src/stage-contract.js` `validateBrainstormOutputs` 的 `declaresNotApplicable`——去掉裸单字「无」/「na」与 40 字符宽窗口，改为要求明确多字否定短语（不涉及/不适用/未涉及/不包含/没有/n·a/not applicable/none）且与「生命周期(契约)/lifecycle(contract)」紧邻（分隔符强制）。正常 design（含「lifecycle 状态无变化」「无需 lifecycle 事件」等）不再被误判「已豁免」；合法豁免（不涉及生命周期契约 / lifecycle contract: N/A / does not involve lifecycle）仍生效。回归测试加在 `test/stage-contract.test.mjs`（3 用例：假阳性不再误判 / 真实豁免生效 / 缺表阻断）。npm test 全套通过。

# sillyspec brainstorm Step13 生命周期契约表检测误判

## 现象

变更 `2026-07-12-worker-worktree-isolation` brainstorm 跑完 13/13 步（Step13 --done）时，CLI 输出警告：

```
⚠️ 阶段 brainstorm 校验警告：
   - design.md 显式声明不涉及生命周期契约 — 已豁免「生命周期契约表」要求
```

## 实际

design.md **有**完整的 §7.5 生命周期契约表（行 173，`## 7.5 生命周期契约表`），含 7 个事件（dispatch_worker 创建 worktree / worker 写+commit / worker complete_lease / converge git_merge / merge 冲突→converge 返回 / 冲突解决回写 / 合并后清理），必需字段在 §7 接口定义。

design.md 关键词明确涉及：lease / agent_run / daemon / complete / lifecycle（§7.5 标题"（涉及 lease / agent_run / daemon / complete / lifecycle，必填）"）。

## 判定

CLI 的生命周期契约表检测逻辑误判——把**有**契约表判成"显式声明不涉及"。

## 影响

- **不阻塞**：警告说"已豁免"，brainstorm 13/13 正常完成。
- **用户困惑**：警告文案误导，让用户以为 design 缺契约表（实际有）。
- **风险**：若 CLI 后续版本把"豁免"改成"阻断"，会卡住合规的 design。

## 待修（sillyspec 工具侧）

CLI 的生命周期契约表检测应：
1. 扫描 design.md 是否含 `## 7.5 生命周期契约表` 或等价标题 + 表格内容，而非依赖某句"声明"。
2. 或修正"显式声明不涉及"的触发条件（当前 design 没有任何"不涉及生命周期"的语句，不知 CLI 从哪推断）。

## 复现

```bash
sillyspec run brainstorm --change 2026-07-12-worker-worktree-isolation --done
# 输出含该警告，但 design §7.5 有契约表
grep -n "生命周期契约表" <changeDir>/design.md  # 行 173 命中
```

## 临时绕过

无需绕过（不阻塞）。design 自审 §12 已记录"生命周期契约表 ✅ §7.5 七事件"。
