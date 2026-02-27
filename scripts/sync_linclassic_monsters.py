#!/usr/bin/env python3
"""
Fetch Lineage Classic monster data from the official PlayNC API and build
normalized datasets for monster/region/item views.
"""

from __future__ import annotations

import json
import subprocess
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

API_DOMAIN = "https://api-goats.plaync.com"
SERVICE = "linclassic"
LOCALE = "ko-KR"
PAGE_SIZE = 100
REQUEST_DELAY_SEC = 0.03
OUT_DIR = Path("data/linclassic")


@dataclass
class ApiClient:
    domain: str = API_DOMAIN
    service: str = SERVICE
    locale: str = LOCALE

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        query = dict(params or {})
        if "locale" not in query:
            query["locale"] = self.locale
        qs = urlencode(query, doseq=True)
        url = f"{self.domain}/{self.service}{path}"
        if qs:
            url = f"{url}?{qs}"

        cmd = ["curl", "-A", "Mozilla/5.0", "-sS", url]
        try:
            proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as err:
            stderr = (err.stderr or "").strip()
            raise RuntimeError(f"Failed request for {url}: {stderr or err}") from err
        if not proc.stdout:
            raise RuntimeError(f"Empty response for {url}")
        return json.loads(proc.stdout)


def fetch_monster_search_all(client: ApiClient, page_size: int = PAGE_SIZE) -> list[dict[str, Any]]:
    monsters: list[dict[str, Any]] = []
    page = 1
    last_page = 1
    while page <= last_page:
        payload = client.get_json(
            "/v2.0/dict/search/monster",
            {"size": page_size, "page": page},
        )
        contents = payload.get("contents", [])
        pagination = payload.get("pagination", {})
        monsters.extend(contents)
        last_page = int(pagination.get("lastPage", page))
        print(f"[search] page {page}/{last_page} -> +{len(contents)}")
        page += 1
        time.sleep(REQUEST_DELAY_SEC)
    return monsters


def fetch_monster_detail(client: ApiClient, monster_id: int) -> dict[str, Any]:
    payload = client.get_json(f"/v2.0/game/monster/{monster_id}")
    time.sleep(REQUEST_DELAY_SEC)
    return payload


def normalize(
    search_monsters: list[dict[str, Any]],
    detail_by_id: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    region_to_monsters: dict[str, set[int]] = defaultdict(set)
    item_to_monsters: dict[int, set[int]] = defaultdict(set)
    item_meta: dict[int, dict[str, Any]] = {}
    drops: list[dict[str, Any]] = []
    monsters_out: list[dict[str, Any]] = []

    for m in search_monsters:
        monster_id = int(m["id"])
        detail = detail_by_id.get(monster_id, {})
        is_big = bool(detail.get("big", False))
        regions = detail.get("regionNames", m.get("regionNames", [])) or []
        rewards = detail.get("rewards", []) or []

        for r in regions:
            if r:
                region_to_monsters[r].add(monster_id)

        reward_categories: list[dict[str, Any]] = []
        for cat in rewards:
            category_name = cat.get("categoryName") or ""
            rewards_list = cat.get("rewards", []) or []
            normalized_rewards: list[dict[str, Any]] = []
            for reward in rewards_list:
                item_id = int(reward["id"])
                item_name = str(reward.get("name") or "")
                normalized_rewards.append({"itemId": item_id, "itemName": item_name})
                item_to_monsters[item_id].add(monster_id)
                if item_id not in item_meta:
                    item_meta[item_id] = {"itemId": item_id, "itemName": item_name}
                drops.append(
                    {
                        "monsterId": monster_id,
                        "monsterName": m.get("name", ""),
                        "itemId": item_id,
                        "itemName": item_name,
                        "categoryName": category_name,
                    }
                )
            reward_categories.append(
                {
                    "categoryName": category_name,
                    "items": normalized_rewards,
                }
            )

        monsters_out.append(
            {
                "monsterId": monster_id,
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

    monsters_by_id = {int(m["id"]): m for m in search_monsters}
    regions_out = []
    for region_name in sorted(region_to_monsters.keys()):
        ids = sorted(region_to_monsters[region_name])
        regions_out.append(
            {
                "regionName": region_name,
                "monsterCount": len(ids),
                "monsterIds": ids,
                "monsterNames": [monsters_by_id[i].get("name", "") for i in ids if i in monsters_by_id],
            }
        )

    items_out = []
    for item_id in sorted(item_to_monsters.keys()):
        ids = sorted(item_to_monsters[item_id])
        items_out.append(
            {
                "itemId": item_id,
                "itemName": item_meta[item_id]["itemName"],
                "monsterCount": len(ids),
                "monsterIds": ids,
                "monsterNames": [monsters_by_id[i].get("name", "") for i in ids if i in monsters_by_id],
            }
        )

    return {
        "monsters": sorted(monsters_out, key=lambda x: (x["monsterName"], x["monsterId"])),
        "regions": regions_out,
        "items": items_out,
        "drops": sorted(drops, key=lambda x: (x["itemName"], x["monsterName"])),
    }


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    client = ApiClient()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    search_monsters = fetch_monster_search_all(client)
    unique_ids = sorted({int(m["id"]) for m in search_monsters})
    print(f"[search] total monsters: {len(search_monsters)}, unique ids: {len(unique_ids)}")

    details: dict[int, dict[str, Any]] = {}
    for idx, monster_id in enumerate(unique_ids, start=1):
        details[monster_id] = fetch_monster_detail(client, monster_id)
        print(f"[detail] {idx}/{len(unique_ids)} monsterId={monster_id}")

    normalized = normalize(search_monsters, details)
    metadata = {
        "generatedAtUtc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {
            "site": "https://lineageclassic.plaync.com/ko-kr/info/monster",
            "apiDomain": API_DOMAIN,
            "service": SERVICE,
            "locale": LOCALE,
            "searchEndpoint": f"/{SERVICE}/v2.0/dict/search/monster",
            "detailEndpoint": f"/{SERVICE}/v2.0/game/monster/{{id}}",
        },
        "counts": {
            "monsters": len(normalized["monsters"]),
            "regions": len(normalized["regions"]),
            "items": len(normalized["items"]),
            "drops": len(normalized["drops"]),
        },
    }

    write_json(OUT_DIR / "metadata.json", metadata)
    write_json(OUT_DIR / "monsters.json", normalized["monsters"])
    write_json(OUT_DIR / "regions.json", normalized["regions"])
    write_json(OUT_DIR / "items.json", normalized["items"])
    write_json(OUT_DIR / "drops.json", normalized["drops"])
    print(f"[done] wrote files to {OUT_DIR}")


if __name__ == "__main__":
    main()
