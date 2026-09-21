"""Pydantic DTOs for the scan docs API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ScanDocRead(BaseModel):
    """Single scan document returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    doc_type: str
    path: str
    title: str | None = None
    exists: bool = True
    content: str | None = None
    last_modified_at: datetime | None = None
    # 来源跟踪（model 已有列，from_attributes 自动映射）。
    source_member_id: uuid.UUID | None = None
    source_synced_at: datetime | None = None
    source_mtime: datetime | None = None
    content_hash: str | None = None
    # 该路径历史冲突条数（router/service 注入，非 model 列）。
    conflict_count: int = 0


class ScanDocSummary(BaseModel):
    """Lightweight entry for list views (no content)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    doc_type: str
    path: str
    title: str | None = None
    exists: bool = True
    last_modified_at: datetime | None = None
    # 来源跟踪（model 已有列，from_attributes 自动映射）。
    source_member_id: uuid.UUID | None = None
    source_synced_at: datetime | None = None
    source_mtime: datetime | None = None
    content_hash: str | None = None
    # 该路径历史冲突条数（router/service 注入，非 model 列）。
    conflict_count: int = 0


class ScanDocList(BaseModel):
    items: list[ScanDocSummary]
    total: int


class ScanDocWarning(BaseModel):
    code: str
    detail: str
    component_key: str | None = None
    doc_type: str | None = None


class ScanDocReparseStats(BaseModel):
    parsed: int = 0
    created: int = 0
    updated: int = 0
    deleted: int = 0


class ScanDocReparseResponse(BaseModel):
    """Outcome of ``POST /scan-docs/reparse``."""

    workspace_id: uuid.UUID
    stats: ScanDocReparseStats
    warnings: list[ScanDocWarning] = Field(default_factory=list)


class ScanDocConflictRead(BaseModel):
    """单条扫描文档路径的历史冲突归档记录（D-001@V1 last-write-wins 覆盖快照）。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    old_content: str | None = None
    old_source_member_id: uuid.UUID | None = None
    old_source_runtime_id: uuid.UUID | None = None
    old_mtime: datetime | None = None
    new_source_member_id: uuid.UUID | None = None
    new_mtime: datetime | None = None
    created_at: datetime


# ── stats 运营指标 DTO 族（2026-09-21-scan-docs-ops-panel task-01）──────────
#
# 命名统一 ScanDocs 前缀：CoverageOut/DensityOut/FreshnessOut 与
# knowledge/schema.py 已有类同名，跨模块同名在 OpenAPI 共享文档会产生
# CoverageOut1 式去重后缀污染 gen:types 生成类型（design Grill 项4）。


class ScanDocsTrendPoint(BaseModel):
    """覆盖率卡内趋势的单周桶。"""

    week: str  # 周一日期 ISO（"2026-09-15"）
    updated: int  # 该周桶内更新文档数


class ScanDocsCoverageOut(BaseModel):
    """覆盖率两级口径：七件套 + 模块文档（综合百分比由前端用分子分母计算）。"""

    std_have: int  # 七件套实有（Σ 各项目 scan/ 标准类型去重）
    std_expected: int  # 项目数 × 7
    module_have: int  # modules/ 实有 .md（排除 _module-map.yaml）
    module_expected: int  # Σ 登记模块数（无 map 项目退化为实有，不虚摊）
    trend: list[ScanDocsTrendPoint]  # 近 8 周


class ScanDocsStaleDocOut(BaseModel):
    """陈旧清单单行（last_modified_at 为空 = 未知时间）。"""

    path: str
    doc_type: str
    last_modified_at: datetime | None = None


class ScanDocsDensityOut(BaseModel):
    per_project_avg: float  # total ÷ max(项目数, 1)


class ScanDocsFreshnessOut(BaseModel):
    recent_updated: int  # last_modified_at ≥ now-30d
    total: int


class ScanDocsRecentBoardItem(BaseModel):
    path: str
    doc_type: str
    last_modified_at: datetime


class ScanDocsInjectionBoardItem(BaseModel):
    path: str  # 剥前缀后的 docs 路径（与树/卡片锚点同口径）
    hits_30d: int  # 近 30 天被注入次数


class ScanDocsInjectionOut(BaseModel):
    """CLI 模块上下文注入频次（docs-inject 遥测行聚合，D-003@v1）。"""

    total_30d: int  # docs-inject 行数（近 30 天）
    docs_hit_30d: int  # 被注入文档去重数
    board: list[ScanDocsInjectionBoardItem]  # 按次数降序 Top 10


class ScanDocsStatsOut(BaseModel):
    coverage: ScanDocsCoverageOut
    stale_docs: list[ScanDocsStaleDocOut]  # 最旧在前，上限 200
    density: ScanDocsDensityOut
    freshness: ScanDocsFreshnessOut
    recent_board: list[ScanDocsRecentBoardItem]  # last_modified_at 降序 Top 10
    injection: ScanDocsInjectionOut  # 旧 CLI 无遥测 → 全零值，前端空态
