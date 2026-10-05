# 设计记录（Design Record）— 2026-10-05-remove-promo-film

## 做法概述

用户明确不需要本会话生成的宣传片交付物，git rm 整删 docs/promo（v1+v2+README 共 31 文件）并移除 docs 模块文档条目；SillySpec 归档件（.sillyspec/changes/archive/2026-10-05-promo-film-*）保留为过程审计记录。git 历史含全部内容，随时可恢复。

## 接口契约

无接口变化；仅删除静态交付文件 docs/promo/** 与一条模块文档引用，无代码/构建/路由触及。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：不适用：纯静态文件删除，无运行时。
2. 并发写：不适用：单人串行 git 操作。
3. 切换/生命周期：安全：删除走单次原子提交，中断可由 git 状态自愈。
4. 作用域：不越界：仅删本会话生成物；不动平台代码与其余 docs。

## 风险与死路

最大风险是误删用户仍需要的文件——已核对 docs/promo 全部 31 个文件均由本会话两次变更生成（v1、v2、README），无第三方内容；恢复路径：git revert 本次提交。放弃的方案：保留 v1 只删 v2（用户语义是「生成的我不需要」，两版都是生成的，全删）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 删除 | docs/promo | 宣传片交付物整目录（sillyhub-promo.html、v2/index.html、v2/assets×28、README.md） |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/docs.md | 移除宣传物料条目 |