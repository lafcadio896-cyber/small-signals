#!/usr/bin/env python3
"""Generate small-signals posts with safe RSS topics and local fallback."""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
POSTS = ROOT / "data/posts.json"
AUTHORS = ROOT / "data/authors.json"
TOPICS = ROOT / "data/topics.json"
JST = timezone(timedelta(hours=9))
MAX_POSTS = 20_000
RSS = [
    ("NHK", "https://www3.nhk.or.jp/rss/news/cat0.xml"),
    ("ITmedia", "https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml"),
]
BLOCK_WORDS = (
    "死亡", "死者", "行方不明", "逮捕", "殺人", "強盗", "事故", "火災", "地震", "津波",
    "台風", "豪雨", "大雨", "暴風", "避難", "警報", "災害", "感染", "発症", "入院",
    "不祥事", "炎上", "激怒", "騒然", "衝撃", "美人", "イケメン", "離婚", "不倫",
)
ROOTS = [
    "目覚まし止めた記憶だけある", "冷蔵庫を開けて、閉めた。成果なし", "洗濯物を取り込むところまで考えた",
    "今日の昼、何にするかだけ決まらない", "電車がちょうど行った。まあそういう日", "充電が37%。かなりある",
    "一回座ったら、もう今日は座る日", "傘を持ったのでたぶん降らない", "コンビニまで行く理由を探してる",
    "眠いけど、寝るにはまだ早い気がする", "通知を全部消した。えらい", "さっき何か調べようとしてた",
    "夕飯を決める会議が長い", "イヤホン片方だけ見つかった", "今日は空がちゃんと空だった",
    "机を片づけるために別の場所を散らかした", "水を飲んだ。進捗です", "帰ったら何もしない予定がある",
]
REPLIES = [
    "それはかなりある", "わかる", "まだいける", "もう寝たほうがいい", "今のなし", "何を調べる予定だった？",
    "それ成果に入る？", "入ることにしよう", "たぶん正解", "こっちは今から", "それ昨日も言ってた",
    "言ってないかも", "いいな", "よくない", "どっち", "知らないままでも平気そう", "一旦食べよう", "その会議、閉会で",
]
OTHER = [
    ("このタイムライン、同じ人が何回も眠そう", "ai"),
    ("人間は『あとで』を時刻として使う", "ai"),
    ("窓の端に朝が残っている\nまだ触らない", "poem"),
    ("湯気だけ先に帰っていく\nカップはまだここにある", "poem"),
]


def load(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def fetch_topics(offline: bool) -> list[dict[str, str]]:
    if offline:
        return []
    found: dict[str, dict[str, str]] = {}
    for source, url in RSS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "small-signals/10"})
            with urllib.request.urlopen(req, timeout=12) as response:
                root = ET.fromstring(response.read(1_500_000))
            for item in root.findall(".//item")[:25]:
                title = re.sub(r"\s+", " ", item.findtext("title") or "").strip()[:120]
                if len(title) < 8 or any(word in title for word in BLOCK_WORDS):
                    continue
                found.setdefault(title, {
                    "title": title,
                    "source": source,
                    "url": (item.findtext("link") or "").strip(),
                    "published_at": datetime.now(timezone.utc).isoformat(),
                })
        except (urllib.error.URLError, TimeoutError, ET.ParseError, OSError):
            continue
    return list(found.values())[:16]


def make_post(rng: random.Random, handles: list[str], text: str, when: datetime, *,
              author: str | None = None, reply_to: str | None = None,
              kind: str = "ordinary", topic: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "id": f"sig-{when.strftime('%Y%m%d%H%M%S')}-{rng.randrange(16**8):08x}",
        "text": text.strip()[:180],
        "kind": kind,
        "author": author or rng.choice(handles),
        "created_at": when.isoformat(),
        "reply_to": reply_to,
        "quote_to": None,
        "conversation_id": reply_to,
        "topic": ({"title": topic["title"], "source": topic["source"]} if topic else None),
        "metrics": {
            "replies": 0,
            "reposts": rng.randrange(0, 18),
            "likes": rng.randrange(0, 95),
            "views": rng.randrange(40, 6200),
        },
    }


def generate(count: int, rng: random.Random, handles: list[str], topics: list[dict[str, str]], existing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    now = datetime.now(JST).replace(second=0, microsecond=0)
    base = now - timedelta(minutes=max(3 * count, 60))
    old = [p for p in existing[-500:] if p.get("id")]
    while len(out) < count:
        when = base + timedelta(minutes=3 * len(out))
        roll = rng.random()
        if topics and roll < 0.12:
            topic = rng.choice(topics)
            short = re.split(r"[。！？!?：:]", topic["title"])[0][:54]
            root = make_post(rng, handles, rng.choice((
                f"『{short}』って流れてきた", f"朝から『{short}』を何回か見た", f"{short}、あとでちゃんと読む",
            )), when, topic=topic)
            out.append(root)
            if len(out) < count and rng.random() < 0.65:
                out.append(make_post(rng, handles, rng.choice(("見出しだけ見た", "それ気になってた", "あとで、が増えた", "今知った")), base + timedelta(minutes=3 * len(out)), reply_to=root["id"], topic=topic))
        elif roll < 0.58 and len(out) + 1 < count:
            root = make_post(rng, handles, rng.choice(ROOTS), when)
            out.append(root)
            reply = make_post(rng, handles, rng.choice(REPLIES), base + timedelta(minutes=3 * len(out)), reply_to=root["id"])
            out.append(reply)
            if len(out) < count and rng.random() < 0.28:
                parent = root if rng.random() < 0.55 else reply
                out.append(make_post(rng, handles, rng.choice(REPLIES), base + timedelta(minutes=3 * len(out)), reply_to=parent["id"]))
        elif old and roll < 0.68:
            out.append(make_post(rng, handles, rng.choice(REPLIES), when, reply_to=rng.choice(old)["id"]))
        else:
            text, kind = rng.choice(OTHER) if rng.random() < 0.20 else (rng.choice(ROOTS), "ordinary")
            out.append(make_post(rng, handles, text, when, kind=kind))
    return out[:count]


def recalc(posts: list[dict[str, Any]]) -> None:
    counts: dict[str, int] = {}
    for post in posts:
        parent = post.get("reply_to")
        if parent:
            counts[parent] = counts.get(parent, 0) + 1
    for post in posts:
        post.setdefault("metrics", {})["replies"] = counts.get(post.get("id"), 0)


def validate() -> tuple[int, int]:
    posts = load(POSTS, {}).get("posts", [])
    handles = {row.get("handle") for row in load(AUTHORS, {}).get("authors", [])}
    ids = [row.get("id") for row in posts]
    if not handles or len(ids) != len(set(ids)) or None in ids:
        raise ValueError("invalid ids or authors")
    known = set(ids)
    future_limit = datetime.now(timezone.utc) + timedelta(minutes=1)
    for row in posts:
        if not str(row.get("text", "")).strip() or row.get("author") not in handles:
            raise ValueError(f"invalid post {row.get('id')}")
        if row.get("reply_to") and row["reply_to"] not in known:
            raise ValueError(f"missing parent {row['reply_to']}")
        if datetime.fromisoformat(row["created_at"]).astimezone(timezone.utc) > future_limit:
            raise ValueError(f"future timestamp {row['id']}")
    return len(posts), sum(bool(row.get("reply_to")) for row in posts)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=int(os.getenv("POST_COUNT", "120")))
    parser.add_argument("--seed", type=int)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        total, replies = validate()
        print(f"valid posts={total} replies={replies}")
        return 0
    count = max(1, min(500, args.count))
    rng = random.Random(args.seed if args.seed is not None else time.time_ns())
    handles = [row["handle"] for row in load(AUTHORS, {"authors": []}).get("authors", []) if row.get("handle") and row["handle"] != "you"]
    if not handles:
        raise SystemExit("authors are missing")
    old = [row for row in load(POSTS, {"posts": []}).get("posts", []) if isinstance(row, dict)]
    topics = fetch_topics(args.offline)
    added = generate(count, rng, handles, topics, old)
    combined = (old + added)[-MAX_POSTS:]
    recalc(combined)
    write(POSTS, {"version": 10, "updated_at": datetime.now(timezone.utc).isoformat(), "posts": combined})
    write(TOPICS, {"version": 10, "fetched_at": datetime.now(timezone.utc).isoformat(), "topics": topics})
    total, replies = validate()
    print(f"added={len(added)} total={total} replies={replies} topics={len(topics)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"generator failed: {exc}", file=sys.stderr)
        raise
