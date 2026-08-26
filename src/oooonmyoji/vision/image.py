"""Frame conversion helpers used by OpenCV and OCR."""

from __future__ import annotations

from pathlib import Path

from ..devices.protocol import DeviceFrame, frame_from_backend
from ..exceptions import VisionError


def frame_to_bgr(frame: object):
    """Convert a backend frame to a visible-orientation BGR ndarray."""

    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise VisionError("OpenCV and numpy are required for visual recognition") from exc
    value = frame_from_backend(frame)
    if value.format == "png":
        if not isinstance(value.pixels, (bytes, bytearray, memoryview)):
            raise VisionError("PNG frame payload is not a byte buffer")
        encoded = np.frombuffer(value.pixels, dtype=np.uint8)
        image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if image is None:
            raise VisionError("unable to decode PNG frame")
        return image
    if isinstance(value.pixels, np.ndarray):
        array = value.pixels
        if array.ndim == 3 and array.shape[2] == 4:
            conversion = cv2.COLOR_RGBA2BGR if value.format == "rgba" else cv2.COLOR_BGRA2BGR
            image = cv2.cvtColor(array, conversion)
        elif array.ndim == 3 and array.shape[2] == 3:
            image = array
        else:
            raise VisionError(f"unsupported pixel array shape: {array.shape}")
    else:
        if not isinstance(value.pixels, (bytes, bytearray, memoryview)):
            raise VisionError("frame pixels are not a byte buffer")
        try:
            array = np.frombuffer(value.pixels, dtype=np.uint8)
        except (TypeError, ValueError) as exc:
            raise VisionError("frame pixels are not a byte buffer") from exc
        expected = value.width * value.height * 4
        if array.size != expected:
            raise VisionError(f"raw {value.format} buffer has {array.size} bytes, expected {expected}")
        conversion = cv2.COLOR_RGBA2BGR if value.format == "rgba" else cv2.COLOR_BGRA2BGR
        image = cv2.cvtColor(array.reshape(value.height, value.width, 4), conversion)
        image = np.flipud(image)
    return image


def crop_frame(frame: object, roi: tuple[int, int, int, int] | None = None):
    image = frame_to_bgr(frame)
    if roi is None:
        return image
    x, y, width, height = roi
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > image.shape[1] or y + height > image.shape[0]:
        raise VisionError(f"ROI is outside frame: {roi}")
    return image[y : y + height, x : x + width]


def write_frame(path: Path | str, frame: object) -> Path:
    """Persist either the original PNG payload or a BGR image."""

    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    value = frame_from_backend(frame)
    if value.format == "png":
        if not isinstance(value.pixels, (bytes, bytearray, memoryview)):
            raise VisionError("PNG frame payload is not a byte buffer")
        destination.write_bytes(bytes(value.pixels))
        return destination
    if value.format == "bgra" and isinstance(value.pixels, (bytes, bytearray, memoryview)):
        # Preserve the zero-copy native buffer path and avoid OpenCV rejecting
        # the vertically flipped, negative-stride view on Windows.
        from ..devices.mumu import write_bgra_png

        write_bgra_png(destination, value.width, value.height, value.pixels)
        return destination
    try:
        import cv2
    except ImportError:
        from ..devices.mumu import write_bgra_png

        write_bgra_png(destination, value.width, value.height, value.pixels)
        return destination
    # flipud() in frame_to_bgr returns a negative-stride view; make it
    # contiguous before passing it to OpenCV's encoder. Writing the encoded
    # bytes with pathlib keeps non-ASCII Windows paths working reliably.
    extension = destination.suffix.lower() or ".png"
    try:
        encoded, payload = cv2.imencode(extension, frame_to_bgr(value).copy())
    except cv2.error as exc:
        raise VisionError(f"unable to encode frame: {destination}") from exc
    if not encoded:
        raise VisionError(f"unable to encode frame: {destination}")
    try:
        destination.write_bytes(payload.tobytes())
    except OSError as exc:
        raise VisionError(f"unable to write frame: {destination}") from exc
    return destination


__all__ = ["crop_frame", "frame_to_bgr", "write_frame"]
