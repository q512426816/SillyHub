"""SillySpec 进度同步层（platform sync）。

实现跨仓契约 ``sillyhub-progress-sync-contract.md`` 的 SillyHub 后端侧 3 端点
（POST progress 读 header + base_ts 冲突检测 / GET 列表 / GET 单 change）。
聚合存储 ``platform_change_progress`` 表（change_name 全局唯一 PK）。
与 ``/api/workspaces/{wid}/changes/*`` 派发层正交（契约 D-004）。
"""
