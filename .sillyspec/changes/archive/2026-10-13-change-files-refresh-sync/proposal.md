---
author: qinyi
created_at: 2026-10-13 12:57:48
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）— 2026-10-13-change-files-refresh-sync

## 动机

变更详情页文件树（`GET /api/workspaces/{ws}/changes/{id}/files`）只读平台本地镜像目录，数据新鲜度完全依赖 daemon 会话终态的 spec 同步。daemon 无会话活动期间（用户在开发机手改文档、手动跑 sillyspec CLI 等），平台文件树持续滞后——页面上的「刷新」按钮点了没有任何效果，用户感知为「这个刷新没意义」。

## 关键问题

1. **同步只发生在会话终态**：daemon 的 spec 上行绑定在会话生命周期上，无会话活动时平台侧无任何主动拉取手段。
2. **命令与目标错位**：用户点名的 `sillyspec platform sync-docs` 只写平台 DB documents 列，不写文件树读取的镜像目录——单跑它刷新依然无效（brainstorm step3 澄清，D-001@v1）。
3. **刷新接口零主动性**：GET files 是纯镜像扫描，没有触发数据上行的通道。

## 变更范围

- daemon 侧新增 RPC method `sillyspec_sync_change`（参数清洗 / 15s 防抖 + in-flight 去重 / 复用 `_sillyspecStatusRoots` 根映射 / 串行执行 `platform sync --change` + `platform sync-docs --change`）。
- backend 侧 `list_change_files` 前插同步前置（绑定解析 → 在线判断 → `send_rpc` 15s 超时），四路失败静默降级返回现有镜像数据。
- 两仓各新增一个测试文件。前端零改动、响应 schema 不变、无迁移。

## 不在范围内（显式清单）

- 不做全树同步（仅 change 粒度定向）。
- 不改 files/content、files/raw、files/pending 端点。
- 不新增 HTTP 端点、不改任何请求/响应 schema。
- 不做跨用户共享防抖 / Redis 级防抖。
- 不做同步失败的用户可见提示（静默降级，日志可见）。

## 成功标准（可验证）

- 绑定 daemon 在线时刷新文件树：daemon 本机对应变更的文档改动在同步完成后出现在返回清单中（集成链路可复现）。
- daemon 未绑定 / 离线 / RPC 超时 / 远端错误四路场景：GET files 均正常返回现有镜像数据，HTTP 状态恒 200 路径不 500（pytest 四路用例）。
- daemon 侧 15s 内重复触发返回 skipped（防抖用例）；同变更并发触发返回 in_flight（用例）。
- 老 daemon（未注册新 method）收到请求走 DaemonRpcRemoteError 降级路径（用例），前后端无版本耦合。
- 既有 test_files_router.py 全绿（service.list_files 零改动的回归证据）。
