"""Выбор анализатора кадров по настройкам."""

from functools import lru_cache

from app.config import get_settings
from app.services.analysis.base import AnalysisError, AnalysisProvider, AnalysisResult, DetectedObject
from app.services.analysis.http import HttpAnalyzer
from app.services.analysis.mock import MockAnalyzer

__all__ = ["AnalysisError", "AnalysisProvider", "AnalysisResult", "DetectedObject", "get_analyzer", "get_mock"]


@lru_cache
def get_mock() -> MockAnalyzer:
    return MockAnalyzer()


@lru_cache
def get_analyzer() -> AnalysisProvider:
    settings = get_settings()
    if settings.analysis_provider == "http":
        if not settings.analysis_api_url:
            raise RuntimeError("SK_ANALYSIS_PROVIDER=http требует SK_ANALYSIS_API_URL")
        return HttpAnalyzer(settings.analysis_api_url, settings.analysis_api_key, settings.analysis_timeout_s)
    return get_mock()
