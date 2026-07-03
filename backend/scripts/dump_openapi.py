"""静态导出 FastAPI OpenAPI schema 到 JSON 文件，供前端类型生成消费。

不启动 uvicorn、不连 DB/Redis —— FastAPI 的 openapi schema 在 app 构建时
生成（lifespan 不跑），因此 dump 是纯函数式、CI 友好、跨平台。

用法（在 backend 目录）::

    uv run python scripts/dump_openapi.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    # dump 是构建期工具，不连 DB / Redis；但 Settings 实例化要求 database_url /
    # secret_key（生产 required 字段）。设 dummy 兜底——dump 不消费这些值，
    # 仅满足 pydantic-settings 校验。
    import os

    os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite://dump-only")
    os.environ.setdefault("SECRET_KEY", "dump-only-not-used")

    # 延迟 import：让脚本 --help 快速返回，且便于在 CLI 里捕获 import 错误。
    from app.main import app

    schema = app.openapi()
    out = Path(__file__).resolve().parent.parent / "openapi.json"
    out.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")

    n_paths = len(schema.get("paths", {}))
    n_schemas = len(schema.get("components", {}).get("schemas", {}))
    print(f"wrote {out} ({n_paths} paths, {n_schemas} schemas)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
