---
author: flow-machine-draft
created_at: 2026-10-20T04:50:02.475Z
---
# 任务注册表（Tasks）— 2026-10-20-codex-models-fetch-candidates

- [ ] task-01: service.py 两处改动（_STRIP_SUFFIXES 追加 /openai/v1；_candidate_urls anthropic 分支尾追 base+/models 去重候选）+ test_fetch_models.py 新增智谱/OpenCode 2 用例（断言候选 URL 序列）——验证：uv run pytest tests/…/test_fetch_models.py 全绿
- [ ] task-02: llm_provider 模块测试全集回归（test_fetch_models/test_llm_provider/test_api_format 等）——验证：模块套件全绿、既有用例零断言改动
- [ ] task-03: 部署腾讯云生产（main 打包 + scp + load-and-up，health 核对 commit_sha）并在平台对「智谱 GLM Codex (wp)」「OpenCode Go Codex」实测 fetch-models 拉到列表
