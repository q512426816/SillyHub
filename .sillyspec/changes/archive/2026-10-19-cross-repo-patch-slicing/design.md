---
author: flow-machine-draft
created_at: 2026-10-19T11:08:26.361Z
---
# 设计记录（Design Record）— 2026-10-19-cross-repo-patch-slicing

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

跨仓冻结元数据已上资产卡，但看跨仓某文件 diff 只能进全屏预览读数 MB JSON。本次补齐对等切片能力：端点加可选 `repo` 参数（正文取 `change-patch.json scopeAudit.repos[repo].patch` 内联串，复用 `slice_patch_for_file` 与 200k 上限）；仓内文件清单不需要新增冻结字段——后端从 patch 块头解析新侧路径投影进 `ChangePatchRepo.file_list`（去重保序、超 `_PATCH_FILES_MAX` 截断标注），资产卡仓段渲染清单、点开走 `patch-file?repo=…` 弹窗（弹窗头标注跨仓键与 repos[] 数据源）。未命中仓键按 note 降级（与主仓切片「读不到留档是展示面降级」同语义，不做 422 白名单——`path` 的白名单是防穿越，repo 键无安全面）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `GET /changes/{cid}/assets/patch-file` 增可选 `repo` Query；缺省行为逐字节不变。
- `ChangePatchRepo` 增 `file_list: list[str]` 与 `files_truncated: bool`（additive）。
- `_read_patch_repos` 增 `_patch_header_paths`（patch 头 → 新侧路径）投影。
- 新增 `_read_repo_patch_file_diff(change_dir, repo, rel_path)`；`get_patch_file_diff` 增 `repo` 形参分发。
- 前端 `getChangePatchFile` 增可选 `repo` 参数；资产卡 patch 弹窗目标从 `string` 变 `{path, repo?}`（组件内部状态，无对外 API 变化）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   切片与清单都从收口时点冻结件读取，无实时窗口；repos 缺键/部分降级按 note/空清单 fail-open，不影响其它仓。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   纯读路径（`asyncio.to_thread` 读文件），无写；与既有主仓切片同一并发模型。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   在途变更目录件缺失走既有 note 降级；前端弹窗状态是组件局部 state，关闭即清。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   repo 键只在当前变更冻结面内解析；多仓同名 path 以 (repo, path) 为键切片，互不串扰；`file_list` 每仓独立截断。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：`file_list` 从 patch 头解析（而非独立清单字段），若 CLI 未来改 patch 格式（如 no-prefix diff）清单会静默变空——投影是 best-effory 展示面，切片命中与否仍有 note 兜底，可接受。放弃方案：①CLI 在冻结件里新增独立 repos[].files 字段——要跨仓改冻结契约且需 CLI 发版协同，解析现有内联正文零协同即可达成同一效果；②未知 repo 键抛 422 白名单——与端点「读不到留档是展示面降级」的既有语义冲突，且无安全面收益；③前端自行拉全量 change-patch.json 解析清单——4MB 传输只为拿文件名，浪费且受 content 端点截断限制。
