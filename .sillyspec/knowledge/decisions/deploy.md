# 决策知识 — deploy

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-05-litellm-crashloop-quarantine
锚点：未记录
最近确认：0d419ddad3523713b28806579fb28b198ae920dc
理由：最大风险=恢复路径被遗忘：2026-10-05 本地矩阵已证伪「选新 tag」路线（无可 pin 的 「健康镜像 + gap-A」组合），分叉（①等上游修复版 / ②自研薄适配层退役 litellm）拍板后 的专门变更若漏处理两处 profiles 行——分叉①下 litellm 不随默认栈拉起，表象是 OpenAI 型 供应商经 litellm 的链路静默缺失（该链路当前尚未启用，短期无感，正因此更易被遗忘）。 缓解：compose 两处注释与坑文档 2026-10-05 隔离加固段三处互指「恢复/退役=专门变更处理 profiles 行」，且坑文档保持 docs/sillyspec/ 活跃区跟踪至分叉拍板与移除闭环。 试过但放弃的方案：① 注释掉整个服务块——配置失去可见性、恢复 diff 噪音大；② `restart: no` ——`up -d` 仍会拉起坏镜像执行一次 127 崩溃（低配机白拉镜像层），且违背 NFR-03 的 always 语义、恢复时易忘改回；③ 依赖「服务器已手动 stop + 注释提醒」——已被 2026-10-04 实践证伪： stop 状态挡不住下一次 `up -d`（这正是本变更的动因）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-06-litellm-log-rotation
锚点：未记录
最近确认：6a3bd3113b5d405935f3b2de2a54e8c30c9815ba
理由：最大风险：轮转上限过小导致 crash-loop 排障时关键 traceback 被截丢——取 10m×3=30m 兼顾低配磁盘与排障留存（该服务已设 PYTHONUNBUFFERED=1，崩溃 traceback 即时 flush，单份 10m 足够装下完整崩溃记录）。试过但放弃的方案：①宿主 daemon.json 全局默认轮转——动服务器系统状态、影响所有容器，超出本仓变更面；②全服务统一 logging——核心服务日志保留策略变化未评估，扩大行为面，留待专门变更。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-msys-fonts-guard
锚点：未记录
最近确认：f8f068a1fa86fad636f25df52ea68838e7b1c73b
理由：最大风险：无自动化测试钉住脚本行为（运维脚本无测试面），守卫正确性靠 bash -n + 与同文件既有守卫形态的目视一致性；真实解包验证留待下次字体恢复实操（容器重建后场景）。文档整文拷贝的风险是若 .zcode 版自身有误则三副本同错——但 .zcode 版是 85c8704a7 变更同步过的现行真相，方向上优于两份 2026-08-13 旧版。试过放弃：(a) 在脚本头部统一 export MSYS_NO_PATHCONV=1——放弃，作用域大于必要（会影响脚本内一切命令的路径转换，包括可能的宿主路径场景），同文件既有惯例是逐命令前缀；(b) 只更新漂移段落——放弃，逐段手改引入转录风险且不可 diff -q 验证。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-litellm-retire
锚点：未记录
最近确认：ab87d6adbc3a0509d743970552e97813f0f7881c
理由：最大风险：未来新增 openai_like 供应商（无原生 anthropic 端点的上游）时转换链路缺失——当前零供应商依赖 litellm，且重引路径已文档化（本坑记录 + spike-litellm-routing 历史可考古）；接受。次风险：本机 plain v1.95.0 healthy 3 天提示上游构建可能已修复，退役放弃了「零成本复测复活」机会——拍板时已向用户披露并选择退役（不再等上游）。死路：尝试「只删 prod 留 dev」——两处定义漂移正是 10-06 compose 同步教训的反面，不留双态。

## D-backend-019@v1 部署变更 = 镜像换 pgvector/pgvector:pg16 + 迁移内装扩展；升级步骤单列
状态：implemented
变更：2026-10-15-knowledge-search-pgvector
原编号：D-008@v1
锚点：未记录
最近确认：898bb901c
理由：①docker-compose 的 postgres 镜像 postgres:16-alpine → pgvector/pgvector:pg16（数据卷不丢，官方同源镜像+vector 扩展）；②扩展安装放 alembic 迁移内（CREATE EXTENSION IF NOT EXISTS vector + 方言守卫——pgcrypto/pg_trgm 同款）；③升级顺序：换镜像重启 PG → 跑迁移 → 重启 backend；④升级前生产库跑验证 SQL（SELECT name FROM pg_available_extensions WHERE name='vector'）确认扩展可用（用户可能手动装过——核实过代码无痕迹，但手工操作查不到）。dev compose 同步换。
故障面：迁移先于镜像替换执行 → 方言守卫内检查 extension 可用性，缺失时报错中止（信息含修复指引），不留半态表。
退役判据：无。
