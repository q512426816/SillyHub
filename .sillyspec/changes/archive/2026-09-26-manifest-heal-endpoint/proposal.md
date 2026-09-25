---
author: flow-machine-draft
created_at: 2026-09-25T23:10:15.905Z
---
# 提案书（Proposal）— 2026-09-26-manifest-heal-endpoint

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:ba06275efe40539e7435afa13bdb6d1d5ffa8923ddd2dabf48a17ff1a30c90ec:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-manifest-heal-endpoint 留痕重锚 -->
任务原话转写：动机：spec manifest 的 platform_deleted 墓碑无任何清除通道（2026-09-25 生产实证：4 个旧归档文件被墓碑无条件拒收，resolve --keep-local 永久卡死，只能 SSH 进生产库手工 UPDATE 治愈；全代码库无一处业务路径把 platform_deleted 置回 False）。冤案墓碑（archived 载荷误标 / 平台删除后本地恢复）需要一个人工拍板的正规恢复入口。

成功标准：
- 新端点 POST /workspaces/{id}/spec-workspace/manifest-heal：body 传 paths（显式文件清单），把这些行的 platform_deleted 置 False、exists 置 True（version 不动——下一轮常规同步自然重定基线），返回 healed 清单与 skipped（非墓碑行）
- 只接受显式 paths 清单（不做前缀批量——防误清整目录墓碑，单文件粒度即人工拍板单位）；路径不在该工作区 manifest 中 → 404 语义错误；非墓碑行跳过并计入 skipped
- 鉴权 WORKSPACE_WRITE；heal 后同步关闭该工作区开放的 spec-sync 冲突行（复用 _close_open_sync_conflicts——冲突闭环本来就是全绿语义，heal 即人工宣告已解决）
- 服务端 structlog 记审计事件（workspace_id/paths 数/操作者身份进 audit log 若既有钩子可用，否则 log.info 带路径数）
- 单测：墓碑行 heal（platform_deleted→False、exists→True、version 不变、非墓碑 skipped、404）+ heal 后开放冲突行被关闭
- 既有 spec_workspace 测试零回归
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:8ab62bcff979a0364da5873f786a17a6d9fa2eb40354a3b95e70cbf26d21493d:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-manifest-heal-endpoint 留痕重锚 -->
按成功标准机械推导，共 9 条验收面：
1. 新端点 POST /workspaces/{id}/spec-workspace/manifest-heal：body 传 paths（显式文件清单），把这些行的 platform_deleted 置 False、exists 置 True（version 不动——下一轮常规同步自然重定基线），返回 healed 清单与 skipped（非墓碑行）
2. 只接受显式 paths 清单（不做前缀批量——防误清整目录墓碑，单文件粒度即人工拍板单位）
3. 路径不在该工作区 manifest 中 → 404 语义错误
4. 非墓碑行跳过并计入 skipped
5. 鉴权 WORKSPACE_WRITE
6. heal 后同步关闭该工作区开放的 spec-sync 冲突行（复用 _close_open_sync_conflicts——冲突闭环本来就是全绿语义，heal 即人工宣告已解决）
7. 服务端 structlog 记审计事件（workspace_id/paths 数/操作者身份进 audit log 若既有钩子可用，否则 log.info 带路径数）
8. 单测：墓碑行 heal（platform_deleted→False、exists→True、version 不变、非墓碑 skipped、404）+ heal 后开放冲突行被关闭
9. 既有 spec_workspace 测试零回归
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:889ef8c4e3b7dd394d1cf57a7d90100ed8b02bf3c24da3b9bff08632b8e8ea47:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-manifest-heal-endpoint 留痕重锚 -->
1. 新端点 POST /workspaces/{id}/spec-workspace/manifest-heal：body 传 paths（显式文件清单），把这些行的 platform_deleted 置 False、exists 置 True（version 不动——下一轮常规同步自然重定基线），返回 healed 清单与 skipped（非墓碑行）
2. 只接受显式 paths 清单（不做前缀批量——防误清整目录墓碑，单文件粒度即人工拍板单位）
3. 路径不在该工作区 manifest 中 → 404 语义错误
4. 非墓碑行跳过并计入 skipped
5. 鉴权 WORKSPACE_WRITE
6. heal 后同步关闭该工作区开放的 spec-sync 冲突行（复用 _close_open_sync_conflicts——冲突闭环本来就是全绿语义，heal 即人工宣告已解决）
7. 服务端 structlog 记审计事件（workspace_id/paths 数/操作者身份进 audit log 若既有钩子可用，否则 log.info 带路径数）
8. 单测：墓碑行 heal（platform_deleted→False、exists→True、version 不变、非墓碑 skipped、404）+ heal 后开放冲突行被关闭
9. 既有 spec_workspace 测试零回归
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
