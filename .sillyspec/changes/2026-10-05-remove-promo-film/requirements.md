---
author: flow-machine-draft
created_at: 2026-10-05T13:54:06.851Z
---
# 需求规格（Requirements）— 2026-10-05-remove-promo-film

## 功能需求

> FR 由你撰写：每条 = `### FR-NN: 标题` + 一句带强度词的行为规定（必须=硬性；禁止=红线；
> SHOULD=建议须注理由；可以=可选）；边界情形加场景块 `#### 场景：名` + Given/When/Then 行。
> 标题行是成功标准锚（勿改写——收口做门柱对比）；正文与场景块归你。

### FR-01: docs/promo 目录整体从仓库删除（git rm 显式 pathspec，历史可恢复）

- 必须：按成功标准执行删除（git rm 显式 pathspec 提交，不破坏 git 历史可恢复性；同步清理模块文档引用）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-02: .sillyspec/docs/multi-agent-platform/modules/docs.md 中 promo 条目移除

- 必须：按成功标准执行删除（git rm 显式 pathspec 提交，不破坏 git 历史可恢复性；同步清理模块文档引用）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-03: 删除后仓库无悬空引用（README/模块文档不再指向 docs/promo）

- 必须：按成功标准执行删除（git rm 显式 pathspec 提交，不破坏 git 历史可恢复性；同步清理模块文档引用）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯删除操作，以 git 提交与目录不存在为证
FR-02: 不适用：同上
FR-03: 不适用：同上（grep 证实无 docs/promo 悬空引用）
