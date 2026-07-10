"""Generate simple pin-shaped PNG icons with no external dependencies."""
import struct
import zlib
import os

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
PIN_COLOR = (26, 115, 232)  # Google blue


def make_icon(size):
    cx = size / 2
    top_cy = size * 0.36
    r = size * 0.30
    apex_y = size * 0.90
    hole_r = size * 0.11

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            dx, dy = px - cx, py - top_cy
            in_head = (dx * dx + dy * dy) <= r * r
            in_point = False
            if py >= top_cy and py <= apex_y:
                t = (py - top_cy) / (apex_y - top_cy)
                half_width = r * (1 - t)
                if abs(px - cx) <= half_width:
                    in_point = True
            in_hole = (dx * dx + dy * dy) <= hole_r * hole_r
            if (in_head or in_point) and not in_hole:
                row.extend((*PIN_COLOR, 255))
            else:
                row.extend((0, 0, 0, 0))
        rows.append(bytes(row))
    return rows


def write_png(path, size):
    rows = make_icon(size)
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type: none
        raw.extend(row)
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", compressed)
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for s in (16, 48, 128):
        write_png(os.path.join(OUT_DIR, f"icon{s}.png"), s)
    print("Icons written to", OUT_DIR)
