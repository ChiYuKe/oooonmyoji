"""Device backends and input transport."""

from .adb import AdbDevice
from .coordinates import CoordinateMapper, Rect
from .factory import connect_at_task_boundary, create_backend, resolve_adb_path
from .lock import InstanceLock, InstanceLockError
from .mumu import MumuDevice
from .protocol import DeviceBackend, DeviceFrame, frame_from_backend

__all__ = [
    "AdbDevice",
    "connect_at_task_boundary",
    "CoordinateMapper",
    "DeviceBackend",
    "DeviceFrame",
    "InstanceLock",
    "InstanceLockError",
    "MumuDevice",
    "Rect",
    "create_backend",
    "resolve_adb_path",
    "frame_from_backend",
]
