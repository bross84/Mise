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
MIN_REGION_LINES = 2
BACKGROUND_TOLERANCE = 24  # grayscale distance from the page background that counts as "something is here"
PHOTO_DENSITY = 0.8  # a cell this full of non-background pixels is solid; thin text strokes never are
PHOTO_FILL = 0.5  # and a photo is a blob that fills at least this much of its bounding box
MIN_PHOTO_LINES = 4  # at least this many line heights across, so a bold heading isn't taken for one
PHOTO_MAX_PAGE_FRACTION = 0.6  # a "photo" covering most of the page is a tinted background
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


def _gaps(profile: bytes, min_width: int) -> list[tuple[int, int]]:
    """Runs of blank columns at least min_width wide, margins included."""
    gaps: list[tuple[int, int]] = []
    start = None
    for index, value in enumerate(profile):
        if value <= BLANK_MAX:
            if start is None:
                start = index
        elif start is not None:
            if index - start >= min_width:
                gaps.append((start, index))
            start = None
    if start is not None and len(profile) - start >= min_width:
        gaps.append((start, len(profile)))
    return gaps


def _column_zones(ink: Image.Image, box: Box, line_h: int) -> list[tuple[int, int]]:
    """Row ranges where one gutter lines up across at least MIN_COLUMN_LINES consecutive text lines.

    Lines are checked one at a time, so a heading or full-width paragraph that crosses the gutter
    only ends the range instead of hiding the gutter from the whole page. Photos have been whited out
    by then, so a gap beside a photo has no text on its other side and never counts as a gutter.
    """
    left, top, right, bottom = box
    min_gutter = max(int(GUTTER_LINES * line_h), 4)
    lines = _spans(_profile(ink, box, columns=False), min_gap=1)
    zones: list[tuple[int, int]] = []

    def close(first: int, last: int, gutter: tuple[int, int]) -> None:
        if last - first + 1 < MIN_COLUMN_LINES:
            return
        rows = (lines[first][0], lines[last][1])
        columns = _profile(ink, (left, top + rows[0], right, top + rows[1]), columns=True)
        text_before = any(value > BLANK_MAX for value in columns[: gutter[0]])
        text_after = any(value > BLANK_MAX for value in columns[gutter[1]:])
        if text_before and text_after:
            zones.append(rows)

    tracks: list[tuple[int, tuple[int, int]]] = []  # (first line, gutter narrowed so far)
    for index, (start, end) in enumerate(lines):
        gaps = _gaps(_profile(ink, (left, top + start, right, top + end), columns=True), min_gutter)
        kept: list[tuple[int, tuple[int, int]]] = []
        for first, (g_start, g_end) in tracks:
            overlaps = [(max(g_start, a), min(g_end, b)) for a, b in gaps]
            overlaps = [(a, b) for a, b in overlaps if b - a >= min_gutter]
            if overlaps:
                kept.append((first, max(overlaps, key=lambda span: span[1] - span[0])))
            else:
                close(first, index - 1, (g_start, g_end))
        for a, b in gaps:
            if not any(min(b, k_end) - max(a, k_start) >= min_gutter for _, (k_start, k_end) in kept):
                kept.append((index, (a, b)))
        tracks = kept
    for first, gutter in tracks:
        close(first, len(lines) - 1, gutter)

    return sorted(set(zones))


def _layout(ink: Image.Image, box: Box, line_h: int) -> list[Box]:
    """Blocks in reading order: each multi-column stretch as its columns, the rest full width."""
    left, top, right, bottom = box
    # Gutters can be found twice or falsely (a speck beside a photo, a gap that happens to line up).
    # Take the tallest stretches first and only ones that really split into columns and don't overlap.
    chosen: list[tuple[int, int, list[Box]]] = []
    for zone_top, zone_bottom in sorted(_column_zones(ink, box, line_h), key=lambda zone: zone[0] - zone[1]):
        if any(zone_top < taken_bottom and taken_top < zone_bottom for taken_top, taken_bottom, _ in chosen):
            continue
        columns = _split_columns(ink, (left, top + zone_top, right, top + zone_bottom), line_h)
        if len(columns) > 1:
            chosen.append((zone_top, zone_bottom, columns))

    leaves: list[Box] = []
    cursor = top
    for zone_top, zone_bottom, columns in sorted(chosen):
        leaves.extend(_text_between(ink, left, cursor, right, top + zone_top))
        leaves.extend(columns)
        cursor = top + zone_bottom
    leaves.extend(_text_between(ink, left, cursor, right, bottom))
    return leaves or [box]


def _text_between(ink: Image.Image, left: int, top: int, right: int, bottom: int) -> list[Box]:
    """The full-width block between two column stretches, or nothing if that stretch is blank."""
    if bottom <= top:
        return []
    has_text = any(value > BLANK_MAX for value in _profile(ink, (left, top, right, bottom), columns=False))
    return [(left, top, right, bottom)] if has_text else []


def _photo_boxes(image: Image.Image, line_h: int) -> list[Box]:
    """Large solid blocks that differ from the page background: photos, not text.

    A photo's pixels land on both sides of the text threshold, so left in they smear across the
    gutters next to them and hide the columns. Text never fills a block this solid.
    """
    cell = max(line_h // 2, 4)
    cols, rows = image.width // cell, image.height // cell
    if cols < 2 or rows < 2:
        return []
    histogram = image.histogram()
    background = max(range(256), key=histogram.__getitem__)
    differs = image.point([255 if abs(level - background) > BACKGROUND_TOLERANCE else 0 for level in range(256)])
    grid = differs.resize((cols, rows), Image.BOX).tobytes()
    dense = bytes(1 if value >= 255 * PHOTO_DENSITY else 0 for value in grid)

    seen = bytearray(len(dense))
    boxes: list[Box] = []
    for first in range(len(dense)):
        if not dense[first] or seen[first]:
            continue
        seen[first] = 1
        stack, cells = [first], 0
        left = right = first % cols
        top = bottom = first // cols
        while stack:
            index = stack.pop()
            cells += 1
            x, y = index % cols, index // cols
            left, right, top, bottom = min(left, x), max(right, x), min(top, y), max(bottom, y)
            for near, ok in ((index - 1, x > 0), (index + 1, x < cols - 1), (index - cols, y > 0), (index + cols, y < rows - 1)):
                if ok and dense[near] and not seen[near]:
                    seen[near] = 1
                    stack.append(near)
        width, height = right - left + 1, bottom - top + 1
        big_enough = min(width, height) * cell >= MIN_PHOTO_LINES * line_h
        solid = cells >= PHOTO_FILL * width * height
        page_background = width * height > PHOTO_MAX_PAGE_FRACTION * cols * rows  # a tinted page, not a photo
        if big_enough and solid and not page_background:
            sx, sy = image.width / cols, image.height / rows
            pad = max(line_h // 4, 4)  # resizing leaves a faint halo just outside a photo's edge
            boxes.append((
                max(int(left * sx) - pad, 0), max(int(top * sy) - pad, 0),
                min(int((right + 1) * sx) + pad, image.width), min(int((bottom + 1) * sy) + pad, image.height),
            ))
    return boxes


def layout_page(image: Image.Image) -> tuple[Image.Image, list[Box], int]:
    """The page with its photos whited out, its text blocks in reading order, and its line height."""
    ink = _ink(image)
    line_h = _line_height(ink)
    if not line_h:
        return image, [(0, 0, image.width, image.height)], 0

    photos = _photo_boxes(image, line_h)
    if photos:
        image = image.copy()
        for box in photos:
            image.paste(255, box)
        ink = _ink(image)
        line_h = _line_height(ink) or line_h
    return image, _layout(ink, (0, 0, image.width, image.height), line_h), line_h


def find_regions(image: Image.Image) -> list[Box]:
    """Blocks of the page in reading order: each column on its own, photos left out."""
    return layout_page(image)[1]


def _read(image: Image.Image) -> str:
    return pytesseract.image_to_string(image, timeout=OCR_TIMEOUT_S)


def _read_regions(image: Image.Image, boxes: list[Box], line_h: int) -> str:
    texts = []
    for box in boxes:
        crop = image.crop(box)
        if min(crop.size) < MIN_REGION_LINES * line_h:
            continue  # an icon or stray mark, not text
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
        image, boxes, line_h = layout_page(image)
        text = _read_regions(image, boxes, line_h) if len(boxes) > 1 else ""
        return text or _read(image)
    except pytesseract.TesseractNotFoundError as error:
        raise OcrUnavailableError(
            "Tesseract OCR isn't installed on the server, so images can't be read. Paste the recipe text instead."
        ) from error
    except RuntimeError as error:  # TesseractError, or pytesseract's timeout
        raise OcrFailedError(f"Tesseract could not read that image: {error}") from error
