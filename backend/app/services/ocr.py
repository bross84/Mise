import io

import pytesseract
from PIL import Image, ImageOps, ImageStat, UnidentifiedImageError

MAX_IMAGE_BYTES = 20 * 1024 * 1024  # phone photos run well past the 10 MB image-upload cap
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}
MIN_WIDTH_PX = 1200  # Tesseract reads small screenshot text poorly, so small images are enlarged
MAX_SIDE_PX = 4000  # and very large ones shrunk, to keep a read to a few seconds
DARK_MEAN_THRESHOLD = 110  # below this the picture is light text on a dark background
OCR_TIMEOUT_S = 60

# Page layout. Distances are in text-line heights so they hold for any screenshot scale.
INK_THRESHOLD = 140  # grayscale level below which a pixel counts as text
BLANK_MAX = 2  # a row/column inked less than ~1% is blank (tolerates JPEG noise)
MAX_LINE_FRACTION = 0.08  # ink rows taller than this share of the page are photos, not text lines
GUTTER_LINES = 0.8  # a column gutter is at least this wide; word spaces are about 0.3
MIN_COLUMN_LINES = 4  # a block shorter than this many lines can't be a column
MIN_COLUMN_WIDTH_LINES = 3  # nor can anything narrower than this many line heights
PARAGRAPH_GAP_LINES = 0.6  # blank rows at least this tall separate stacked bands
MIN_REGION_LINES = 2
PHOTO_INK_FRACTION = 0.30  # text covers well under this share of its block; photos far more
REGION_PAD_PX = 20  # Tesseract reads a block better with a margin around it


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


Box = tuple[int, int, int, int]  # left, top, right, bottom


def _ink(image: Image.Image) -> Image.Image:
    """Black-and-white copy where text (and any other dark mark) is 255."""
    return image.point([255 if level < INK_THRESHOLD else 0 for level in range(256)])


def _profile(ink: Image.Image, box: Box, *, columns: bool) -> bytes:
    """How inked each column (or row) of the box is, 0-255."""
    left, top, right, bottom = box
    size = (right - left, 1) if columns else (1, bottom - top)
    return ink.crop(box).resize(size, Image.BOX).tobytes()


def _spans(profile: bytes, *, min_gap: int) -> list[tuple[int, int]]:
    """Runs of content, where only a blank stretch of at least min_gap ends a run."""
    spans: list[tuple[int, int]] = []
    start = last = None
    for index, value in enumerate(profile):
        if value <= BLANK_MAX:
            continue
        if start is None:
            start = index
        elif index - last - 1 >= min_gap:
            spans.append((start, last + 1))
            start = index
        last = index
    if start is not None:
        spans.append((start, last + 1))
    return spans


def _line_height(ink: Image.Image) -> int:
    """Typical text-line height in pixels, from the page's rows. 0 when the page has no text-like rows."""
    width, height = ink.size
    runs = [end - start for start, end in _spans(_profile(ink, (0, 0, width, height), columns=False), min_gap=1)]
    lines = sorted(run for run in runs if run <= height * MAX_LINE_FRACTION)
    return lines[len(lines) // 2] if lines else 0


def _split_columns(ink: Image.Image, box: Box, line_h: int) -> list[Box]:
    left, top, right, bottom = box
    rows = _spans(_profile(ink, box, columns=False), min_gap=bottom - top)
    if not rows or rows[0][1] - rows[0][0] < MIN_COLUMN_LINES * line_h:
        return [box]  # judged on the text itself, not the blank page around it
    spans = _spans(_profile(ink, box, columns=True), min_gap=max(int(GUTTER_LINES * line_h), 4))
    merged: list[tuple[int, int]] = []
    for span in spans:
        narrow = min(span[1] - span[0], merged[-1][1] - merged[-1][0]) < MIN_COLUMN_WIDTH_LINES * line_h if merged else False
        if narrow:  # a stray bullet or icon column isn't a column of text
            merged[-1] = (merged[-1][0], span[1])
        else:
            merged.append(span)
    if len(merged) < 2:
        return [box]
    return [(left + start, top, left + end, bottom) for start, end in merged]


def _split_rows(ink: Image.Image, box: Box, line_h: int) -> list[Box]:
    left, top, right, bottom = box
    spans = _spans(_profile(ink, box, columns=False), min_gap=max(int(PARAGRAPH_GAP_LINES * line_h), 4))
    if len(spans) < 2:
        return [box]
    return [(left, top + start, right, top + end) for start, end in spans]


def _layout(ink: Image.Image, box: Box, line_h: int) -> list[Box]:
    """Recursive XY-cut: side-by-side columns first, else stacked bands, and recurse into each.

    A heading or full-width block crossing a gutter hides it at the top level, so columns are only
    found once the bands around that block have been cut away. Consecutive bands with no columns
    inside are put back together, so a plain page of paragraphs stays one block.
    """
    columns = _split_columns(ink, box, line_h)
    if len(columns) > 1:
        return [leaf for column in columns for leaf in _layout(ink, column, line_h)]

    bands = _split_rows(ink, box, line_h)
    if len(bands) == 1:
        return [box]
    groups: list[list[Box]] = []
    for band in bands:
        leaves = _layout(ink, band, line_h)
        if len(leaves) == 1 and groups and len(groups[-1]) == 1:
            before = groups[-1][0]
            groups[-1] = [(min(before[0], band[0]), before[1], max(before[2], band[2]), band[3])]
        else:
            groups.append(leaves)
    return [leaf for group in groups for leaf in group]


def find_regions(image: Image.Image) -> list[Box]:
    """Blocks of the page in reading order: each column on its own, photos and all."""
    whole = (0, 0, image.width, image.height)
    ink = _ink(image)
    line_h = _line_height(ink)
    return _layout(ink, whole, line_h) if line_h else [whole]


def _read(image: Image.Image) -> str:
    return pytesseract.image_to_string(image, timeout=OCR_TIMEOUT_S)


def _read_regions(image: Image.Image, boxes: list[Box]) -> str:
    line_h = _line_height(_ink(image))
    texts = []
    for box in boxes:
        crop = image.crop(box)
        if min(crop.size) < MIN_REGION_LINES * line_h:
            continue  # an icon or stray mark, not text
        if ImageStat.Stat(_ink(crop)).mean[0] / 255 > PHOTO_INK_FRACTION:
            continue  # a photo: Tesseract would invent text from it
        text = _read(ImageOps.expand(crop, border=REGION_PAD_PX, fill=255)).strip()
        if text:
            texts.append(text)
    return "\n\n".join(texts)


def extract_text(data: bytes) -> str:
    """Run OCR over an uploaded image and return the text as read (blocking; call off the event loop).

    Tesseract's own layout analysis merges columns that sit close together, interleaving their lines,
    so a multi-column page is cut into blocks here and each block is read by itself.
    """
    image = prepare_image(data)
    try:
        boxes = find_regions(image)
        text = _read_regions(image, boxes) if len(boxes) > 1 else ""
        return text or _read(image)
    except pytesseract.TesseractNotFoundError as error:
        raise OcrUnavailableError(
            "Tesseract OCR isn't installed on the server, so images can't be read. Paste the recipe text instead."
        ) from error
    except RuntimeError as error:  # TesseractError, or pytesseract's timeout
        raise OcrFailedError(f"Tesseract could not read that image: {error}") from error
