---
author: qinyi
created_at: 2026-10-11 16:53:11
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 工作区管理员（owner/admin） | 维护关联仓挂载引用 |
| 工作区成员 | 查看跳转/回显匹配提示 | |

## 功能需求

### FR-01: 挂载引用与跳转
Given 平台上存在多个工作区
When owner/admin 在关联仓表单中从工作区下拉选择一个（排除当前工作区自身）并保存
Then 登记行 ref_workspace_id 写入；列表条目返回对方工作区 {id, name, slug}；前端条目可点击跳转 `/workspaces/{id}`。

### FR-02: 摘除与软删降级
Given 已挂载条目
When 编辑时清空选择（null=显式摘除）或对方工作区被软删除
Then 编辑场景摘除引用（行保留）；软删场景读时降级——摘要/跳转/匹配输出一律为 null（登记行与 FK 落库值保留；匹配与挂载校验均过滤 deleted_at，Grill X-001）。

### FR-03: 回显匹配提示
Given 本机回显快照含 local_only 条目
When backend 对照时仅对 local_only 条目、按 key 在当前用户可见工作区集（过滤软删；限定可见集防泄露，Grill X-002）name/slug 精确匹配（多命中 name 优先、仍多取 id 最小）
Then 命中时该条目附 matched_workspace {id, name, slug}（提示性字段，不写库不自动挂载）；未命中为 null。

### FR-04: 前端展示
Given 用户查看关联仓卡片
When 条目已挂载 → 显示对方名+跳转图标；回显条目 matched_workspace 命中 → 显示「匹配到 XX」提示
Then 挂载跳转用 router push；未挂载条目行为不变；双主题 brand 语义阶。

## 非功能需求
- 兼容性：老条目无 ref_workspace_id 零影响；SET NULL 不破坏既有行；协议 additive。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01/03/04 | 挂载+跳转+匹配形态 |
| D-002@v1 | FR-02/03 | 不自动写库（matched 提示）/软删降级/不跨权限 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
