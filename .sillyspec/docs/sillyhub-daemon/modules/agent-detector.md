---
schema_version: 1
doc_type: module-card
module_id: agent-detector
author: qinyi
created_at: 2026-06-10T16:55:00
---

# agent-detector

## 定位
检测本机已安装的 coding agent CLI 工具。支持 12 种 agent provider，通过环境变量覆盖 + PATH 查找 + 版本探测 + 最低版本检查完成全面检测。为 daemon 注册阶段提供可用 agent 列表。

## 契约摘要
- `AgentDef` — agent 定义：bin 名称、环境变量名、版本正则、协议类型、最低版本
- `DetectedAgent` — 检测结果：名称、路径、版本、协议、是否可用、版本警告
- `AgentInfo` — 已废弃的兼容数据类
- `AgentDetector.detect_all() -> list[DetectedAgent]` — 异步检测全部 agent
- `AgentDetector.detect_one(name) -> DetectedAgent | None` — 检测单个 agent
- `AgentDetector.is_available(name) -> bool` — 同步快速检查可用性
- `AgentDetector.get_capabilities(agents) -> dict` — 已废弃的兼容方法

## 关键逻辑
```
detect_all()
  for each of 12 AGENT_DEFS:
    _detect_single(name, defn)
      bin_path = _resolve_bin_path(defn)
        → os.getenv(env_path) && file exists → path
        → shutil.which(bin) → path
        → None (unavailable)
      version = _detect_version(bin_path, defn)
        → run `<bin_path> --version`, apply version_pattern regex
      version_warning = check_min_version(name, version)
      return DetectedAgent(...)
```

## 注意事项
- 12 种 provider 的定义在 `AGENT_DEFS` 字典中，新增 agent 需在此添加条目
- 环境变量命名规则：`SILLYHUB_<NAME>_PATH`，如 `SILLYHUB_CLAUDE_PATH`
- 版本检测超时 10 秒（`asyncio.wait_for`）
- `version_pattern` 是正则表达式，需与对应 CLI 的 `--version` 输出格式匹配
- `get_capabilities` 和 `AgentInfo` 标记为废弃但保留兼容性
- 依赖 version 模块做版本比较

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
