#!/usr/bin/env python3
"""生成一个用于本地测试的空白练习用 PDF（六页、五线谱格线、页码）。
内容为程序自动生成的几何图形与页码，不含任何真实乐曲。"""
import math

PAGE_W, PAGE_H = 842, 595  # A4 横向
PAGES = 6

def page_stream(n):
    parts = []
    # 五线谱：4 个谱表组，每组 5 条线
    for group in range(4):
        top = 480 - group * 120
        for i in range(5):
            y = top - i * 14
            parts.append(f"0.6 w 0.2 0.2 0.25 RG 60 {y:.1f} m {PAGE_W-60} {y:.1f} l S")
        # 随机分布的音符符头（椭圆），用贝塞尔近似
        rng = (n * 977 + group * 131) % 7 + 6
        for k in range(rng):
            x = 90 + (k * 97 + n * 53 + group * 31) % (PAGE_W - 180)
            y = top - 28 - ((k * 41 + group * 17) % 56)
            cx, cy, rx, ry = x, y, 7.5, 5.5
            # 四段贝塞尔画椭圆
            k1 = 0.5523
            p = (f"{cx+rx} {cy} m "
                 f"{cx+rx} {cy+ry*k1} {cx+rx*k1} {cy+ry} {cx} {cy+ry} c "
                 f"{cx-rx*k1} {cy+ry} {cx-rx} {cy+ry*k1} {cx-rx} {cy} c "
                 f"{cx-rx} {cy-ry*k1} {cx-rx*k1} {cy-ry} {cx} {cy-ry} c "
                 f"{cx+rx*k1} {cy-ry} {cx+rx} {cy-ry*k1} {cx+rx} {cy} c f")
            parts.append(f"0.1 0.1 0.15 rg {p}")
    # 页眉页脚
    parts.append("BT /F1 22 Tf 60 545 Td (My Stand - Test Sheet) Tj ET")
    parts.append(f"BT /F1 16 Tf {(PAGE_W/2-12):.0f} 24 Td ({n}) Tj ET")
    return "\n".join(parts).encode()

def build(path):
    objs = []
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{4+i} 0 R" for i in range(PAGES))
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {PAGES} >>".encode())
    font = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    objs.append(font)  # 3 0 R
    for i in range(PAGES):
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
                    f"/Resources << /Font << /F1 3 0 R >> >> /Contents {5+PAGES+i} 0 R >>".encode())
    for i in range(PAGES):
        s = page_stream(i + 1)
        objs.append(b"<< /Length " + str(len(s)).encode() + b" >>\nstream\n" + s + b"\nendstream")

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for idx, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{idx} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs)+1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\n"
            f"startxref\n{xref}\n%%EOF\n").encode()
    open(path, "wb").write(out)
    print("written:", path, len(out), "bytes")

if __name__ == "__main__":
    build("test-score.pdf")
