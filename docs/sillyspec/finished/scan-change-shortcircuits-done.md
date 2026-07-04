---
author: qinyi
created_at: 2026-06-30 13:45:02
---

# scan：`--change` 短路 `--done`，平台命令模板无法推进 scan

## 现象

平台下发的 scan 推进命令模板为：

```
sillyspec run scan --done --change default --dir "..." --input "..." --output "..."
```

执行后只输出 `✅ 当前变更设置为：default`，scan 步骤**永不推进**（重新 launch 仍停在 step 1/8）。

## 根因

`src/run.js` 的 `runCommand()` 中，`--change` 分支在 `--done` 分支**之前**且直接 `return`：

```js
// 解析 --change <name>
let changeName = null
const changeIdx = flags.indexOf('--change')
if (changeIdx !== -1 && flags[changeIdx + 1]) {
  changeName = flags[changeIdx + 1]
}
...
// --change 设置当前变更名
if (changeName) {
  progress.currentChange = changeName
  progress.lastActive = new Date().toLocaleString('zh-CN', { hour12: false })
  pm._write(cwd, progress)
  console.log(`✅ 当前变更设置为：${changeName}`)
  return                  // ← 直接返回，下方 isDone 分支永远不执行
}
...
// --done
if (isDone) {
  return await completeStep(...)
}
```

即只要命令带 `--change <name>`，无论是否同时带 `--done`，都只设置变更名后退出，`completeStep` 永不触发。

## 影响

- SillyHub 平台 daemon-client 的 scan 推进命令固定带 `--change default`，导致 scan 在平台模式下**完全无法推进**（卡在 step 1）。
- 诊断困难：CLI 不报错，只输出一句"变更已设置"，看起来像成功。

## 规避

`--done` 命令**不要带 `--change`**（currentChange 已是 default 时无需重复设置）：

```
sillyspec run scan --done --dir "..." --input "..." --output "..."
```

## 建议修复

`runCommand()` 应将 `--done`/`--skip`/`--reset`/`--status` 的处理优先级置于 `--change` 之前；或在 `--change` 分支内不 `return`，仅记录 changeName 后继续流转。最小修复：把 `--change` 的 `return` 改为「设置后 fall-through 到后续 isDone/isSkip 分支」。

## 关联

- 版本：sillyspec 3.20.3（nvm4w 全局安装，`which sillyspec`）。
- 同批次发现的另一缺陷见 `scan-platform-params-ignored.md`（平台参数 --spec-root/--scan-run-id 等被完全忽略）。
