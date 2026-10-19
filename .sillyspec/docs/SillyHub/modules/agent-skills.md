# agent-skills — 本地 agent 技能文档（.zcode/skills/**）

## 定位

ZCode 宿主在本仓库的技能文档面（非运行时代码）：部署/运维类技能的流程知识，按技能名触发，
agent 照文档执行。部分文件在 git 库中（历史先例 204 个 `.zcode/**` 跟踪文件），部分仅本地。

## 主要内容

- `sillyhub-docker-deploy/SKILL.md` — 本机 Docker Compose 部署流程（构建/启动/验证/发布记录）。
  2026-10-19-host-settings-reload-latency 修正：`/daemon/latest/sillyhub-daemon.js` 分发验证
  用 GET（`-o /dev/null -w '%{http_code} %{content_type}'`）——该端点仅允许 GET，HEAD 实测 405。
- `deploy-to-server/SKILL.md` — 生产服务器镜像部署流程（本地打包 → 腾讯云 load）。
- 其余技能见目录。

## 维护口径

- 文档命令必须与端点/脚本实际行为一致（CLAUDE.md 规则 18 同源精神）；发现失真随手修，
  走所在变更的 probes 归因（本模块已在 `_module-map.yaml` 登记 paths）。
