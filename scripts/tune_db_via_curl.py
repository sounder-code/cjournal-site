#!/usr/bin/env python3
import json
import math
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TMP = Path("/tmp/kuru_inat_tune_py")
OUT = ROOT / "lizardTunedTypeDb.js"

CLASS_QUERIES = [
    ("레오파드 게코", "Eublepharis macularius"),
    ("크레스티드 게코", "Correlophus ciliatus"),
    ("가고일 게코", "Rhacodactylus auriculatus"),
    ("리키에너스 게코", "Rhacodactylus leachianus"),
    ("차화 게코", "Mniarogekko chahoua"),
    ("사라시노럼 게코", "Correlophus sarasinorum"),
    ("토케이 게코", "Gekko gecko"),
    ("비어디드 드래곤", "Pogona vitticeps"),
    ("아프리칸 팻테일 게코", "Hemitheconyx caudicinctus"),
    ("블루텅 스킨크", "Tiliqua scincoides"),
    ("유로마스틱스", "Uromastyx"),
    ("테구", "Salvator merianae"),
    ("이구아나", "Iguana iguana"),
    ("카멜레온", "Chamaeleo calyptratus"),
    ("워터 드래곤", "Physignathus cocincinus"),
]


def run(*args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout


def curl_json(url):
    out = run("curl", "-A", "Mozilla/5.0", "-sL", url)
    return json.loads(out)


def curl_download(url, out_path):
    subprocess.run(["curl", "-A", "Mozilla/5.0", "-sL", "-o", str(out_path), url], check=True)


def obs_url(query, page):
    from urllib.parse import quote_plus

    return (
        "https://api.inaturalist.org/v1/observations"
        f"?taxon_name={quote_plus(query)}&quality_grade=research&photos=true"
        "&photo_license=cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-sa-nc"
        f"&order=desc&order_by=created_at&per_page=50&page={page}"
    )


def photo_url(square):
    return square.replace("/square.", "/medium.") if square else ""


def parse_bmp24(path):
    data = path.read_bytes()
    if data[:2] != b"BM":
        raise ValueError("not bmp")
    offset = int.from_bytes(data[10:14], "little")
    width = int.from_bytes(data[18:22], "little", signed=True)
    raw_h = int.from_bytes(data[22:26], "little", signed=True)
    bpp = int.from_bytes(data[28:30], "little")
    if bpp != 24:
        raise ValueError("bpp")
    height = abs(raw_h)
    top_down = raw_h < 0
    row_stride = ((bpp * width + 31) // 32) * 4
    return data, width, height, offset, row_stride, top_down


def pixel(data, width, height, offset, row_stride, top_down, x, y):
    yy = y if top_down else (height - 1 - y)
    i = offset + yy * row_stride + x * 3
    return (data[i + 2], data[i + 1], data[i])


def rgb_to_hsv(rgb):
    r, g, b = [v / 255 for v in rgb]
    mx, mn = max(r, g, b), min(r, g, b)
    d = mx - mn
    h = 0.0
    if d:
        if mx == r:
            h = ((g - b) / d) % 6
        elif mx == g:
            h = (b - r) / d + 2
        else:
            h = (r - g) / d + 4
        h *= 60
    s = 0 if mx == 0 else d / mx
    return h, s, mx


def clamp01(v):
    return max(0.0, min(1.0, v))


def extract_stats(bmp_path):
    data, w, h, offset, row_stride, top_down = parse_bmp24(bmp_path)
    min_x, max_x = int(w * 0.18), int(w * 0.82)
    min_y, max_y = int(h * 0.14), int(h * 0.86)
    cx, cy = (min_x + max_x) / 2, (min_y + max_y) / 2
    max_dist = math.hypot((max_x - min_x) / 2, (max_y - min_y) / 2) or 1
    step = max(1, int(min(w, h) / 180))

    rs = gs = bs = sat = val = wsum = 0.0
    buckets = {}
    lum_rows = []
    for y in range(min_y, max_y, step):
        row = []
        for x in range(min_x, max_x, step):
            r, g, b = pixel(data, w, h, offset, row_stride, top_down, x, y)
            d = math.hypot(x - cx, y - cy)
            wt = max(0.45, 1 - 0.55 * (d / max_dist))
            rs += r * wt
            gs += g * wt
            bs += b * wt
            wsum += wt
            _, s, v = rgb_to_hsv((r, g, b))
            sat += s * wt
            val += v * wt
            key = f"{r//24}-{g//24}-{b//24}"
            buckets[key] = buckets.get(key, 0.0) + wt
            row.append(r * 0.2126 + g * 0.7152 + b * 0.0722)
        lum_rows.append(row)

    avg = [round(rs / wsum), round(gs / wsum), round(bs / wsum)]
    dom = sorted(buckets.items(), key=lambda x: x[1], reverse=True)[:4]
    total = sum(w for _, w in dom) or 1
    dom_colors = []
    for key, weight in dom:
        rb, gb, bb = [int(v) for v in key.split("-")]
        dom_colors.append({"rgb": [rb * 24 + 12, gb * 24 + 12, bb * 24 + 12], "weight": weight / total})

    edge = edge_count = 0.0
    mean = m2 = n = 0.0
    sym_diff = sym_count = 0.0
    for y, row in enumerate(lum_rows):
        for x, p in enumerate(row):
            n += 1
            d = p - mean
            mean += d / n
            m2 += d * (p - mean)
            if x + 1 < len(row):
                edge += abs(p - row[x + 1])
                edge_count += 1
            if y + 1 < len(lum_rows) and x < len(lum_rows[y + 1]):
                edge += abs(p - lum_rows[y + 1][x])
                edge_count += 1
        half = len(row) // 2
        for x in range(half):
            sym_diff += abs(row[x] - row[-1 - x])
            sym_count += 1

    return {
        "avgRgb": avg,
        "dominantColors": dom_colors,
        "saturation": sat / wsum,
        "brightness": val / wsum,
        "facialPattern": {
            "edgeDensity": clamp01((edge / max(1, edge_count)) / 54),
            "contrast": clamp01((math.sqrt(m2 / max(1, n))) / 62),
            "symmetry": clamp01(1 - (sym_diff / max(1, sym_count)) / 90),
        },
    }


def merge_stats(items):
    n = len(items)
    if n == 0:
        return None
    avg = [0, 0, 0]
    pat = {"edgeDensity": 0.0, "contrast": 0.0, "symmetry": 0.0}
    bucket = {}
    for it in items:
        avg[0] += it["avgRgb"][0]
        avg[1] += it["avgRgb"][1]
        avg[2] += it["avgRgb"][2]
        pat["edgeDensity"] += it["facialPattern"]["edgeDensity"]
        pat["contrast"] += it["facialPattern"]["contrast"]
        pat["symmetry"] += it["facialPattern"]["symmetry"]
        for c in it["dominantColors"]:
            key = "-".join(str(v) for v in c["rgb"])
            bucket[key] = bucket.get(key, 0.0) + c["weight"]

    palette = [[round(avg[0] / n), round(avg[1] / n), round(avg[2] / n)]]
    for key, _ in sorted(bucket.items(), key=lambda kv: kv[1], reverse=True)[:3]:
        palette.append([int(v) for v in key.split("-")])

    return {
        "palette": palette[:4],
        "pattern": {
            "edgeDensity": round(pat["edgeDensity"] / n, 3),
            "contrast": round(pat["contrast"] / n, 3),
            "symmetry": round(pat["symmetry"] / n, 3),
        },
    }


def main():
    if TMP.exists():
        subprocess.run(["rm", "-rf", str(TMP)], check=True)
    TMP.mkdir(parents=True, exist_ok=True)
    out = {}

    for ltype, query in CLASS_QUERIES:
        urls = []
        seen = set()
        for page in range(1, 5):
            if len(urls) >= 14:
                break
            try:
                data = curl_json(obs_url(query, page))
            except Exception:
                continue
            for row in data.get("results", []):
                for p in row.get("photos", []):
                    u = photo_url(p.get("url"))
                    if not u or u in seen:
                        continue
                    seen.add(u)
                    urls.append(u)
                    if len(urls) >= 14:
                        break
                if len(urls) >= 14:
                    break

        stats = []
        for i, u in enumerate(urls):
            src = TMP / f"{ltype}-{i}.img"
            bmp = TMP / f"{ltype}-{i}.bmp"
            try:
                curl_download(u, src)
                subprocess.run(
                    ["/usr/bin/sips", "-s", "format", "bmp", str(src), "--out", str(bmp)],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                stats.append(extract_stats(bmp))
            except Exception:
                continue

        merged = merge_stats(stats)
        if merged:
            out[f"__TYPE__:{ltype}"] = merged
        print(f"{ltype}: {len(stats)}")

    code = "export const TUNED_TYPE_DB = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n"
    OUT.write_text(code, encoding="utf-8")
    print(f"saved: {OUT}")


if __name__ == "__main__":
    main()
