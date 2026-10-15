# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/knowledge/search.py` | 逻辑变更（async 化）+ 数据结构变更（新增两 ORM） | 否 |
| backend | `backend/migrations/versions/20261015200000_knowledge_search_pgvector.py` | 新增（迁移：装扩展+两表） | 否 |
| backend | `backend/pyproject.toml` | 配置变更（新依赖 pgvector） | 否 |
| backend | `backend/app/modules/knowledge/router.py` | 调用关系变更（await 化+session_factory 注入） | 否 |
| backend | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | 逻辑变更（async 化）+ 数据结构变更（新增两 ORM） | 否 |
| backend | `backend/app/modules/knowledge/tests/test_router.py` | 调用关系变更（await 化+session_factory 注入） | 否 |
| deploy | `deploy/docker-compose.yml` | 配置变更（镜像替换） | 否 |
| deploy | `deploy/docker-compose.dev.yml` | 配置变更（镜像替换） | 否 |

## 未匹配文件

无（全部变更文件已归属到模块）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新backend模块卡（本次变更涉及） | done |
| `modules/deploy.md` | 更新deploy模块卡（本次变更涉及） | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
