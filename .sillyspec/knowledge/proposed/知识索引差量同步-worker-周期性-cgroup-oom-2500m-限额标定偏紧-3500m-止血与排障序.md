---
proposed_at: 2026-11-03T02:04:48.661Z
category: known-issues
source: session-distill:2026-11-03-knowledge-search-hardening
status: pending_review
---

# 知识索引差量同步 worker 周期性 cgroup OOM——2500m 限额标定偏紧，3500m 止血与排障序

## 问题
2026-11-03 生产诊断（宿主 dmesg）：backend mem_limit 2500m 下，嵌入/翻译 worker 子进程周期性被 cgroup OOM kill（10 月 40 次、11-02 2 次），打断知识索引差量同步，搜索侧表现为变慢/降级。这是知识搜索 OOM 谱系新章节：1100m 时代死的是容器内全量嵌入（见 2026-10-15 条目，容器内嵌入已禁、建库走外部预建），本次是差量同步 inline 嵌入在 2500m 下仍被杀（victim oom_score_adj=0、anon-rss 约 2.4G；服务本体约 460M + 嵌入/翻译双 worker 并存峰值超出限额）。

## 解法
mem_limit 2500m 提至 3500m（实测双 worker 峰值约 2.56G 加余量；宿主 7.5G、全栈限额总和约 4.25G 仍充裕）。直接提 4G 方案被否：挤压同宿主 ppdmq 系容器安全边际且无必要证据。排障序：搜索慢/降级 → 宿主 dmesg 查 cgroup OOM（victim 常为模型 worker 子进程）→ knowledge_search_state 核同步时刻（注意 updated_at 假象坑，见配套条目）。架构性根治（把差量嵌入移出请求路径）另立项头脑风暴，复活独立嵌入容器决策前须对照 D-deploy-001@v1 与 D-backend-023/024/021 的否决语境。

## 证据
- 提交 97e84e47c（2026-11-03-knowledge-search-hardening，验证 12.1s 全绿、评审 P1=0）
- deploy/docker-compose.yml backend mem_limit 注释；.zcode/skills/deploy-to-server/SKILL.md 内存与 OOM 排障段（已同步 3500m 口径）
- .sillyspec/changes/archive/2026-11-03-knowledge-search-hardening/design.md

## 适用条件
单机 7.5G 宿主、compose 全栈、单 uvicorn worker 拓扑；扩 workers、加容器或换宿主前重算限额总和与双 worker 峰值。

---
> This is a proposed knowledge entry. Review and merge into manual/ or generated/.