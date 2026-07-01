---
author: qinyi
created_at: 2026-07-01T14:05:00
type: tool-defect
---

# SillySpec 缺陷：plan step4 postcheck `resolveChangeDir is not a function` 崩溃

## 现象
plan 阶段 step 4（Wave 重排与可行性校验，CLI 自动 postcheck）启动即崩：
```
TypeError: resolveChangeDir is not a function
    at executePlanPostcheck (...\sillyspec\src\stages\plan-postcheck.js:388:17)
```
无法完成 plan step 4。重现：`sillyspec run plan --change <name>`（任意变更，step1~3 已完成后进 step4）。

## 根因（推断）
`plan-postcheck.js:388` 调用 `resolveChangeDir(cwd, progress, specDir)`，但当前安装的 sillyspec 版本里该函数**未被导入/已重命名/已删除**——与 [plan-postcheck-multi-change-bug.md](plan-postcheck-multi-change-bug.md) 记的"resolveChangeDir 存在但返回 null"是**不同变体**：那个走到 null 回退分支取错目录，这个连函数本身都没有，调用即 TypeError，根本进不了回退逻辑。

环境：`npm root -g` 下 `sillyspec`（node v24.15.0）。可能是一次重构把 `resolveChangeDir` 改名/合并到别处但 plan-postcheck.js 调用点未同步，或 import 语句缺。

## 影响
plan step 4 自动 postcheck（Wave 重排 + 蓝图一致性校验）无法运行，阻塞 `sillyspec run plan --done` 正常收尾。

## workaround（已验证有效）
plan 的实质产物（plan.md + tasks/task-NN.md）在 step 2/3 已全部落盘，step 4 只是 CLI 自动校验。绕过：
```bash
sillyspec progress complete-stage plan --change <变更名>
```
手动标记 plan 阶段完成，然后正常进入 execute。plan.md 的 Wave 分组/依赖/关键路径由人工在 step 2 自检过，不依赖 step 4 的自动重排。

## 建议修复（给 SillySpec 维护者）
- 修正 `plan-postcheck.js` 对 `resolveChangeDir` 的 import（恢复正确的导入路径或改用当前模块导出的等价函数）。
- 与 plan-postcheck-multi-change-bug 一并整改：postcheck 应直接接收 `--change` 参数定位 changeDir，不依赖可能缺失的解析函数。

## 关联
- [plan-postcheck-multi-change-bug.md](plan-postcheck-multi-change-bug.md)：同文件、同函数族的早先变体（返回 null 取错目录）。
