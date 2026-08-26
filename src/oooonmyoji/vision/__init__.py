"""Screenshot processing, template matching, and OCR."""

from .ocr import OcrResult, PaddleOcrEngine, SharedOcrPool, normalize_ocr_result
from .template import TemplateMatch, TemplateMatcher

__all__ = [
    "OcrResult",
    "PaddleOcrEngine",
    "SharedOcrPool",
    "TemplateMatch",
    "TemplateMatcher",
    "normalize_ocr_result",
]
