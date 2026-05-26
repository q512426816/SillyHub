"""OpenTelemetry bootstrap.

V1 ships an intentionally minimal no-op wiring so feature code can already call
``init_telemetry()`` without having to depend on the OTEL SDK. Real exporter
configuration lands in V2 once the platform itself owns the collector.
"""

from __future__ import annotations

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger(__name__)


def init_telemetry(settings: Settings) -> None:
    """Initialise tracing/metrics if an OTEL endpoint is configured."""
    if not settings.otel_endpoint:
        log.debug("telemetry.disabled", reason="no OTEL_ENDPOINT")
        return
    log.info("telemetry.init", endpoint=settings.otel_endpoint, status="stub")
