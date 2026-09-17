"""Built-in actions exposed to JSON workflows. 按职责拆分为子模块后在本入口聚合导出。"""

from __future__ import annotations

from .basic import CaptureAction, SaveFrameAction, SleepAction, LogAction, AssertAction
from .vision import MatchTemplateAction, OcrAction, WaitTemplateAction, WaitAnyAction
from .detection import DetectStateAction
from .input import TapAction, SwipeAction, KeyAction, TypeTextAction
from .stateflow import TapMatchAction, DismissTemplateUntilTextAction, RecoverStateAction
from .subworkflow import RunWorkflowAction, SelectWorkflowAction, SequenceWorkflowAction
from .text_wait import WaitTextAction, WaitAnyTextAction

__all__ = [
    "AssertAction",
    "CaptureAction",
    "DetectStateAction",
    "DismissTemplateUntilTextAction",
    "KeyAction",
    "LogAction",
    "MatchTemplateAction",
    "OcrAction",
    "RecoverStateAction",
    "RunWorkflowAction",
    "SaveFrameAction",
    "SelectWorkflowAction",
    "SequenceWorkflowAction",
    "SleepAction",
    "SwipeAction",
    "TapAction",
    "TapMatchAction",
    "TypeTextAction",
    "WaitAnyAction",
    "WaitAnyTextAction",
    "WaitTemplateAction",
    "WaitTextAction",
]
