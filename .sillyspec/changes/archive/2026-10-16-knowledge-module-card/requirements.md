---
author: flow-machine-draft
created_at: 2026-10-16T02:43:26.709Z
---
# 需求规格（Requirements）— 2026-10-16-knowledge-module-card

## 功能需求

### FR-01: _module-map.yaml 新增 sillyspec 模块卡，paths 覆盖 .sillyspec/knowledge/**，配套模块文档 modules/sillyspec.md 创建

- 必须：在 `.sillyspec/docs/SillyHub/modules/_module-map.yaml` 的 modules 下新增 `sillyspec` 模块条目，字段与既有条目同构（status/doc/paths/tags/aliases/entrypoints/main_symbols/depends_on/used_by/needs_review/concerns/review_reasons），paths 必须为 `.sillyspec/knowledge/**`；配套创建 `modules/sillyspec.md` 模块文档卡（frontmatter 含 module_id: sillyspec），说明该域定位/文件契约/蒸馏路由逻辑。

#### 场景：登记后蒸馏落真域

- Given knowledge 树此前未登记（FR 蒸馏落伪域 auto-sillyspec）
- When 模块卡登记 paths=.sillyspec/knowledge/**
- Then 后续变更交付该目录文件时 FR 蒸馏路由到 sillyspec 真域（本次以 redomain 成功 + fr/sillyspec.md 建立佐证）

### FR-02: FR-auto-sillyspec-083~085 三条迁入 knowledge/fr/sillyspec.md，条目 ID 不变（迁域不换号），伪域 fr/auto-sillyspec.md 清空或移除

- 必须：使用 `sillyspec tests --redomain` 官方命令迁移（禁止手工搬移条目），三条 FR 迁入 `knowledge/fr/sillyspec.md` 后 ID 保持 FR-auto-sillyspec-083/084/085 原样（D-001 铁律：迁域不换号，绑定/supersede 链按 ID 寻址）；迁移后伪域文件 `fr/auto-sillyspec.md` 不得再含 active 条目。

#### 场景：迁域不换号

- Given 伪域 fr/auto-sillyspec.md 含 3 条 active 条目（083/084/085）
- When redomain --write 执行
- Then fr/sillyspec.md 出现同 ID 三条（变更归属/最近确认 hash 不变），伪域文件清空或移除

### FR-03: redomain 干跑与 --write 输出一致无报错，迁移后 git diff 仅涉及模块图/模块文档/知识 fr 文件

- 必须：先干跑（不带 --write）核对将迁移的条目清单，再 --write 执行；两次输出条目一致且无报错；迁移后 git 变更面仅限：_module-map.yaml、modules/sillyspec.md、knowledge/fr/ 下文件及 redomain 联动的 knowledge/INDEX.md，禁止出现无关文件漂移。

#### 场景：变更面干净

- When 迁移完成
- Then git status 显示的改动文件全部属于上述白名单，无其它文件被动到

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：模块卡登记为配置/文档变更，验证走 yaml 解析 + 条目结构核对（task-02 验证步承载），无代码测试面
FR-02: 不适用：迁移由 sillyspec 官方命令执行且其自身校验 ID 保持，验证走迁移前后条目 ID diff 核对（task-03 验证步承载）
FR-03: 不适用：干跑/--write 对账与 git 变更面白名单核对均为命令输出与 git 状态检查，无代码测试面
