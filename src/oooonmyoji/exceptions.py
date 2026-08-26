"""Shared exception types and error classification."""

from __future__ import annotations

from enum import StrEnum


class ErrorCategory(StrEnum):
    CONFIG = "config"
    PLUGIN = "plugin"
    WORKFLOW = "workflow"
    ACTION = "action"
    DEVICE_CONNECTION = "device_connection"
    DEVICE_CAPTURE = "device_capture"
    DEVICE_INPUT = "device_input"
    OCR = "ocr"
    VISION = "vision"
    CANCELLED = "cancelled"
    INTERNAL = "internal"
    WORKFLOW_TIMEOUT = "workflow_timeout"
    ACTION_TIMEOUT = "action_timeout"


class AutomationError(RuntimeError):
    """Base error carrying a stable category for structured logs."""

    category = ErrorCategory.INTERNAL

    def __init__(self, message: str, *, cause: BaseException | None = None) -> None:
        super().__init__(message)
        self.cause = cause


class ConfigError(AutomationError):
    category = ErrorCategory.CONFIG


class PluginError(AutomationError):
    category = ErrorCategory.PLUGIN


class WorkflowError(AutomationError):
    category = ErrorCategory.WORKFLOW


class WorkflowTimeoutError(WorkflowError):
    category = ErrorCategory.WORKFLOW_TIMEOUT


class ActionTimeoutError(WorkflowError):
    category = ErrorCategory.ACTION_TIMEOUT


class ActionError(AutomationError):
    category = ErrorCategory.ACTION


class DeviceError(AutomationError):
    category = ErrorCategory.DEVICE_CONNECTION


class DeviceConnectionError(DeviceError):
    category = ErrorCategory.DEVICE_CONNECTION


class DeviceCaptureError(DeviceError):
    category = ErrorCategory.DEVICE_CAPTURE


class DeviceInputError(DeviceError):
    category = ErrorCategory.DEVICE_INPUT


class VisionError(AutomationError):
    category = ErrorCategory.VISION


class OcrError(AutomationError):
    category = ErrorCategory.OCR


class CancelledError(AutomationError):
    category = ErrorCategory.CANCELLED


__all__ = [
    "AutomationError",
    "ActionError",
    "ActionTimeoutError",
    "CancelledError",
    "ConfigError",
    "DeviceCaptureError",
    "DeviceConnectionError",
    "DeviceError",
    "DeviceInputError",
    "ErrorCategory",
    "OcrError",
    "PluginError",
    "WorkflowError",
    "WorkflowTimeoutError",
    "VisionError",
]
