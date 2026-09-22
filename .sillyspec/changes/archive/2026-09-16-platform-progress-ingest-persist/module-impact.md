# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend（platform_sync） | `backend/app/modules/platform_sync/service.py` | 逻辑变更（`_sync_change_stage_status` ingest 权威落库 + `CLI_STATUS_TO_PLATFORM` 映射表 + 分支 1/3 接线；`_sync_change_title_from_documents` + `_TITLE_STAGE_ORDER` documents 推送 title 重派生 + 防复活双形态守卫；`_DISPLAY_KEY_RE` 收敛复用 title_norm） | 否 |
| backend（change） | `backend/app/modules/change/title_norm.py` | 新增（共享 title 归一化 helper：TEMPLATE_H1_RE 正则 + extract_h1 + normalize_display_title + DISPLAY_KEY_PREFIX_RE；platform_sync 与 parser 两写路径同源消费） | 否 |
| backend（change） | `backend/app/modules/change/parser.py` | 逻辑变更（`_parse_change` title 归一化接入 `normalize_display_title`；MASTER 缺席不补 exists=False 占位行） | 否 |
| backend（platform_sync） | `backend/app/modules/platform_sync/tests/test_router.py` | 测试更新（:831 status 断言 draft→in_progress，FR-01/D-002@v1 预期体现） | 否 |
| backend（change） | `backend/app/modules/change/tests/test_title_normalization.py` | 新增测试（P2a/P3 回归 17 用例） | 否 |
| backend（platform_sync） | `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` | 新增测试（P1 ingest 回归 10 用例） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/platform_sync/service.py` —— 属 backend 仓 `platform_sync` 业务域（backend/app/modules/platform_sync/ 前缀）；module-map 未单列 platform_sync 子模块（与既有 platform_sync 历次变更同型），索引无需 rebuild。
- `backend/app/modules/change/title_norm.py` —— 属 backend 仓 `change` 业务域（backend/app/modules/change/ 前缀），同型，索引无需 rebuild。
- `backend/app/modules/change/parser.py` —— 属 backend 仓 `change` 业务域，同型，索引无需 rebuild。
- `backend/app/modules/platform_sync/tests/test_router.py` —— 属 `platform_sync` 测试域，同型。
- `backend/app/modules/change/tests/test_title_normalization.py` —— 属 `change` 测试域，同型。
- `backend/app/modules/platform_sync/tests/test_stage_status_ingest.py` —— 属 `platform_sync` 测试域，同型。

判定：六文件全部落在既有 backend 模块路径前缀内，`_module-map.yaml` 索引无需 rebuild（无新模块、无游离文件）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 判定：六变更文件均属既有 backend 模块路径前缀（platform_sync/change 业务域 + 测试域），无新模块、无游离文件，索引无需 rebuild | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
