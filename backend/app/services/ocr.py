import io
import re

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
GUTTER_LINES = 0.8  # a column gutter is at least this many line heights wide...
GUTTER_WORD_SPACES = 3  # ...and at least this many of the page's own word spaces
MIN_COLUMN_LINES = 4  # a block shorter than this many lines can't be a column
MIN_COLUMN_WIDTH_LINES = 3  # nor can anything narrower than this many line heights
HEADING_RATIO = 1.8  # a line taller than this many typical lines is a heading, not column text
MAX_COLUMN_GAP = 4  # column text more than this many line heights below the columns has ended
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


def _text_lines(ink: Image.Image, box: Box, line_h: int) -> tuple[list[tuple[int, int]], list[bytes]]:
    """Text lines in the box (row ranges) with each one's column profile. Slivers (letter tips) are dropped."""
    left, top, right, bottom = box
    min_height = max(line_h // 3, 3)
    lines = [(s, e) for s, e in _spans(_profile(ink, box, columns=False), min_gap=1) if e - s >= min_height]
    return lines, [_profile(ink, (left, top + s, right, top + e), columns=True) for s, e in lines]


def _word_spaces(profile: bytes, shortest: int) -> list[int]:
    """Widths of the blank stretches between ink inside one line (not its margins) of at least `shortest`."""
    widths: list[int] = []
    run, seen_ink = 0, False
    for value in profile:
        if value > BLANK_MAX:
            if seen_ink and run >= shortest:
                widths.append(run)
            seen_ink, run = True, 0
        elif seen_ink:
            run += 1
    return widths


def _gutter_width(profiles: list[bytes], line_h: int) -> int:
    """Narrowest gap that counts as a column gutter on this page: clearly wider than its word spaces.

    Line height alone is a poor yardstick (anti-aliased text measures short), and a gutter set near
    the word-space width finds "columns" in any paragraph where two spaces happen to line up.
    """
    widths = sorted(w for profile in profiles for w in _word_spaces(profile, max(line_h // 3, 3)))
    word_space = widths[len(widths) // 2] if widths else 0
    return max(int(GUTTER_LINES * line_h), GUTTER_WORD_SPACES * word_space, 4)


def _split_columns(ink: Image.Image, box: Box, line_h: int, gutter: int) -> list[Box]:
    left, top, right, bottom = box
    rows = _spans(_profile(ink, box, columns=False), min_gap=bottom - top)
    if not rows or rows[0][1] - rows[0][0] < MIN_COLUMN_LINES * line_h:
        return [box]  # judged on the text itself, not the blank page around it
    spans = _spans(_profile(ink, box, columns=True), min_gap=gutter)
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


def _column_zones(lines: list[tuple[int, int]], profiles: list[bytes], gutter: int) -> list[tuple[int, int]]:
    """Row ranges where one gutter lines up across at least MIN_COLUMN_LINES consecutive text lines.

    Lines are checked one at a time, so a heading or full-width paragraph that crosses the gutter
    only ends the range instead of hiding the gutter from the whole page. A range runs from its first
    to its last line that has text on both sides of the gutter, so a one-sided line (a heading just
    under the columns) is never swept into it. Photos have been whited out by then, so a gap beside
    a photo has no text on its other side and never counts.
    """
    zones: list[tuple[int, int]] = []

    def two_sided(index: int, span: tuple[int, int]) -> bool:
        profile = profiles[index]
        return any(v > BLANK_MAX for v in profile[: span[0]]) and any(v > BLANK_MAX for v in profile[span[1]:])

    heights = sorted(end - start for start, end in lines)
    typical = heights[len(heights) // 2] if heights else 0

    def continues(inside: int, outside: int) -> bool:
        """A one-sided line next to the columns that is still part of them: body-sized text, close by."""
        gap = lines[outside][0] - lines[inside][1] if outside > inside else lines[inside][0] - lines[outside][1]
        return lines[outside][1] - lines[outside][0] <= HEADING_RATIO * typical and gap <= MAX_COLUMN_GAP * typical

    def close(first: int, last: int, span: tuple[int, int]) -> None:
        track_first, track_last = first, last
        while first <= last and not two_sided(first, span):
            first += 1
        while last >= first and not two_sided(last, span):
            last -= 1
        if last - first + 1 < MIN_COLUMN_LINES:
            return
        while last < track_last and continues(last, last + 1):
            last += 1
        while first > track_first and continues(first, first - 1):
            first -= 1
        zones.append((lines[first][0], lines[last][1]))

    tracks: list[tuple[int, tuple[int, int]]] = []  # (first line, gutter narrowed so far)
    for index, profile in enumerate(profiles):
        gaps = _gaps(profile, gutter)
        kept: list[tuple[int, tuple[int, int]]] = []
        for first, (g_start, g_end) in tracks:
            overlaps = [(max(g_start, a), min(g_end, b)) for a, b in gaps]
            overlaps = [(a, b) for a, b in overlaps if b - a >= gutter]
            if overlaps:
                kept.append((first, max(overlaps, key=lambda span: span[1] - span[0])))
            else:
                close(first, index - 1, (g_start, g_end))
        for a, b in gaps:
            if not any(min(b, k_end) - max(a, k_start) >= gutter for _, (k_start, k_end) in kept):
                kept.append((index, (a, b)))
        tracks = kept
    for first, span in tracks:
        close(first, len(profiles) - 1, span)
    return sorted(set(zones))


def _layout(ink: Image.Image, box: Box, line_h: int) -> list[Box]:
    """Blocks in reading order: each multi-column stretch as its columns, the rest full width."""
    left, top, right, bottom = box
    lines, profiles = _text_lines(ink, box, line_h)
    gutter = _gutter_width(profiles, line_h)

    # Gutters can be found twice or falsely (a speck beside a photo, a gap that happens to line up).
    # Take the tallest stretches first and only ones that really split into columns and don't overlap.
    chosen: list[tuple[int, int, list[Box]]] = []
    for zone_top, zone_bottom in sorted(_column_zones(lines, profiles, gutter), key=lambda zone: zone[0] - zone[1]):
        if any(zone_top < taken_bottom and taken_top < zone_bottom for taken_top, taken_bottom, _ in chosen):
            continue
        columns = _split_columns(ink, (left, top + zone_top, right, top + zone_bottom), line_h, gutter)
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


UNIT_WORDS = r"(?:tablespoons?|teaspoons?|tbsp|tsp|cups?|cloves?|pinch|slices?|cans?|pounds?|lbs?|ounces?)"
_FOLLOWED_BY_A_WORD = r"(?=\s+[A-Za-z(])(?!\s+(?:calories|kcal|cal)\b)"
# "oz" read as "0z" or "02" (the "o" becomes a zero), right after a quantity and before the ingredient
_OZ_AS_0Z = re.compile(r"(?<![\d.,/])(\d{1,3})0[zZ]" + _FOLLOWED_BY_A_WORD)
_OZ_AS_02 = re.compile(r"(?<![\d.,/])(\d{2,3})02" + _FOLLOWED_BY_A_WORD)
_YEAR = re.compile(r"(?:19|20)02")
# the digit 1 read as a bar or letter at the start of a line, when a unit word follows
_ONE_AS_BAR = re.compile(r"(?m)^[|lI](?=\s+" + UNIT_WORDS + r"\b)")


def repair_units(text: str) -> str:
    """Fix quantity misreads seen on real recipe cards ("1202 chicken" for 12oz, "| tablespoon" for 1).

    A misread like this still looks like a plausible amount, so a cook reviewing the text can't tell
    it from a real one. Each rule is narrow (a unit-shaped misread right before an ingredient word,
    never a year or a calorie count) because a wrong repair would be just as invisible.
    """
    text = _OZ_AS_0Z.sub(r"\1oz", text)
    text = _OZ_AS_02.sub(lambda m: m.group(0) if _YEAR.fullmatch(m.group(0)) else f"{m.group(1)}oz", text)
    return _ONE_AS_BAR.sub("1", text)


def extract_text(data: bytes) -> str:
    """Run OCR over an uploaded image and return the text as read (blocking; call off the event loop).

    Tesseract's own layout analysis merges columns that sit close together, interleaving their lines,
    so a multi-column page is cut into blocks here and each block is read by itself.
    """
    image = prepare_image(data)
    try:
        image, boxes, line_h = layout_page(image)
        text = _read_regions(image, boxes, line_h) if len(boxes) > 1 else ""
        return repair_units(text or _read(image)).strip()
    except pytesseract.TesseractNotFoundError as error:
        raise OcrUnavailableError(
            "Tesseract OCR isn't installed on the server, so images can't be read. Paste the recipe text instead."
        ) from error
    except RuntimeError as error:  # TesseractError, or pytesseract's timeout
        raise OcrFailedError(f"Tesseract could not read that image: {error}") from error
