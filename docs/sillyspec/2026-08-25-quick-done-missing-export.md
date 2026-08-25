# SillySpec 工具坑：quick --done 因 complete-handlers 引用缺失导出崩溃（v3.27.5）

- 发现日期：2026-08-25
- 状态：活跃（待工具修复）

## 现象

`sillyspec run quick --done --change <quick-session>`（末步，四参数或旧 --output 形式均触发）报：

```
SyntaxError: The requested module './shared.js' does not provide an export named
'collectOtherQuickSessionDeclarations'
    at src/run/complete-handlers.js:28
```

quick 阶段前两步（理解/实现）正常；末步 --done 写 QUICKLOG 语义内容时必崩，任务无法经 CLI 收尾。

## 复现

```bash
sillyspec run quick --input "任意任务"   # step1/2 正常 --done
sillyspec run quick --done --change <id> --req ... --cause ... --solution ... --result ...
# → 上述 SyntaxError
```

## 根因（推测）

CLI 安装包（E:\Software\nvm\v24.14.1\node_modules\sillyspec）内
`src/run/complete-handlers.js` 顶层 import 了 `collectOtherQuickSessionDeclarations`，
而 `src/run/shared.js` 未导出该名（grep 0 命中）——发版时 shared.js 漏导出或
complete-handlers.js 引用了未发版的新函数。

## 绕过

`--done` 失败后 QUICKLOG 中已有「进行中」占位条目（首步落盘）。手工把条目按
「状态/关联变更/文件/根因/方案/结果」补齐并标「已完成」（本次 ql-20260825-002 即此处理）。
注意 quick 的 DB 进度停在 step 3 未完成——后续若有 gate 依赖该状态需留意。
