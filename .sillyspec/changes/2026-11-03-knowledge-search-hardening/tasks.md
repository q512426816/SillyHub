---
author: flow-machine-draft
created_at: 2026-11-03T01:27:47.446Z
---
# 任务注册表（Tasks）— 2026-11-03-knowledge-search-hardening

- [x] task-01: deploy/docker-compose.yml backend mem_limit 2500m→3500m 并更新注释记录 2026-11-03 OOM 诊断依据；验证=grep mem_limit 值与其余服务限额未动
- [x] task-02: search.py KnowledgeSearchState.updated_at 补 onupdate（对齐 mcp_registry 先例）；验证=新增 test_state_updated_at_refreshes_after_delta_sync_and_frozen_on_fast_path 绿 + 既有 test_knowledge_search.py 全绿
- [x] task-03: page.tsx 等待文案改「增量同步」口径、降级徽标按 reason=index_not_built 区分提示索引未预建；验证=typecheck + lint 绿 + grep 无「首次搜索需建立索引」残留；不写测试（FR-03 不适用裁决）
- [x] task-04: 文档同步——deploy-to-server SKILL.md 内存段限额数字更新至 3500m 并核对全仓无 2500m 过时表述残留；验证=grep 复核
