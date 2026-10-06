---
author: flow-machine-draft
created_at: 2026-10-06T04:29:51.468Z
---
# 需求规格（Requirements）— 2026-10-06-opencode-settings-config-poison

## 功能需求

> FR 由你撰写：每条 = `### FR-NN: 标题` + 一句带强度词的行为规定（必须=硬性；禁止=红线；
> SHOULD=建议须注理由；可以=可选）；边界情形加场景块 `#### 场景：名` + Given/When/Then 行。
> 标题行是成功标准锚（勿改写——收口做门柱对比）；正文与场景块归你。

### FR-01: 服务器 OpenCode Go 供应商行 settings_config 已清 NULL（psql 回显核对）

- 服务器 47.113.145.252 llm_providers 行 OpenCode Go 的 settings_config 必须为 NULL（注入器规则 7 不再有 env 块可覆盖平台注入）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-02: 平台 UI 真实新会话（OpenCode Go + deepseek-v4.1-flash）发送首句收到模型回复（第 1 轮已完成）

- 平台 UI 真实新会话（OpenCode Go + deepseek-v4.1-flash，经本机 daemon）发送首句必须收到模型回复且第 1 轮完成（不抛「selected model 不存在」/SSL 报错）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-03: 坑文档补记 settings_config 覆盖链教训（规则 7 优先级高于平台注入，编辑供应商数据时必须同步检查该字段）

- 坑文档 litellm-v1950-image-entrypoint-not-found.md 必须补记 settings_config 覆盖链教训（规则 7 优先级高于平台注入全部字段，编辑供应商行须同步检查该字段）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-04: 无代码改动，无测试面（纯运维数据 + 文档）

- 本变更禁止产生代码改动与测试面（纯运维数据 + 文档；仓库规则 0 全量留 CI 不适用——无代码可测）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：运维数据修正（psql UPDATE + 回显核对），无仓内自动化测试面
FR-02: 不适用：真机 UI 端到端验证（会话 9dd7cb17 回复「收到」第 1 轮已完成 + daemon 快照 settings_config=null 核对），无仓内自动化测试面
FR-03: 不适用：文档改动（docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md 2026-10-06 下午②段），以文件内容为证
FR-04: 不适用：本变更零代码文件改动（git diff 仅文档 + change 工件）
