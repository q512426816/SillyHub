"""deploy_records — 部署发布记录只读模块。

change 2026-10-14-deploy-release-notes（D-004@v1）：部署留痕的持久层不是
数据库表，而是各 workspace 仓库内的 ``docs/releases/*.md`` 文件（agent 部署
时经 sillyhub-docker-deploy skill 写入）。本模块只读扫描 + 解析 frontmatter
聚合展示，零表、零写端点、零缓存。
"""
