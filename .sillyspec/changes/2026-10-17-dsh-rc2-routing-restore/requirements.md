---
author: flow-machine-draft
created_at: 2026-10-17T09:09:32.394Z
---
# 需求规格（Requirements）— 2026-10-17-dsh-rc2-routing-restore

## 功能需求

### FR-01: writeDshHome 写三件套（package.json 模板清单 + pnpm-workspace.yaml + 无 compat 的 patch），单测钉三件与「禁 compat」

- writeDshHome **必须**写三件套（package.json 含 dsh.profile.bundles 模板清单 / pnpm-workspace.yaml / cordis.patch.yml）且 patch **禁止**携带 compat 块；驱动模型 set_config_option **必须**发 valueId 数组串 `["sillyhub","<model>"]`；通知处理**必须**兼容信封拆包（有 update 键即拆）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-02: 驱动 set_config_option 模型值 = ["sillyhub","<model>"] JSON 数组串，单测钉板

- writeDshHome **必须**写三件套（package.json 含 dsh.profile.bundles 模板清单 / pnpm-workspace.yaml / cordis.patch.yml）且 patch **禁止**携带 compat 块；驱动模型 set_config_option **必须**发 valueId 数组串 `["sillyhub","<model>"]`；通知处理**必须**兼容信封拆包（有 update 键即拆）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-03: 通知信封拆包兼容两种形状（有 update 键即拆），单测/真机验证回复落库

- writeDshHome **必须**写三件套（package.json 含 dsh.profile.bundles 模板清单 / pnpm-workspace.yaml / cordis.patch.yml）且 patch **禁止**携带 compat 块；驱动模型 set_config_option **必须**发 valueId 数组串 `["sillyhub","<model>"]`；通知处理**必须**兼容信封拆包（有 update 键即拆）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-04: UI 真机一轮：dsh 会话回复正常渲染，模型自答 GLM-5.3-FlashX/智谱

- writeDshHome **必须**写三件套（package.json 含 dsh.profile.bundles 模板清单 / pnpm-workspace.yaml / cordis.patch.yml）且 patch **禁止**携带 compat 块；驱动模型 set_config_option **必须**发 valueId 数组串 `["sillyhub","<model>"]`；通知处理**必须**兼容信封拆包（有 update 键即拆）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-05: typecheck + dsh 相关单测全绿

- writeDshHome **必须**写三件套（package.json 含 dsh.profile.bundles 模板清单 / pnpm-workspace.yaml / cordis.patch.yml）且 patch **禁止**携带 compat 块；驱动模型 set_config_option **必须**发 valueId 数组串 `["sillyhub","<model>"]`；通知处理**必须**兼容信封拆包（有 update 键即拆）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: tests/dsh-settings.test.ts「anthropic base_url → 三件套布局（package.json 模板清单 + workspace + 无 compat 的 patch）」
FR-02: tests/interactive/dsh-acp-driver.test.ts「model + thinkingLevel=medium → set_config_option 扁平形状…」（valueId 数组串钉板）
FR-03: tests/interactive/dsh-acp-driver.test.ts + dsh-acp-events.test.ts（28 用例全绿；信封拆包真机实证于 UI 终验）
FR-04: 不适用：UI 真机一轮对话为命令级实测（会话 12b39e8b，模型自答 GLM-5.3-FlashX/智谱），无单测面
FR-05: 不适用：typecheck 为命令级实测（pnpm typecheck），单测面已由 FR-01..03 绑定覆盖
