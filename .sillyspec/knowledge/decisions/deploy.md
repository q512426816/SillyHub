# 决策知识 — deploy

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-backend-019@v1 部署变更 = 镜像换 pgvector/pgvector:pg16 + 迁移内装扩展；升级步骤单列
状态：implemented
变更：2026-10-15-knowledge-search-pgvector
原编号：D-008@v1
锚点：未记录
最近确认：898bb901c
理由：①docker-compose 的 postgres 镜像 postgres:16-alpine → pgvector/pgvector:pg16（数据卷不丢，官方同源镜像+vector 扩展）；②扩展安装放 alembic 迁移内（CREATE EXTENSION IF NOT EXISTS vector + 方言守卫——pgcrypto/pg_trgm 同款）；③升级顺序：换镜像重启 PG → 跑迁移 → 重启 backend；④升级前生产库跑验证 SQL（SELECT name FROM pg_available_extensions WHERE name='vector'）确认扩展可用（用户可能手动装过——核实过代码无痕迹，但手工操作查不到）。dev compose 同步换。
故障面：迁移先于镜像替换执行 → 方言守卫内检查 extension 可用性，缺失时报错中止（信息含修复指引），不留半态表。
退役判据：无。

## D-backend-025@v1 治理技术方案选型——子进程封装 + WS 推送 + 预览持久化（方案 A）
状态：implemented
变更：2026-10-16-backend-mem-polling
原编号：D-001@v1
锚点：backend/app/modules/knowledge/vector_search.py:137
最近确认：439cdc46c
理由：**方案 A**。四个机制组合：①嵌入计算子进程封装（闲置自退+OOM 保主进程）；②change-writes 改 WS 事件推送，30s 轮询降 120s 兜底；③会话标题预览持久化为列；④部署内存配额重分配。

## D-deploy-001@v1 落选——方案 B（嵌入独立 Docker 容器 + 长轮询 + 索引优化）
状态：rejected
变更：2026-10-16-backend-mem-polling
原编号：D-002@v1
锚点：未记录
最近确认：439cdc46c
理由：落选。sidecar 嵌入容器方案。
否决理由：①小内存机器上模型常驻 200-300M 总常驻反而恶化；②compose 拓扑/镜像/部署脚本全动；③长轮询占连接；④索引优化治标。
复潮条件：服务器升配 ≥4G 且嵌入查询成为高频热路径时重评。

## D-deploy-002@v1 2026-10-09-msys-fonts-guard——两处独立小改：(1) `deploy/scripts/onlyoffice-restore-fonts.sh` 的两行字体解包 `docker exec -i
状态：implemented
变更：2026-10-09-msys-fonts-guard
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-09-msys-fonts-guard/design.md
文件：.claude/skills/sillyhub-docker-deploy/SKILL.md, .codex/skills/sillyhub-docker-deploy/SKILL.md, deploy/scripts/onlyoffice-restore-fonts.sh
最近确认：未记录
理由：两处独立小改：(1) `deploy/scripts/onlyoffice-restore-fonts.sh` 的两行字体解包 `docker exec -i ... tar -C /usr/share/fonts/truetype/...` 补 `MSYS_NO_PATHCONV=1` 前缀——与同文件 mkdir（L41-42）与 fc-cache（L49）既有守卫形态完全一致，作者本知此坑仅这两行漏加（2026-10-09 风险审查实证；9d2702ffe 修 build-and-save.sh 时未覆盖此处）；补一行注释说明动机。(2) `.claude/skills/sillyhub-docker-deploy/SKILL.md` 与 `.codex/` 同名副本整文同步为 `.zcode` 现行版（cp 逐字拷贝）——85c8704a7 镜像瘦身只更新了 .zcode 副本，另两副本仍指导已退役的 claude-data 卷挂载与容器内 `claude --version` 验证（md5 实证漂移，最后改动 2026-08-13）。选整文 cp 而非逐段手改：三副本本就互为镜像，逐字一致可被 diff -q 验证，不引入转录错误。

## D-deploy-003@v1 2026-10-14-litellm-retire——按用户 2026-10-14「彻底退役」拍板，从两个 compose 中整体删除 litellm 技术栈（`litellm` / `litellm-db` 服务
状态：implemented
变更：2026-10-14-litellm-retire
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-14-litellm-retire/design.md
文件：deploy/docker-compose.dev.yml, deploy/docker-compose.yml, deploy/litellm-config.yaml, docs/sillyspec/finished/litellm-v1950-image-entrypoint-not-found.md
最近确认：未记录
理由：按用户 2026-10-14「彻底退役」拍板，从两个 compose 中整体删除 litellm 技术栈（`litellm` / `litellm-db` 服务块、`litellm-db-data` 卷、dev 侧网络附接注释）与唯一专属配置文件 `deploy/litellm-config.yaml`；本机四容器 stop+rm（命名卷数据保留可回滚）；坑记录移 finished/ 闭坑（服务器侧清理并入下次部署窗口，load-and-up.sh 已有 `config --services` 启动集打印，多出/缺少服务立见）。backend 代码面（admin API 注册、provider_config 的 litellm_model_name/litellm_base_url 语义）不动——平台对 openai_like 供应商的转换能力是运行时路径，退役的是基础设施供给，未来若重引转换网关再立新变更。
