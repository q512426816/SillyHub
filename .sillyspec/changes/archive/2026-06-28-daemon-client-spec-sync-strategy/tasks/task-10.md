---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-10
status: implemented
---
# task-10: packSpecDir 穿 junction + postSpecSync 三策略

## 状态：已实现（回填蓝图，代码已 apply）
**实现位置**：`sillyhub-daemon/src/spec-sync.ts:397`（walkDir 用 `fs.stat` 默认跟随符号链接，正确穿 junction）；`postSpecSync`/`packSpecDir` 三策略都走（既有不变，readFile 天然穿 junction 打包源项目真实内容）

## 目标
核实 packSpecDir/walkDir 用 fs.stat 跟随链接穿 junction；postSpecSync 三策略都走。

## 验收标准（已通过）
- [x] walkDir 用 fs.stat 跟随链接（非 lstat）
- [x] packSpecDir 穿 junction 打包源项目真实内容
- [x] postSpecSync 三策略都触发回灌

## 覆盖
FR-10, D-005@v1。参考 design §5.3 Phase3。
