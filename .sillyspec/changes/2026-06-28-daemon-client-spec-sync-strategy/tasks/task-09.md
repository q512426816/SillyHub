---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-09
status: implemented
---
# task-09: junction 生命周期 + rm 防误删守卫

## 状态：已实现（回填蓝图，代码已 apply）
**实现位置**：`sillyhub-daemon/src/spec-sync.ts:187-222`（`ensureSpecJunction` helper：Win junction / Linux symlink 分支 `:216-220`，目标一致复用 `:205`，普通目录残留降级 `:202`，源项目不存在降级）；repo-native rm 守卫（`:95` return，到不了 `:147` 的 rm，R-01）

## 目标
junction 生命周期 helper（建立/复用/降级）+ repo-native 跳过 rm(specDir) 守卫。

## 验收标准（已通过）
- [x] junction 建立（Win junction / Linux symlink）
- [x] junction 复用（readlink 校验目标一致）
- [x] 普通目录残留/源项目不存在降级
- [x] repo-native 跳过 rm（不顺 junction 删源项目，R-01）

## 覆盖
FR-08, FR-09, R-01, R-02。参考 design §5.3 Phase3。
