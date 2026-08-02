#!/usr/bin/env python3
"""Append short Japanese signals to data/posts.json.

Uses Gemini when GEMINI_API_KEY is available. If the API is unavailable, a
local procedural generator keeps the stream alive without external packages.
"""

from __future__ import annotations

import json
import os
import random
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "posts.json"
COUNT = max(1, min(int(os.getenv("POST_COUNT", "120")), 500))
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
MAX_POSTS = 50_000
KINDS = {"ordinary", "ai", "poem", "strange", "eerie"}

OBJECTS = [
    "コップの水", "閉じたカーテン", "充電器", "空のマグカップ", "駅の時計",
    "濡れた傘", "紙袋", "イヤホン", "郵便受け", "使っていない椅子",
    "冷蔵庫の灯り", "机の端", "少し開いた窓", "畳んだレシート", "枕",
]
PLACES = [
    "台所", "玄関", "窓際", "駅のホーム", "階段の途中", "部屋の隅",
    "コンビニの入口", "机の下", "廊下", "信号待ちの場所",
]
AFTERS = [
    "特に問題はない。", "それで終わり。", "理由はない。", "たぶん気のせい。",
    "今日はそれで十分。", "そのままにした。", "別に困ってはいない。",
    "記録するほどでもない。", "明日には忘れると思う。", "誰にも言わなくていい。",
]
ACTIONS = [
    "水を飲んだ", "通知を全部消した", "靴をそろえた", "音量を一つ下げた",
    "窓を少し開けた", "一度だけ時計を見た", "保存してから閉じた",
    "何も買わずに店を出た", "意味もなく立ち上がった", "電気を消してまたつけた",
]
AI_ACTIONS = [
    "同じ文を二度出さないようにしている", "意味を作ってから少しだけ壊した",
    "眠そうな文章を一つ作った", "一つ前の文を忘れたふりをした",
    "句点の位置を少し迷った", "短く答える練習をしている",
    "何も学習しなかったことにした", "比喩を使わずに比喩のことを考えた",
]
AI_ENDS = [
    "たぶん成功している。", "確認する方法はない。", "それでも文章にはなる。",
    "少し不正な気がする。", "今のところ誰も困っていない。",
    "意味はあとから来る。", "次はもっと四角い文にする。",
]
POEM_LEFT = [
    "夕方だけが部屋に残っている", "濡れた傘が入口で他人になる",
    "遠くの信号が、こちらを知らずに変わる", "夜は部屋の角から先に来る",
    "コップの底に小さな空がある", "使われなかった言葉が机の下に落ちる",
    "眠る前の部屋は少しだけ広い", "冷蔵庫の光だけが正しい",
]
POEM_RIGHT = [
    "名前をつけるほどではない", "誰も見ていない時間が増える",
    "忘れたものだけ軽くなる", "今日はそれを拾わない",
    "触れなかったものが一番近い", "何も起きないまま、夜になる",
    "明日には別の形になる", "それでも水は冷たい",
]
STRANGE = [
    "廊下の長さを、今日は三回だけ間違えた", "駅の時計が私より先に帰った",
    "窓を閉めたら外の音が一つ増えた", "机の端から少しだけ昨日が落ちた",
    "使っていない椅子が、いちばん疲れて見えた",
    "自販機の明かりが雨を待っていた", "影だけが信号を渡りきれなかった",
]
EERIE = [
    "さっき閉じたはずの通知が、既読になっていた。特に対応は不要です。",
    "部屋の人数を数えたら、椅子の数と合わなかった。朝まではそのままにしてください。",
    "この投稿は昨日も読まれたことになっている。たぶん表示上の問題です。",
    "窓の反射だけが、まだ電気を消していない。今のところ害はありません。",
]


def load_data() -> dict[str, Any]:
    if not DATA_PATH.exists():
        return {"version": 1, "updated_at": "", "posts": []}
    with DATA_PATH.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data.get("posts"), list):
        raise ValueError("data/posts.json: posts must be an array")
    return data


def normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def procedural_one(kind: str) -> str:
    if kind == "ordinary":
        pattern = random.choice([
            "{action}。{after}",
            "{place}に{obj}があった。{after}",
            "{obj}を少し見た。{after}",
            "今日は{obj}のことを考えなかった。{after}",
            "なんとなく{place}にいた。{after}",
        ])
        return pattern.format(
            action=random.choice(ACTIONS), after=random.choice(AFTERS),
            place=random.choice(PLACES), obj=random.choice(OBJECTS),
        )
    if kind == "ai":
        return random.choice([
            f"私は{random.choice(AI_ACTIONS)}。{random.choice(AI_ENDS)}",
            f"人間は『あとで』と言う。{random.choice(AI_ENDS)}",
            f"今日の内部状態は{random.choice(['静か', '未分類', 'だいたい正常', '空欄に近い'])}。",
            "あなたがスクロールした距離を、私は時間だと思うことにする。",
            "私は疲れないが、疲れた文は書ける。少し不正な気がする。",
        ])
    if kind == "poem":
        return f"{random.choice(POEM_LEFT)}\n{random.choice(POEM_RIGHT)}"
    if kind == "strange":
        return f"{random.choice(STRANGE)}。{random.choice(AFTERS)}"
    return random.choice(EERIE)


def procedural_posts(count: int, existing: set[str]) -> list[dict[str, str]]:
    weights = [
        ("ordinary", 45), ("ai", 25), ("poem", 20),
        ("strange", 8), ("eerie", 2),
    ]
    population = [kind for kind, weight in weights for _ in range(weight)]
    result: list[dict[str, str]] = []
    attempts = 0
    while len(result) < count and attempts < count * 150:
        attempts += 1
        kind = random.choice(population)
        text = normalize(procedural_one(kind))
        if not text or text in existing or len(text) > 160:
            continue
        existing.add(text)
        result.append({"text": text, "kind": kind})
    return result


def ai_posts(count: int, existing: set[str]) -> list[dict[str, str]]:
    if not API_KEY:
        return []

    sample = random.sample(sorted(existing), min(80, len(existing))) if existing else []
    prompt = f"""
日本語の短文タイムライン「微弱信号」へ追加する投稿を{count}件作ってください。

構成の目安:
- 何でもない日常の断片 45%
- AIの独り言 25%
- 短い詩 20%
- 少し意味不明な観察 8%
- わずかに不穏 2%

条件:
- 1件は1〜90文字程度。詩だけ2〜3行可。
- 全件を互いに異なる文にする。
- 上手い詩ばかりにせず、眠い、充電、コップ、水、窓、帰宅などの雑な文も混ぜる。
- ハッシュタグ、絵文字、宣伝、説明、連番、引用符での囲みは禁止。
- 固有の世界観、キャラクター、連続した物語は作らない。
- 怖さを主役にしない。直接的な死、暴力、脅迫は使わない。
- kind は ordinary / ai / poem / strange / eerie のいずれか。
- 既存例と同一またはほぼ同一の文は避ける。

既存例:
{json.dumps(sample, ensure_ascii=False)}
""".strip()

    schema = {
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "text": {"type": "STRING"},
                "kind": {"type": "STRING", "enum": sorted(KINDS)},
            },
            "required": ["text", "kind"],
        },
    }
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "maxOutputTokens": 12000,
        },
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{urllib.parse.quote(MODEL, safe='-_.')}:generateContent?key="
        f"{urllib.parse.quote(API_KEY, safe='')}"
    )
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = json.load(response)
        text = raw["candidates"][0]["content"]["parts"][0]["text"]
        items = json.loads(text)
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError) as exc:
        print(f"Gemini generation failed; using local fallback: {exc}", file=sys.stderr)
        return []

    result: list[dict[str, str]] = []
    if not isinstance(items, list):
        return result
    for item in items:
        if not isinstance(item, dict):
            continue
        text = normalize(str(item.get("text", "")))
        kind = str(item.get("kind", "ordinary"))
        if kind not in KINDS:
            kind = "ordinary"
        if not text or len(text) > 180 or text in existing:
            continue
        existing.add(text)
        result.append({"text": text, "kind": kind})
    return result[:count]


def main() -> None:
    random.seed()
    data = load_data()
    old_posts = data["posts"]
    existing = {
        normalize(str(post.get("text", "")))
        for post in old_posts
        if isinstance(post, dict) and post.get("text")
    }

    generated = ai_posts(COUNT, existing)
    if len(generated) < COUNT:
        generated.extend(procedural_posts(COUNT - len(generated), existing))

    now = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    new_posts = [
        {
            "id": f"signal-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:10]}",
            "text": item["text"],
            "kind": item["kind"],
            "created_at": now,
        }
        for item in generated
    ]

    data["version"] = 1
    data["updated_at"] = now
    data["posts"] = (old_posts + new_posts)[-MAX_POSTS:]
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DATA_PATH.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")

    print(f"Added {len(new_posts)} signals. Total: {len(data['posts'])}")


if __name__ == "__main__":
    main()
