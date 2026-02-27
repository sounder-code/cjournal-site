#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RAW_DIR="$ROOT_DIR/data/linclassic/raw"
OUT_DIR="$ROOT_DIR/data/linclassic"
PUBLIC_DIR="$ROOT_DIR/public/data/linclassic"
API_BASE="https://api-goats.plaync.com/linclassic/v2.0"
LOCALE="ko-KR"
PAGE_SIZE=100

mkdir -p "$RAW_DIR" "$OUT_DIR" "$PUBLIC_DIR"

echo "[1/5] Fetch monster list pages"
curl -A "Mozilla/5.0" -s "${API_BASE}/dict/search/monster?size=${PAGE_SIZE}&page=1&locale=${LOCALE}" > "$RAW_DIR/search_page_1.json"

LAST_PAGE=$(python3 - <<'PY'
import json
from pathlib import Path
p = Path("data/linclassic/raw/search_page_1.json")
j = json.loads(p.read_text(encoding="utf-8"))
print(int(j.get("pagination", {}).get("lastPage", 1)))
PY
)

if [ "$LAST_PAGE" -gt 1 ]; then
  for page in $(seq 2 "$LAST_PAGE"); do
    curl -A "Mozilla/5.0" -s "${API_BASE}/dict/search/monster?size=${PAGE_SIZE}&page=${page}&locale=${LOCALE}" > "$RAW_DIR/search_page_${page}.json"
    echo "  - page ${page}/${LAST_PAGE}"
  done
fi

echo "[2/5] Build monster id list"
python3 - <<'PY'
import glob
import json
from pathlib import Path

ids = set()
for path in sorted(glob.glob("data/linclassic/raw/search_page_*.json")):
    j = json.loads(Path(path).read_text(encoding="utf-8"))
    for m in j.get("contents", []):
        ids.add(int(m["id"]))
Path("data/linclassic/raw/monster_ids.txt").write_text(
    "\n".join(str(x) for x in sorted(ids)) + "\n",
    encoding="utf-8",
)
print(f"monster ids: {len(ids)}")
PY

echo "[3/5] Fetch missing monster detail files"
total=$(wc -l < "$RAW_DIR/monster_ids.txt" | tr -d ' ')
idx=0
while IFS= read -r id; do
  idx=$((idx + 1))
  file="$RAW_DIR/monster_${id}.json"
  if [ ! -f "$file" ]; then
    curl -A "Mozilla/5.0" -s "${API_BASE}/game/monster/${id}?locale=${LOCALE}" > "$file"
    echo "  - fetched ${idx}/${total} id=${id}"
  fi
done < "$RAW_DIR/monster_ids.txt"

echo "[4/5] Build normalized datasets"
python3 - <<'PY'
import glob
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

raw_dir = Path("data/linclassic/raw")
out_dir = Path("data/linclassic")

search_monsters = []
for path in sorted(glob.glob(str(raw_dir / "search_page_*.json"))):
    j = json.loads(Path(path).read_text(encoding="utf-8"))
    search_monsters.extend(j.get("contents", []))

details = {}
for path in glob.glob(str(raw_dir / "monster_*.json")):
    j = json.loads(Path(path).read_text(encoding="utf-8"))
    details[int(j["id"])] = j

monster_name_by_id = {int(m["id"]): m.get("name", "") for m in search_monsters}

region_to_monsters = defaultdict(set)
item_to_monsters = defaultdict(set)
item_name_by_id = {}
drops = []
monsters_out = []

for m in search_monsters:
    mid = int(m["id"])
    d = details.get(mid, {})
    is_big = bool(d.get("big", False))
    regions = d.get("regionNames", m.get("regionNames", [])) or []
    rewards = d.get("rewards", []) or []

    reward_categories = []
    for cat in rewards:
        cat_name = cat.get("categoryName", "")
        items = []
        for reward in cat.get("rewards", []) or []:
            item_id = int(reward["id"])
            item_name = reward.get("name", "")
            items.append({"itemId": item_id, "itemName": item_name})
            item_to_monsters[item_id].add(mid)
            item_name_by_id[item_id] = item_name
            drops.append(
                {
                    "monsterId": mid,
                    "monsterName": m.get("name", ""),
                    "itemId": item_id,
                    "itemName": item_name,
                    "categoryName": cat_name,
                }
            )
        reward_categories.append({"categoryName": cat_name, "items": items})

    for r in regions:
        if r:
            region_to_monsters[r].add(mid)

    monsters_out.append(
        {
            "monsterId": mid,
            "monsterName": m.get("name", ""),
            "level": m.get("level"),
            "isBig": is_big,
            "monsterSize": "큰 몬스터" if is_big else "작은 몬스터",
            "formName": m.get("formName", "") or "",
            "image": m.get("image", ""),
            "regions": regions,
            "dropItemNames": m.get("rewordNames", []) or [],
            "rewardCategories": reward_categories,
        }
    )

regions_out = []
for region in sorted(region_to_monsters.keys()):
    ids = sorted(region_to_monsters[region])
    regions_out.append(
        {
            "regionName": region,
            "monsterCount": len(ids),
            "monsterIds": ids,
            "monsterNames": [monster_name_by_id.get(i, "") for i in ids],
        }
    )

items_out = []
for item_id in sorted(item_to_monsters.keys()):
    ids = sorted(item_to_monsters[item_id])
    items_out.append(
        {
            "itemId": item_id,
            "itemName": item_name_by_id.get(item_id, ""),
            "monsterCount": len(ids),
            "monsterIds": ids,
            "monsterNames": [monster_name_by_id.get(i, "") for i in ids],
        }
    )

metadata = {
    "generatedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "source": {
        "site": "https://lineageclassic.plaync.com/ko-kr/info/monster",
        "apiBase": "https://api-goats.plaync.com/linclassic/v2.0",
        "locale": "ko-KR",
    },
    "counts": {
        "monsters": len(monsters_out),
        "regions": len(regions_out),
        "items": len(items_out),
        "drops": len(drops),
    },
}

def write(path: Path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

out_dir.mkdir(parents=True, exist_ok=True)
write(out_dir / "metadata.json", metadata)
write(out_dir / "monsters.json", sorted(monsters_out, key=lambda x: (x["monsterName"], x["monsterId"])))
write(out_dir / "regions.json", regions_out)
write(out_dir / "items.json", items_out)
write(out_dir / "drops.json", sorted(drops, key=lambda x: (x["itemName"], x["monsterName"])))
PY

echo "[5/5] Copy datasets to public"
cp "$OUT_DIR/metadata.json" "$PUBLIC_DIR/metadata.json"
cp "$OUT_DIR/monsters.json" "$PUBLIC_DIR/monsters.json"
cp "$OUT_DIR/regions.json" "$PUBLIC_DIR/regions.json"
cp "$OUT_DIR/items.json" "$PUBLIC_DIR/items.json"
cp "$OUT_DIR/drops.json" "$PUBLIC_DIR/drops.json"

echo "[done] public/data/linclassic/*.json updated"
