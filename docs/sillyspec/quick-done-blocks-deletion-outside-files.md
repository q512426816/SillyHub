# 活跃坑：sillyspec quick `--done` 审计硬拦【所有文件删除】，无任何 flag / `--files` 声明可解锁

> 状态：**活跃（待工具修复）** · 发现于 2026-08-11 · quick `ql-20260811-002-a623` + `ql-20260811-004-067d`（change-detail-layout-rework 收尾，删 CollapsibleCard 死代码）

## 现象

quick step 3 `--done` 时，只要 `git status` 里有**任何** `D`（删除），审计就 BLOCKED：

```
🚫 quick 变更边界审计 — BLOCKED：
   - 删除文件: <path>
```

与 `--files` 声明**无关**——即便被删文件在 step 1 `--files` 列表内，仍拦。按 CLI 提示加 `--force-baseline --allow-new` 重跑，**仍 BLOCKED，提示文案一字不差**，即 CLI 自己建议的解锁 flag 对删除场景**无效**。

## 这是两道【独立】审计（关键认知）

quick `--done` 边界审计有两条互不相干的硬规则：

1. **allowedFiles**：改动的文件必须在 step 1 `--files` 声明内，否则「超出 allowedFiles」拦。**可解**——把文件列入 `--files` 即过。
2. **删除**：`git status` 有任何 `D` 即「删除文件」拦。**独立硬规则，不可解**——`--files` 声明、`--force-baseline`、`--allow-new` 均无效（实测）。

> ⚠️ 本坑早版文档曾写「step1 把被删文件列入 --files 即可绕过」——**那是错的**，只解决了规则①，规则②照拦。`ql-004` 专项验证：删除目标已正确列入 `--files`（规则①「超出 allowedFiles」消失），但规则②「删除文件」仍硬拦，`--force-baseline --allow-new` 也不解。

## 复现 / 验证手法（两次实测）

- `ql-002`：删 CollapsibleCard，被删文件**不在** `--files` → 规则①②都拦。
- `ql-004`：reset 重来，step 1 把被删文件**列入** `--files` → 规则①消失、规则②仍拦；`--done --force-baseline --allow-new` → 仍规则②拦。

即 **quick 流程根本无法删除文件**，没有任何姿势能过。

## 规避（当前唯一可行）

1. **死代码删不掉就先留着**：本次 quick 改为不删，死代码留作后续处理（生产构建 tree-shake 会剔除未引用组件，其测试照常过，无害）。
2. **若必须删**：只能在 **quick 流程之外** 直接 `git rm` + `git commit`（需用户显式确认绕过 quick；本仓 `ql-20260811-004-067d` 即如此处理——quick 三次 `--done` BLOCKED 后用户选直接 git 提交，QUICKLOG 手动标记「已完成（直接 git 提交）」）。
3. **别再尝试** `--files` 声明删除目标 / `--force-baseline` / `--allow-new` / 拆下个 quick ——实测对删除全无效，纯浪费一轮 `--done`。
4. 走完整 change 流程（brainstorm→execute）理论上 execute 的 Task Review 用 git diff（含 `D`），可能不受此限，但**未验证**；且对 2 文件死代码删除是杀鸡用牛刀。

## 工具改进建议（待修）

1. 审计应**区分「删除」与「新增/覆盖」**：删无引用死代码是常见合理重构，当前一刀切拦死。
2. 提供 `--allow-delete`（对称 `--allow-new`），或在 `--force-baseline` 下放行声明内/任意删除。
3. **BLOCKED 提示文案必须名实相符**：当前提示「`--force-baseline --allow-new` 即可解锁」，对删除场景实测无效，是误导——用户照做会卡死循环。
