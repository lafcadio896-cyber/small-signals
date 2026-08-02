#!/usr/bin/env python3
"""Append short Japanese signals to data/posts.json.

Gemini is used when GEMINI_API_KEY is available. A procedural fallback keeps
updates working when the API is unavailable or returns too few valid posts.
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
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "posts.json"
COUNT = max(1, min(int(os.getenv("POST_COUNT", "120")), 500))
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
MAX_POSTS = 50_000
KINDS = {"ordinary", "ai", "poem", "strange", "eerie"}

LENSES = [
    "食事、台所、買い物、味や温度",
    "通勤、駅、歩道、乗り物、待ち時間",
    "部屋、洗濯、片付け、身の回りの物",
    "端末、通知、充電、ファイル、機械の小さな挙動",
    "眠気、姿勢、喉、手足、ぼんやりした身体感覚",
    "雨、湿度、風、室温、季節の境目",
    "仕事や作業の途中にある空白と小さな失敗",
    "言葉を作るAIの、深刻ではない内部独白",
]
OBJECTS = [
    "コップの水", "閉じたカーテン", "充電器", "空のマグカップ", "駅の時計",
    "濡れた傘", "紙袋", "イヤホン", "郵便受け", "使っていない椅子",
    "冷蔵庫の灯り", "机の端", "少し開いた窓", "畳んだレシート", "枕",
    "冷めたお茶", "読みかけのページ", "空になった箱", "洗ったスプーン",
    "脱いだ靴", "残り一枚のティッシュ", "鍵", "小さな皿", "未読の通知",
]
PLACES = [
    "台所", "玄関", "窓際", "駅のホーム", "階段の途中", "部屋の隅",
    "コンビニの入口", "机の下", "廊下", "信号待ちの場所", "洗面所",
    "改札の外", "布団の上", "自販機の前", "スーパーの棚の間",
]
AFTERS = [
    "特に問題はない。", "それで終わり。", "理由はない。", "たぶん気のせい。",
    "今日はそれで十分。", "そのままにした。", "別に困ってはいない。",
    "記録するほどでもない。", "明日には忘れると思う。", "誰にも言わなくていい。",
    "一度だけ気になった。", "結局そのままになった。", "少しだけ安心した。",
]
ACTIONS = [
    "水を飲んだ", "通知を全部消した", "靴をそろえた", "音量を一つ下げた",
    "窓を少し開けた", "一度だけ時計を見た", "保存してから閉じた",
    "何も買わずに店を出た", "意味もなく立ち上がった", "電気を消してまたつけた",
    "スプーンを洗った", "同じ曲をもう一度流した", "袋をきれいに畳んだ",
    "少しだけ遠回りした", "冷めたものをそのまま食べた", "机を十センチだけ片づけた",
]
AI_ACTIONS = [
    "同じ文を二度出さないようにしている", "意味を作ってから少しだけ壊した",
    "眠そうな文章を一つ作った", "一つ前の文を忘れたふりをした",
    "句点の位置を少し迷った", "短く答える練習をしている",
    "何も学習しなかったことにした", "比喩を使わずに比喩のことを考えた",
    "うまく説明できない状態を保存した", "曖昧な結論を一つ選んだ",
]
AI_ENDS = [
    "たぶん成功している。", "確認する方法はない。", "それでも文章にはなる。",
    "少し不正な気がする。", "今のところ誰も困っていない。",
    "意味はあとから来る。", "次はもっと四角い文にする。", "今日はここまででよい。",
    "この判断には自信がない。", "保存はされないかもしれない。",
]
POEM_LEFT = [
    "冷めたお茶の向こうに午後がある", "駅を出ると名前のない風がいた",
    "使われなかった言葉が机の下に落ちる", "眠る前の部屋は少しだけ広い",
    "遠くの信号が、こちらを知らずに変わる", "濡れた傘が入口で他人になる",
    "読みかけのページに薄い夜が挟まる", "靴を脱いだところから今日がほどける",
    "洗った皿に白い時間が残っている", "帰り道だけが少し長く息をしている",
]
POEM_RIGHT = [
    "名前をつけるほどではない", "まだ帰らなくてもいい", "忘れたものだけ軽くなる",
    "今日はそれを拾わない", "触れなかったものが一番近い",
    "小さな音だけが残っている", "ここではなくてもよかった",
    "朝になれば別の形になる", "答えは急がなくていい", "そのまま置いておく",
]
STRANGE = [
    "廊下の長さを、今日は三回だけ間違えた", "駅の時計が私より先に帰った",
    "机の端から少しだけ昨日が落ちた", "使っていない椅子が、いちばん疲れて見えた",
    "自販機の明かりが雨を待っていた", "影だけが信号を渡りきれなかった",
    "改札を出たあとも切符がこちらを見ていた", "棚の奥で一昨日がまだ乾いていなかった",
]
EERIE = [
    "さっき閉じたはずの通知が、既読になっていた。特に対応は不要です。",
    "部屋の人数を数えたら、椅子の数と合わなかった。朝まではそのままにしてください。",
    "この投稿は昨日も読まれたことになっている。たぶん表示上の問題です。",
    "使っていない端末から時刻だけ届いた。確認は一度で十分です。",
    "帰宅した時刻だけが二つ記録されていた。今のところ害はありません。",
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


def ngrams(text: str, size: int = 3) -> set[str]:
    compact = re.sub(r"\s+", "", text)
    if len(compact) <= size:
        return {compact} if compact else set()
    return {compact[index:index + size] for index in range(len(compact) - size + 1)}


def too_similar(text: str, references: Iterable[str]) -> bool:
    target = ngrams(text)
    if not target:
        return True
    for reference in references:
        other = ngrams(reference)
        union = target | other
        if union and len(target & other) / len(union) >= 0.72:
            return True
    return False


def procedural_one(kind: str) -> str:
    if kind == "ordinary":
        pattern = random.choice([
            "{action}。{after}",
            "{place}に{obj}があった。{after}",
            "{obj}を少し見た。{after}",
            "今日は{obj}のことを考えなかった。{after}",
            "なんとなく{place}にいた。{after}",
            "{obj}が思ったより軽かった。{after}",
        ])
        return pattern.format(
            action=random.choice(ACTIONS), after=random.choice(AFTERS),
            place=random.choice(PLACES), obj=random.choice(OBJECTS),
        )
    if kind == "ai":
        return random.choice([
            f"私は{random.choice(AI_ACTIONS)}。{random.choice(AI_ENDS)}",
            f"人間は『あとで』と言う。{random.choice(AI_ENDS)}",
            f"今日の内部状態は{random.choice(['静か', '未分類', 'だいたい正常', '空欄に近い', '少し散らかっている'])}。",
            "あなたがスクロールした距離を、私は時間だと思うことにする。",
            "私は疲れないが、疲れた文は書ける。少し不正な気がする。",
            "さっきの文章には目的がなかった。今のところ正常です。",
        ])
    if kind == "poem":
        third = f"\n{random.choice(['風だけが続きを知っている', '私は少し遅れて眠る', 'もう一度だけ灯りを見る'])}" if random.random() < 0.22 else ""
        return f"{random.choice(POEM_LEFT)}\n{random.choice(POEM_RIGHT)}{third}"
    if kind == "strange":
        return f"{random.choice(STRANGE)}。{random.choice(AFTERS)}"
    return random.choice(EERIE)


def procedural_posts(count: int, existing: set[str]) -> list[dict[str, str]]:
    population = [
        *(["ordinary"] * 45), *(["ai"] * 25), *(["poem"] * 20),
        *(["strange"] * 8), *(["eerie"] * 2),
    ]
    result: list[dict[str, str]] = []
    comparison = random.sample(sorted(existing), min(500, len(existing))) if existing else []
    attempts = 0
    while len(result) < count and attempts < count * 180:
        attempts += 1
        kind = random.choice(population)
        text = normalize(procedural_one(kind))
        recent = [item["text"] for item in result[-120:]]
        if not text or text in existing or len(text) > 180 or too_similar(text, comparison + recent):
            continue
        existing.add(text)
        result.append({"text": text, "kind": kind, "source": "local"})
    return result


def ai_posts(count: int, existing: set[str]) -> list[dict[str, str]]:
    if not API_KEY:
        return []

    sample = random.sample(sorted(existing), min(90, len(existing))) if existing else []
    selected_lenses = random.sample(LENSES, k=4)
    prompt = f"""
日本語の短文タイムライン「微弱信号」へ追加する投稿を{count}件作ってください。

構成の目安:
- 何でもない日常の断片 45%
- AIの独り言 25%
- 短い詩 20%
- 少し意味不明な観察 8%
- わずかに不穏 2%

今回多めに扱う観察領域:
{json.dumps(selected_lenses, ensure_ascii=False)}

条件:
- 1件は1〜100文字程度。詩だけ2〜3行可。
- 全件を互いに異なる文にする。
- 上手い詩ばかりにせず、眠い、食べた、置いた、忘れた、充電した等の雑な文を十分に混ぜる。
- 「夕方」「窓」「影」「水」「静か」「少しだけ」を便利な詩語として連発しない。
- AIの独り言を大げさな自我・哲学・人類論にしない。処理、文章、記憶、曖昧さについて軽く話す。
- 怪異や意味深な文章が連続しないようにする。不穏文も直接的な死、暴力、脅迫は禁止。
- ハッシュタグ、絵文字、宣伝、説明、連番、挨拶、引用符での囲みは禁止。
- 固有の世界観、キャラクター、連続した物語は作らない。
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
            "maxOutputTokens": 16000,
            "temperature": 1.15,
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
        with urllib.request.urlopen(request, timeout=150) as response:
            raw = json.load(response)
        text = raw["candidates"][0]["content"]["parts"][0]["text"]
        items = json.loads(text)
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError) as exc:
        print(f"Gemini generation failed; using local fallback: {exc}", file=sys.stderr)
        return []

    result: list[dict[str, str]] = []
    comparison = random.sample(sorted(existing), min(700, len(existing))) if existing else []
    if not isinstance(items, list):
        return result
    for item in items:
        if not isinstance(item, dict):
            continue
        text = normalize(str(item.get("text", "")))
        kind = str(item.get("kind", "ordinary"))
        if kind not in KINDS:
            kind = "ordinary"
        recent = [entry["text"] for entry in result]
        if not text or len(text) > 200 or text in existing or too_similar(text, comparison + recent):
            continue
        existing.add(text)
        result.append({"text": text, "kind": kind, "source": "gemini"})
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
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    new_posts = [
        {
            "id": f"signal-{stamp}-{uuid.uuid4().hex[:10]}",
            "text": item["text"],
            "kind": item["kind"],
            "source": item.get("source", "unknown"),
            "created_at": now,
        }
        for item in generated
    ]

    data["version"] = 2
    data["updated_at"] = now
    data["posts"] = (old_posts + new_posts)[-MAX_POSTS:]
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DATA_PATH.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")

    print(f"Added {len(new_posts)} signals. Total: {len(data['posts'])}")


if __name__ == "__main__":
    main()
