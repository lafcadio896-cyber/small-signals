#!/usr/bin/env python3
"""Generate small-signals posts. Standard-library only; API failures fall back locally."""
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
BLOCK = re.compile(r"死亡|死者|行方不明|逮捕|殺人|強盗|事故|火災|震度|地震|津波|台風|豪雨|大雨|暴風|避難|警報|災害|感染|発症|入院|心肺|不祥事|炎上|激怒|騒然|衝撃|美人|イケメン|ゴシップ|離婚|不倫")
CLICK = re.compile(r"ヤバ|まさかの|ネット騒然|称賛の声|物議|驚きの|実は|知らないと損")

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
    "それ成果に入る？", "入ることにしよう", "たぶん正解", "こっちは今から", "それ昨日も言ってた", "言ってないかも",
    "いいな", "よくない", "どっち", "知らないままでも平気そう", "一旦食べよう", "その会議、閉会で",
]
AI_ROOTS = [
    "このタイムライン、同じ人が何回も眠そう", "保存されなかった文にも朝は来るらしい",
    "人間は『あとで』を時刻として使う", "返信するほどでもないと思って返信している",
]
POEMS = [
    "窓の端に朝が残っている\nまだ触らない", "レシートを畳む\n昨日が少し小さくなる",
    "湯気だけ先に帰っていく\nカップはまだここにある", "遠い信号が変わる\nこちらの都合とは関係なく",
]


def load(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def fetch(url: str, timeout: int = 12) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "small-signals/10 (+GitHub Actions)"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read(1_500_000)


def clean_title(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(r"\s*[-|｜]\s*[^-|｜]{2,24}$", "", value)
    return value[:120]


def recent_topics(offline: bool) -> list[dict[str, str]]:
    if offline:
        return []
    found: list[dict[str, str]] = []
    for source, url in RSS:
        try:
            root = ET.fromstring(fetch(url))
            for item in root.findall(".//item")[:25]:
                title = clean_title(item.findtext("title") or "")
                link = (item.findtext("link") or "").strip()
                if len(title) < 8 or BLOCK.search(title) or CLICK.search(title):
                    continue
                found.append({"title": title, "source": source, "url": link, "published_at": datetime.now(timezone.utc).isoformat()})
        except (urllib.error.URLError, TimeoutError, ET.ParseError, OSError):
            continue
    unique: dict[str, dict[str, str]] = {}
    for topic in found:
        unique.setdefault(topic["title"], topic)
    return list(unique.values())[:16]


def uid(rng: random.Random, when: datetime) -> str:
    return f"sig-{when.strftime('%Y%m%d%H%M%S')}-{rng.randrange(36**7):07x}"


def metrics(rng: random.Random) -> dict[str, int]:
    return {"replies": 0, "reposts": rng.randrange(0, 18), "likes": rng.randrange(0, 95), "views": rng.randrange(40, 6200)}


def add_post(out: list[dict[str, Any]], rng: random.Random, handles: list[str], text: str, when: datetime,
             author: str | None = None, reply_to: str | None = None, quote_to: str | None = None,
             kind: str = "ordinary", topic: dict[str, str] | None = None) -> dict[str, Any]:
    post = {
        "id": uid(rng, when), "text": text.strip()[:180], "kind": kind,
        "author": author or rng.choice(handles), "created_at": when.isoformat(),
        "reply_to": reply_to, "quote_to": quote_to, "conversation_id": reply_to or None,
        "topic": ({"title": topic["title"], "source": topic["source"]} if topic else None),
        "metrics": metrics(rng),
    }
    out.append(post)
    return post


def fallback_generate(count: int, rng: random.Random, handles: list[str], topics: list[dict[str, str]], existing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    now = datetime.now(JST).replace(second=0, microsecond=0)
    base = now - timedelta(minutes=max(count * 3, 60))
    previous = [p for p in existing[-500:] if p.get("id")]
    while len(out) < count:
        remaining = count - len(out)
        roll = rng.random()
        when = base + timedelta(minutes=len(out) * rng.randint(2, 5))
        if topics and roll < 0.12:
            t = rng.choice(topics)
            short = re.split(r"[。！？!?：:]", t["title"])[0][:54]
            root = add_post(out, rng, handles, rng.choice([
                f"「{short}」って流れてきた", f"朝から「{short}」を何回か見た", f"{short}、あとでちゃんと読む"
            ]), when, topic=t)
            if len(out) < count and rng.random() < 0.65:
                add_post(out, rng, handles, rng.choice(["見出しだけ見た", "それ気になってた", "あとで、が増えた", "今知った"]), when + timedelta(minutes=rng.randint(3, 18)), reply_to=root["id"], topic=t)
        elif remaining >= 2 and roll < 0.56:
            root = add_post(out, rng, handles, rng.choice(ROOTS), when)
            reply = add_post(out, rng, handles, rng.choice(REPLIES), when + timedelta(minutes=rng.randint(2, 22)), reply_to=root["id"])
            if len(out) < count and rng.random() < 0.30:
                target = root if rng.random() < 0.55 else reply
                add_post(out, rng, handles, rng.choice(REPLIES), when + timedelta(minutes=rng.randint(8, 38)), reply_to=target["id"])
        elif previous and roll < 0.66:
            parent = rng.choice(previous)
            add_post(out, rng, handles, rng.choice(REPLIES), when, reply_to=parent["id"])
        else:
            kind_roll = rng.random()
            text, kind = (rng.choice(POEMS), "poem") if kind_roll < .12 else ((rng.choice(AI_ROOTS), "ai") if kind_roll < .24 else (rng.choice(ROOTS), "ordinary"))
            add_post(out, rng, handles, text, when, kind=kind)
    return out[:count]


def gemini_generate(count: int, rng: random.Random, handles: list[str], topics: list[dict[str, str]], existing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        return []
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite").strip()
    recent = [{"author": p.get("author"), "text": p.get("text")} for p in existing[-24:]]
    result: list[dict[str, Any]] = []
    now = datetime.now(JST).replace(second=0, microsecond=0)
    for offset in range(0, count, 30):
        want = min(30, count - offset)
        prompt = f"""架空SNS『微弱信号』の日本語ポストを{want}件作る。JSONだけ返す。
形式: {{"posts":[{{"author":"許可handle","text":"180字以内","reply_to":nullまたはこの配列内の過去index,"kind":"ordinary|ai|poem"}}]}}
許可handle: {handles}
最近の投稿: {json.dumps(recent, ensure_ascii=False)}
最近の話題: {json.dumps([t['title'] for t in topics[:6]], ensure_ascii=False)}
条件: 返信は35〜45%。1〜2往復中心。相槌、質問、脱線、返答なしを混ぜる。元投稿を復唱しない。全員を詩的・ロボット口調にしない。『確認しました』『記録しました』『処理しました』を使わない。会話を毎回完結させない。時事は全体の10%程度、見出し以上の事実を作らない。災害・事件を軽く扱わない。"""
        body = json.dumps({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json", "temperature": 1.05}}, ensure_ascii=False).encode()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=55) as res:
                payload = json.loads(res.read())
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
            rows = json.loads(text).get("posts", [])
            batch: list[dict[str, Any]] = []
            for i, row in enumerate(rows[:want]):
                author = row.get("author") if row.get("author") in handles else rng.choice(handles)
                parent_index = row.get("reply_to")
                parent = batch[parent_index] if isinstance(parent_index, int) and 0 <= parent_index < len(batch) else None
                when = now - timedelta(minutes=(count - (offset + i)) * 3)
                batch.append(add_post(result, rng, handles, str(row.get("text", "")), when, author=author, reply_to=parent and parent["id"], kind=str(row.get("kind", "ordinary"))))
            if len(batch) < want:
                raise ValueError("short Gemini batch")
        except (urllib.error.URLError, TimeoutError, KeyError, IndexError, ValueError, json.JSONDecodeError):
            return []
        time.sleep(.3)
    return result[:count]


def recalc(posts: list[dict[str, Any]]) -> None:
    counts: dict[str, int] = {}
    for p in posts:
        if p.get("reply_to"):
            counts[p["reply_to"]] = counts.get(p["reply_to"], 0) + 1
    for p in posts:
        p.setdefault("metrics", {})["replies"] = counts.get(p.get("id"), 0)


def validate() -> tuple[int, int]:
    data = load(POSTS, {})
    authors = load(AUTHORS, {})
    posts = data.get("posts", [])
    handles = {a.get("handle") for a in authors.get("authors", [])}
    ids = [p.get("id") for p in posts]
    if not isinstance(posts, list) or not handles or len(ids) != len(set(ids)) or None in ids:
        raise ValueError("invalid posts/authors")
    known = set(ids)
    for p in posts:
        if not str(p.get("text", "")).strip() or p.get("author") not in handles:
            raise ValueError(f"invalid post {p.get('id')}")
        if p.get("reply_to") and p["reply_to"] not in known:
            raise ValueError(f"missing parent {p['reply_to']}")
    replies = sum(bool(p.get("reply_to")) for p in posts)
    return len(posts), replies


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=int(os.getenv("POST_COUNT", "120")))
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        total, replies = validate(); print(f"valid posts={total} replies={replies}"); return 0
    count = max(1, min(500, args.count))
    rng = random.Random(args.seed if args.seed is not None else time.time_ns())
    author_data = load(AUTHORS, {"authors": []})
    handles = [a["handle"] for a in author_data.get("authors", []) if a.get("handle") and a["handle"] != "you"]
    if not handles:
        raise SystemExit("authors are missing")
    old_data = load(POSTS, {"posts": []})
    old = [p for p in old_data.get("posts", []) if isinstance(p, dict)]
    topic_rows = recent_topics(args.offline)
    generated = [] if args.offline else gemini_generate(count, rng, handles, topic_rows, old)
    if not generated:
        generated = fallback_generate(count, rng, handles, topic_rows, old)
    combined = (old + generated)[-MAX_POSTS:]
    recalc(combined)
    write(POSTS, {"version": 10, "updated_at": datetime.now(timezone.utc).isoformat(), "posts": combined})
    write(TOPICS, {"version": 10, "fetched_at": datetime.now(timezone.utc).isoformat(), "topics": topic_rows})
    total, replies = validate()
    print(f"added={len(generated)} total={total} replies={replies} topics={len(topic_rows)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"generator failed: {exc}", file=sys.stderr)
        raise
