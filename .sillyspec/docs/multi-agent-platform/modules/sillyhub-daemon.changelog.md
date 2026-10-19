# sillyhub-daemon 变更索引
- change 2026-10-15-platform-knowledge-search | api-types.ts 再生成（gen:types 双端义务，规则 21）：新增 KnowledgeSearchIn/KnowledgeSearchResultItem/KnowledgeSearchOut 三 schema 与 /knowledge/search 路径面，纯新增零改写；daemon 运行时代码零改动。
- 2026-10-16-driver-audit-fixes | 24h 只读风险审查发现 zcode 驱动三处缺陷（轮次进行中 close 令 consume 永久…
- 2026-10-16-session-run-status-realtime | 会话列表行首状态目前只靠 daemon 10 秒日志推导活性链（基线），用户触发会话后转圈/完成提示…
- 2026-10-16-provider-switch-transcript-sanitize | 切供应商时清洗历史里不可重放的供应商私有工具块
- 2026-10-19-host-settings-live-reload | 本机默认会话自动跟随宿主机档位切换
- 2026-10-19-host-settings-reload-latency | 宿主机档位热跟随提速与部署技能文档修正
