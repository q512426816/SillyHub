"""Explorer module — 工作区文件浏览器（只读）backend 侧。

实时经 daemon WS RPC 浏览当前登录用户自己绑定的工作区副本（目录树懒加载 /
文件预览 / 下载 / 按文件名搜索），backend 不落任何本地文件状态。
设计依据：``.sillyspec/changes/2026-08-18-workspace-file-browser/design.md``。
"""
