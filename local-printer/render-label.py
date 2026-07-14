#!/usr/bin/env python3
import base64
import json
import os
import sys
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

COLS = 576
ROWS = 240

FONT_CANDIDATES = [
    os.environ.get("LIBMS_LABEL_FONT", ""),
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/simsun.ttc",
    "C:/Windows/Fonts/Deng.ttf",
    "C:/Windows/Fonts/Dengb.ttf",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if not path:
            continue
        path = os.path.expandvars(os.path.expanduser(path))
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    return ImageFont.load_default()


def text_fit(draw, text, max_width, size, min_size=18):
    current = size
    while current >= min_size:
        font = load_font(current)
        box = draw.textbbox((0, 0), text, font=font)
        if box[2] - box[0] <= max_width:
            return font
        current -= 2
    return load_font(min_size)


def normalize_text(value, fallback=""):
    text = str(value or fallback).strip()
    return text.replace("\n", " ")[:80]


def encode_rows(image):
    pixels = image.load()
    rows_data = []
    bytes_per_row = COLS // 8

    for y in range(ROWS):
        row = bytearray(bytes_per_row)
        black = 0
        for x in range(COLS):
            if pixels[x, y] == 0:
                row[x // 8] |= 1 << (7 - (x % 8))
                black += 1

        if black == 0:
            part = {
                "dataType": "void",
                "rowNumber": y,
                "repeat": 1,
                "blackPixelsCount": 0,
            }
        else:
            part = {
                "dataType": "pixels",
                "rowNumber": y,
                "repeat": 1,
                "blackPixelsCount": black,
                "rowDataBase64": base64.b64encode(bytes(row)).decode("ascii"),
            }

        if rows_data:
            last = rows_data[-1]
            same_type = last["dataType"] == part["dataType"]
            same_row = same_type and (
                part["dataType"] == "void"
                or last.get("rowDataBase64") == part.get("rowDataBase64")
            )
            if same_row:
                last["repeat"] += 1
                continue

        rows_data.append(part)

    return {"cols": COLS, "rows": ROWS, "rowsData": rows_data}


def build_image(payload):
    desk_id = normalize_text(payload.get("deskId"), "01")
    session = normalize_text(payload.get("session"), "拼豆计时")
    start_label = normalize_text(payload.get("startLabel"), "--:--")
    end_label = normalize_text(payload.get("endLabel"), "")
    mode = normalize_text(payload.get("mode"), "countdown")
    note = normalize_text(payload.get("note"), "")
    printed_at = datetime.now().strftime("%H:%M")

    image = Image.new("1", (COLS, ROWS), 1)
    draw = ImageDraw.Draw(image)

    title_font = load_font(34)
    desk_font = load_font(96)
    meta_font = load_font(30)
    small_font = load_font(24)
    session_font = text_fit(draw, session, 320, 34)

    draw.rounded_rectangle((12, 10, COLS - 13, ROWS - 11), radius=22, outline=0, width=4)
    draw.text((32, 26), "时里白造物", font=title_font, fill=0)
    draw.text((32, 72), f"{desk_id}号桌", font=desk_font, fill=0)

    draw.text((305, 38), session, font=session_font, fill=0)
    time_text = f"开 {start_label}"
    if mode == "countdown" and end_label and end_label != "--:--":
        time_text += f"  到 {end_label}"
    else:
        time_text += "  正计时"
    draw.text((305, 88), time_text, font=meta_font, fill=0)

    bottom = note or f"开台标签 · {printed_at}"
    bottom_font = text_fit(draw, bottom, 500, 26, 18)
    draw.line((30, 188, COLS - 30, 188), fill=0, width=2)
    draw.text((32, 198), bottom, font=bottom_font, fill=0)

    return image


def print_windows_queue(image):
    if os.name != "nt":
        raise RuntimeError("Windows printer queue mode is only available on Windows")

    try:
        import win32print
        import win32ui
        from PIL import ImageWin
    except Exception as exc:
        raise RuntimeError("缺少 Windows 打印依赖 pywin32，请运行一键安装脚本重新安装") from exc

    printer_name = os.environ.get("LIBMS_WINDOWS_PRINTER_NAME", "").strip()
    if not printer_name:
        printer_name = win32print.GetDefaultPrinter()
    if not printer_name:
        raise RuntimeError("未找到 Windows 打印机名称，请确认 NIIMBOT B3S-P 已添加到系统打印机")

    hdc = win32ui.CreateDC()
    try:
        hdc.CreatePrinterDC(printer_name)
        printable_width = max(1, hdc.GetDeviceCaps(8))   # HORZRES
        printable_height = max(1, hdc.GetDeviceCaps(10)) # VERTRES

        rgb_image = image.convert("RGB")
        scale = min(printable_width / rgb_image.width, printable_height / rgb_image.height)
        target_width = max(1, int(rgb_image.width * scale))
        target_height = max(1, int(rgb_image.height * scale))
        left = max(0, int((printable_width - target_width) / 2))
        top = max(0, int((printable_height - target_height) / 2))
        box = (left, top, left + target_width, top + target_height)

        hdc.StartDoc("LIBMS Perler Timer Label")
        hdc.StartPage()
        dib = ImageWin.Dib(rgb_image)
        dib.draw(hdc.GetHandleOutput(), box)
        hdc.EndPage()
        hdc.EndDoc()
    finally:
        try:
            hdc.DeleteDC()
        except Exception:
            pass

    return printer_name


def main():
    args = set(sys.argv[1:])
    payload = json.loads(sys.stdin.read() or "{}")
    image = build_image(payload)

    if "--windows-print" in args:
        printer_name = print_windows_queue(image)
        print(json.dumps({"ok": True, "printer": printer_name}, ensure_ascii=False))
        return

    if "--png" in args:
        idx = sys.argv.index("--png")
        output_path = sys.argv[idx + 1]
        image.convert("RGB").save(output_path)
        print(json.dumps({"ok": True, "path": output_path}, ensure_ascii=False))
        return

    print(json.dumps(encode_rows(image), ensure_ascii=False))


if __name__ == "__main__":
    main()
