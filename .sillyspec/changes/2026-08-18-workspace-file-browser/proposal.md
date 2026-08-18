---
author: qinyi
created_at: 2026-08-18 11:50:30
---
# 提案书（Proposal）— 工作区文件浏览器（只读）

## 动机

平台用户无法直接查看工作区里的文件：想确认某个文件内容，只能离开平台去本机 IDE。工作区代码只存在各成员本机的 daemon 宿主机上，平台缺少一条「浏览器 → backend → daemon → 磁盘」的只读浏览链路。本变更在工作区下新增「文件」标签页，用成熟开源组件（antd Tree + react-syntax-highlighter）提供好看、实用、顺畅的只读文件浏览体验。

## 关键问题

1. **看不到**：backend 容器读不到宿主机的 `root_path`（spec_workspace/router.py:151-152 明说），现有文件类端点都是别的作用域（runtime 级 list-dir、change 目录 files、scan-docs DB 文档），没有 workspace 作用域的磁盘浏览能力。
2. **读不了**：daemon 的 file-rpc 只有列目录、明确不读文件内容（原非目标针对 spec 场景）；host_fs.read_file 仅是后端内部委托通道，未对前端浏览开放。
3. **体验散**：前端现有文件树（ChangeFileTree）无代码高亮、无搜索、只覆盖变更目录；缺一个统一的工作区级浏览入口。

## 变更范围

- daemon：file-rpc 新增 `explorer_list_dir` / `explorer_read_file` / `explorer_search` 三个 RPC（realpath+allowed_roots 双重校验、10MB 截断、文件名全树搜索）。
- backend：新模块 `app/modules/explorer/` 四端点（tree/file/download/search），WORKSPACE_READ 鉴权，按当前用户绑定解析 daemon，完整错误映射（离线/超时/越界/版本过低/未绑定）。
- frontend：新页面 `/workspaces/[id]/explorer`（左树懒加载 + 右预览：代码高亮/Markdown/图片/下载 + 文件名全局搜索 + 三降级态），workspace-tabs 加「文件」标签。

## 不在范围内（显式清单）

- 不做任何写操作（编辑/新建/删除/上传）。
- 不做文件内容全文搜索（只做文件名搜索）。
- 不做平台侧文件缓存/镜像（实时转发）。
- 不做跨成员浏览他人工作区副本。
- 不改动既有 `list_dir` 裸 RPC 与 host_fs 通道。

## 成功标准（可验证）

- 工作区「文件」标签页可逐层展开真实代码树（daemon 在线时），点文件即时预览（代码高亮/MD/图片），可下载。
- 文件名全局搜索在本仓库（数千文件）实测可用，结果 ≤100 条截断有提示。
- daemon 离线 / 未绑定 / daemon 版本过旧三种场景均显示中文降级卡，不白屏不报错堆栈。
- 路径穿越（`../`、绝对路径、工作区内 symlink 指外）全部被拒，有测试矩阵覆盖。
- 未升级 daemon 的老环境其它功能不受影响（仅文件页显示升级提示）。
