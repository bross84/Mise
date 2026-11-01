import io

import pytesseract
from PIL import Image, ImageOps, ImageStat, UnidentifiedImageError

MAX_IMAGE_BYTES = 20 * 1024 * 1024  # phone photos run well past the 10 MB image-upload cap
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}
MIN_WIDTH_PX = 1200  # Tesseract reads small screenshot text poorly, so small images are enlarged
MAX_SIDE_PX = 4000  # and very large ones shrunk, to keep a read to a few seconds
DARK_MEAN_THRESHOLD = 110  # below this the picture is light text on a dark background
OCR_TIMEOUT_S = 60


class UnsupportedImageError(ValueError):
    """The upload isn't a PNG, JPEG or WebP image Pillow can open."""


class OcrUnavailableError(RuntimeError):
    """The Tesseract binary isn't installed where the backend runs."""


class OcrFailedError(RuntimeError):
    """Tesseract started but failed or timed out."""


def prepare_image(data: bytes) -> Image.Image:
    """Decode an upload into the grayscale, upright, sensibly sized image Tesseract reads best."""
    try:
        image = Image.open(io.BytesIO(data))
        if image.format not in ALLOWED_FORMATS:
            raise UnsupportedImageError("Unsupported image type. Use a PNG, JPEG or WebP image.")
        image = ImageOps.exif_transpose(image).convert("L")
    except UnsupportedImageError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
        raise UnsupportedImageError("That file isn't a readable PNG, JPEG or WebP image.") from error

    if ImageStat.Stat(image).mean[0] < DARK_MEAN_THRESHOLD:
        image = ImageOps.invert(image)

    scale = 1.0
    if image.width < MIN_WIDTH_PX:
        scale = MIN_WIDTH_PX / image.width
    elif max(image.size) > MAX_SIDE_PX:
        scale = MAX_SIDE_PX / max(image.size)
    if scale != 1.0:
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    return image


def extract_text(data: bytes) -> str:
    """Run OCR over an uploaded image and return the text as read (blocking; call off the event loop)."""
    image = prepare_image(data)
    try:
        return pytesseract.image_to_string(image, timeout=OCR_TIMEOUT_S)
    except pytesseract.TesseractNotFoundError as error:
        raise OcrUnavailableError(
            "Tesseract OCR isn't installed on the server, so images can't be read. Paste the recipe text instead."
        ) from error
    except RuntimeError as error:  # TesseractError, or pytesseract's timeout
        raise OcrFailedError(f"Tesseract could not read that image: {error}") from error
