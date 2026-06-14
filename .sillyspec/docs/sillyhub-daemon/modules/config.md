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
- `DEFAULT_CONFIG_DIR` — 默认目录常量 `~/.sillyhub/daemon`
- `DEFAULT_CONFIG_PATH` — 默认配置文件路径常量
- `DEFAULT_CONFIG` — 默认配置对象（token/runtime_id 为 null，其他字段含默认值）
- `DaemonConfig(configPath?)` — 初始化并自动加载配置，缺失时生成默认值
- 属性访问：`server_url`, `token`, `runtime_id`, `workspace_dir`, `poll_interval`, `heartbeat_interval`, `max_concurrent_tasks`, `log_level`
- `get(key, default)` / `set(key, value)` — 泛型键值访问，set 自动持久化
- `save()` — 写入磁盘，自动创建父目录
- `toDict()` — 导出完整配置对象

## 关键逻辑
```
new DaemonConfig()
  → _load(): 文件存在则 JSON.parse + 合并 DEFAULT_CONFIG
  → runtime_id 缺失时自动生成 crypto.randomUUID() 并 save()
  → 属性通过 getter 映射到内部 data 对象
```

## 注意事项
- DEFAULT_CONFIG 中 `token` 和 `runtime_id` 默认为 null，首次使用必须由 CLI 或外部设置
- set() 方法每次调用都会写磁盘，高频场景需注意
- 文件路径由 `DEFAULT_CONFIG_PATH` 常量推导，不可通过环境变量覆盖
- 修改本模块需同步检查：cli（构造 DaemonConfig）、daemon（读取配置）
- 配置文件格式与 Python 版完全兼容（G-02 契约不变）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
