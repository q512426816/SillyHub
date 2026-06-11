---
schema_version: 1
doc_type: module-card
module_id: config
author: qinyi
created_at: 2026-06-10T16:55:00
---

# config

## 定位
管理 daemon 的持久化配置文件 `~/.sillyhub/daemon/config.json`。负责加载、保存和提供属性访问。不负责运行时状态管理或网络通信。

## 契约摘要
- `DaemonConfig(config_path?)` — 初始化并自动加载配置，缺失时生成默认值
- 属性访问：`server_url`, `token`, `runtime_id`, `workspace_dir`, `poll_interval`, `heartbeat_interval`, `max_concurrent_tasks`, `log_level`
- `get(key, default)` / `set(key, value)` — 泛型键值访问，set 自动持久化
- `save()` — 写入磁盘，自动创建父目录
- `to_dict()` — 导出完整配置字典

## 关键逻辑
```
DaemonConfig.__init__()
  → _load(): 文件存在则 json.load 合并 DEFAULTS
  → runtime_id 缺失时自动生成 uuid4 并 save()
  → 属性通过 @property 映射到 _data dict
```

## 注意事项
- DEFAULTS 中 `token` 和 `runtime_id` 默认为 None，首次使用必须由 CLI 或外部设置
- set() 方法每次调用都会写磁盘（json.dump），高频场景需注意
- 文件路径硬编码为 `~/.sillyhub/daemon/config.json`，不可通过环境变量覆盖
- 修改本模块需同步检查：cli（构造 DaemonConfig）、daemon（读取配置）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
