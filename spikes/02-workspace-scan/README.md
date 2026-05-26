# Spike 02 — SillySpec Workspace 扫描

## 验证目标

> 给定一个真实 `.sillyspec/` 目录，能正确解析出：
> - ProjectComponent（来自 `projects/*.yaml`）
> - Change（来自 `changes/change/*` 与 `changes/archive/*`）
> - 关键 frontmatter 字段（affected_components 等）
>
> 且扫描时间 ≤ 200ms（10×20 规模）。

## 前置准备

1. Python ≥ 3.12
2. `pip install -r requirements.txt`
3. 准备一个真实 `.sillyspec` 目录（或使用本仓库下 `2026-05-25-multi-agent-platform-bootstrap-v2/` 作为对照）

## 运行

```bash
cd spikes/02-workspace-scan
python scan.py <path-to-repo-root>
```

例如：

```bash
python scan.py c:/Users/qinyi/IdeaProjects/some-real-sillyspec-project
```

## 通过准则

- 输出 JSON 包含 components / changes 两个数组
- 每个 active change 的 docs 矩阵正确反映文件存在性
- 总耗时 ≤ 200ms
- 至少在 1 个真实 `.sillyspec` 目录上跑过

## 失败时的处理

- YAML 解析报错：补 schema 容错（spike 已默认 `safe_load`）
- 扫描超 200ms：用 `os.scandir` 替换 `Path.iterdir`，避免重复 stat
- 找不到 `.sillyspec`：当前 repo 不是 SillySpec workspace，找一个真实的
