
## ql-20260818-005-7561 | 2026-08-18 08:54:54 | 存量模块卡片标题补中文名收官——multi-agent-platform 项目 11 张补齐，frontend/daemon 由并行会话同期完成，全仓 211 张核验全过
状态：已完成
关联变更：（无；生成端根修见 sillyspec 仓 ql-20260818-005-a999——scan/archive 模板标题格式修复）
文件：
- .sillyspec/docs/multi-agent-platform/modules/backend.md（# 后端服务（backend））
- .sillyspec/docs/multi-agent-platform/modules/build.md（# 构建与任务编排（build））
- .sillyspec/docs/multi-agent-platform/modules/ci.md（# 持续集成（ci））
- .sillyspec/docs/multi-agent-platform/modules/deploy.md（# 部署编排（deploy））
- .sillyspec/docs/multi-agent-platform/modules/docs.md（# 设计文档库（docs））
- .sillyspec/docs/multi-agent-platform/modules/frontend.md（# 前端控制台（frontend））
- .sillyspec/docs/multi-agent-platform/modules/prototype.md（# 交互线框原型（prototype））
- .sillyspec/docs/multi-agent-platform/modules/scripts.md（# 运维校验脚本（scripts））
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（# 本地守护进程（sillyhub-daemon））
- .sillyspec/docs/multi-agent-platform/modules/sillyspec.md（# 变更管理规范（sillyspec））
- .sillyspec/docs/multi-agent-platform/modules/spikes.md（# 技术验证（spikes））
需求：工具扫描生成的模块卡片缺少中文标题信息，平台文档列表一墙英文代号；对齐 # 中文名（module-id）平台约定
根因：sillyspec scan 子代理模板硬编码 # <module-id>（生成端已在 sillyspec 仓修复 ql-20260818-005-a999）；存量 94 张英文标题卡片中 frontend 86 张与 sillyhub-daemon 46 张由并行会话同期完成，multi-agent-platform 11 张由本会话子代理补齐
方案：11 张卡片各改标题一行（中文名从「## 定位」段职责提炼），git diff 每文件恰一行，已 add 并入暂存与并行会话的大变更集统一提交（避免拆分提交回滚标题行）
结果：全仓 211 张模块卡片独立脚本核验全部通过（中文名+括号 module-id+frontmatter module_id 三重匹配 0 bad）；纯 doc 改动未触及 src/test，npm test 按 CLAUDE.md 规则 8 跳过
