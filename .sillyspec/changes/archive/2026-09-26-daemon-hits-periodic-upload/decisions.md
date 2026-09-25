---
author: flow-machine-draft
created_at: 2026-09-25T23:43:43.153Z
---
# 决策记录（Decisions）— 2026-09-26-daemon-hits-periodic-upload

## D-001@v1: 风险与死路（design 槽4 收割）
- 决策：最大风险：5 分钟周期对高频写入工作区造成上行延迟峰值——评估：遥测是运营统计非实时信令，
  5 分钟粒度足够（postSync 即时通道仍覆盖同步场景）。次生：specs/ 大量绑定时每轮 stat 全集——
  mtime stat 微秒级且通常绑定 ≤10，无感知。放弃方案：①挂 heartbeat 节拍（15s）——过于频繁且
  heartbeat 模块职责不含 FS；②watcher 监听文件变化——Windows fs.watch 跨 junction 不可靠且
  引入新基础设施；③只留周期通道去掉 postSync 挂点——同步后要等最长 5 分钟才上行，即时性回退。
