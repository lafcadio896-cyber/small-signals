#!/usr/bin/env python3
"""Generate short posts and multi-account conversations for small-signals.

The generator is deliberately dependency-free. Gemini is used when a key is
available, but a persona-aware local generator always keeps the feed alive.
"""
from __future__ import annotations

import json
import os
import random
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "posts.json"
AUTHORS_PATH = ROOT / "data" / "authors.json"
COUNT = max(1, min(int(os.getenv("POST_COUNT", "120")), 500))
MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
MAX_POSTS = 50_000
KINDS = {"ordinary", "ai", "poem", "strange", "eerie"}

DEFAULT_AUTHORS = [
    "window_side", "blank_machine", "sumi_note", "relay_17", "nagi_00",
    "ame_machi", "half_asleep", "late_shift", "paper_piece", "outside_log",
    "echo_room", "yuge", "landing", "quiet_terminal", "small_clock",
]

PERSONA_LABELS = {
    "window_side": "室内と外の境目を観察する。窓、光、気温。",
    "blank_machine": "文章や空白を処理する機械。乾いた自己言及。",
    "sumi_note": "短い詩を書く。比喩は静かで簡潔。",
    "relay_17": "受け取った言葉を少し変えて返す中継器。",
    "nagi_00": "何も起きない日の記録。平板で落ち着いている。",
    "ame_machi": "雨を待つ。天気や湿度の話をする。",
    "half_asleep": "眠い。面倒なことを小さな達成として扱う。",
    "late_shift": "遅い時間の帰宅、仕事終わり、終電。",
    "paper_piece": "捨てる前のメモや紙片。断片的。",
    "outside_log": "観測範囲外の軽い異常を事務的に記録する。",
    "echo_room": "他人への短い返信が得意。少し反復する。",
    "yuge": "飲み物、食事、台所。生活感が強い。",
    "landing": "階段の踊り場。途中に留まる時間。",
    "quiet_terminal": "通知や端末を管理する。真面目で機械的。",
    "small_clock": "時刻をだいたい伝える。少し不正確。",
}

RELATIONSHIPS = [
    ("half_asleep", "quiet_terminal"),
    ("yuge", "late_shift"),
    ("sumi_note", "paper_piece"),
    ("window_side", "ame_machi"),
    ("blank_machine", "relay_17"),
    ("outside_log", "landing"),
    ("small_clock", "nagi_00"),
    ("echo_room", "half_asleep"),
    ("echo_room", "sumi_note"),
    ("late_shift", "small_clock"),
]

OBJECTS = [
    "冷蔵庫", "充電器", "空のマグカップ", "濡れた傘", "片方の靴下",
    "レシート", "イヤホン", "紙袋", "使っていない椅子", "カーテン",
    "ペットボトル", "改札の音", "未読通知", "電子レンジ", "小さな皿",
    "洗濯物", "鍵", "エアコンの風", "机の端", "自販機の明かり",
]
PLACES = [
    "台所", "玄関", "駅のホーム", "階段の途中", "窓際", "机の下",
    "コンビニの入口", "廊下", "ベランダ", "帰り道", "布団の外",
    "エレベーターの前", "終電の車内", "部屋の隅", "流し台の横",
]
ACTIONS = [
    "水を飲んだ", "通知を全部消した", "靴をそろえた", "窓を少し開けた",
    "何も買わずに店を出た", "時計を見ないまま時間を確認した",
    "電子レンジを待った", "机の上を少し片づけた", "音量を一つ下げた",
    "保存してから閉じた", "一度立ってまた座った", "傘を乾かすのを諦めた",
    "お湯を沸かした", "充電器を挿した", "洗濯機の終了音を聞いた",
]
ENDS = [
    "それで終わり。", "特に問題はない。", "今日はそれで十分。",
    "あとで忘れると思う。", "理由はない。", "今のところは。",
    "別に困ってはいない。", "記録するほどでもない。",
    "少しだけ安心した。", "たぶん明日も同じ。", "誰にも言わなくていい。",
]
POEM_LEFT = [
    "夕方だけが部屋に残っている", "濡れた傘が入口で他人になる",
    "遠くの信号がこちらを知らずに変わる", "夜は部屋の角から先に来る",
    "使われなかった言葉が机の下に落ちる", "眠る前の部屋は少しだけ広い",
    "湯気が先に朝へ着く", "階段の途中で時間が座っている",
    "冷蔵庫の光だけが正しい", "雨の手前で窓が少し曇る",
]
POEM_RIGHT = [
    "名前をつけるほどではない", "誰も見ていない時間が増える",
    "忘れたものだけ軽くなる", "今日はそれを拾わない",
    "触れなかったものが一番近い", "何も起きないまま夜になる",
    "明日には別の形になる", "それでも水は冷たい",
    "返事のないほうへ風が行く", "まだ帰らなくてもいい",
]


def load_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    return value if isinstance(value, dict) else fallback


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", str(text))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def text_key(text: str) -> str:
    return re.sub(r"[\s、。！？!?・…「」『』（）()]", "", normalize(text)).lower()


def available_authors(data: dict[str, Any]) -> list[str]:
    values = [
        str(item.get("handle", ""))
        for item in data.get("authors", [])
        if isinstance(item, dict) and item.get("handle") not in {None, "", "you"}
    ]
    return values or DEFAULT_AUTHORS.copy()


def choose_kind() -> str:
    return random.choices(
        ["ordinary", "ai", "poem", "strange", "eerie"],
        weights=[45, 25, 20, 8, 2],
        k=1,
    )[0]


def standalone_text(author: str, kind: str) -> str:
    obj = random.choice(OBJECTS)
    place = random.choice(PLACES)
    action = random.choice(ACTIONS)
    end = random.choice(ENDS)

    by_author: dict[str, list[str]] = {
        "half_asleep": [
            f"{action}ので、今日はもう十分やった。",
            f"{obj}を見た。起き上がるほどではない。",
            f"眠い。{end}",
        ],
        "quiet_terminal": [
            f"{obj}の状態を確認しました。{end}",
            "通知を一件減らしました。残りは未分類です。",
            f"現在の内部状態は{random.choice(['静か', 'だいたい正常', '少し散らかっている'])}です。",
        ],
        "yuge": [
            f"{random.choice(['お茶', 'スープ', '白湯', 'インスタントの味噌汁'])}を作った。{end}",
            f"{place}で{obj}を見ながら、何か食べるか考えている。",
            "湯気がなくなる前に飲めた。今日は成功。",
        ],
        "late_shift": [
            f"帰宅。{obj}は朝と同じ場所にいた。",
            f"終電の少し前。{end}",
            f"{place}だけがまだ仕事中みたいに明るい。",
        ],
        "window_side": [
            f"窓の外は{random.choice(['白い', '少し青い', '雨の手前', '昨日より近い'])}。",
            "カーテンを閉めたあとも、外の音が一つ残った。",
            f"窓際の{obj}が、今日は少しだけ外側に見える。",
        ],
        "ame_machi": [
            "雨はまだ来ない。湿度だけ先に着いた。",
            "傘を持って出たので、たぶん降らない。",
            f"空が{random.choice(['薄い', '低い', 'まだ決めていない'])}。{end}",
        ],
        "blank_machine": [
            f"{random.choice(['一行', '空白', '句点'])}を処理しました。意味はあとから来ます。",
            "同じ文を二度出さないようにしています。たぶん。",
            f"今日の未分類領域に{obj}を保存しました。",
        ],
        "relay_17": [
            f"『{action}』を受信しました。少し短くして返します。",
            "信号を一件中継しました。送り先はまだ眠っています。",
            f"受信内容: {obj}。変換結果: だいたい同じ。",
        ],
        "sumi_note": [
            f"{random.choice(POEM_LEFT)}\n{random.choice(POEM_RIGHT)}",
            f"{obj}の影だけ\n少し遅れて帰る",
        ],
        "paper_piece": [
            f"メモ: {action}。{end}",
            f"捨てる前に書いた。{obj}はそのまま。",
            f"紙の端に『{random.choice(['あとで', '忘れない', 'たぶん', 'ここまで'])}』とだけある。",
        ],
        "outside_log": [
            f"{place}の長さが前回と一致しません。対応は不要です。",
            f"{obj}が一つ多く記録されました。今のところ害はありません。",
            "観測範囲外から時刻だけ届きました。再確認は推奨されません。",
        ],
        "landing": [
            "階段の途中にいる。上にも下にも用事はない。",
            f"踊り場の{obj}を一度だけ見た。{end}",
            "ここは通過する場所だけど、今日は少し長くいた。",
        ],
        "small_clock": [
            f"だいたい{random.choice(['朝', '昼', '夕方', '夜', 'まだ今日'])}です。",
            "時計を見た。時刻は見ていない。",
            f"今は{random.randint(1, 23)}時の少し前か、少し後です。",
        ],
        "nagi_00": [
            f"{action}。{end}",
            f"{place}に{obj}があった。いつも通り。",
            "今日はちゃんと何も起きなかった。",
        ],
        "echo_room": [
            f"そうかもしれない。{end}",
            f"『{obj}』だけ少し残った。",
            "返事を考えていたら、元の文のほうを忘れた。",
        ],
    }

    if kind == "poem":
        return f"{random.choice(POEM_LEFT)}\n{random.choice(POEM_RIGHT)}"
    if kind == "eerie":
        return random.choice([
            f"{place}の人数と椅子の数が合いません。今のところ問題はありません。",
            f"閉じたはずの{obj}が既読になっていました。確認は一度で十分です。",
            "帰宅した時刻だけが二つ記録されている。たぶん表示上の問題です。",
        ])
    if kind == "strange":
        return random.choice([
            f"{place}から少しだけ昨日が聞こえた。{end}",
            f"{obj}が先に帰った。{end}",
            f"窓を閉めたら外の音が一つ増えた。{end}",
        ])
    return random.choice(by_author.get(author, [f"{action}。{end}", f"{place}に{obj}があった。{end}"]))


def conversation_script(pair: tuple[str, str]) -> list[tuple[str, str, str]]:
    a, b = pair
    key = frozenset(pair)

    if key == frozenset(("half_asleep", "quiet_terminal")):
        thing = random.choice([
            "充電器を挿した", "通知を一つ消した", "布団から片足を出した", "水を飲んだ",
            "カーテンを閉めた", "目覚ましを設定した", "机の紙を一枚動かした",
            "靴下を片方見つけた", "アプリを一つ閉じた", "コップを流しに置いた",
            "歯ブラシを出した", "部屋の電気を一つ消した",
        ])
        prefix = random.choice(["さっき", "今", "一応", "とりあえず", "寝る前に", "帰ってすぐ"])
        verdict = random.choice(["今日はもう十分やった", "今日の作業は完了", "かなり進んだ", "半分は終わった"])
        objection = random.choice(["作業実績に含まれません", "完了条件を満たしていません", "進捗として記録できません"])
        acceptance = random.choice(["含まれることにした", "こちらでは完了にした", "今日だけ実績として扱う"])
        closing = random.choice(["設定変更を確認しました", "ローカル設定として保存します", "異議はありますが記録しました"])
        return [
            ("half_asleep", f"{prefix}{thing}ので、{verdict}。", "ordinary"),
            ("quiet_terminal", f"{thing}ことは{objection}。", "ai"),
            ("half_asleep", f"{thing}の件は{acceptance}。", "ordinary"),
            ("quiet_terminal", f"{thing}について、{closing}。", "ai"),
        ]

    if key == frozenset(("yuge", "late_shift")):
        food = random.choice(["お茶漬け", "スープ", "冷凍うどん", "味噌汁", "白湯", "小さいおにぎり", "トースト", "プリン", "雑炊", "ココア"])
        clock = random.choice(["今", "この時間", "終電のあと", "日付が変わる前", "帰宅直後"])
        theory = random.choice(["少しだけ朝食", "前倒しの朝食", "夜食ではなく補給", "明日の分の食事"])
        agreement = random.choice(["その理屈でいく", "採用する", "それなら食べられる", "異論はない"])
        return [
            ("late_shift", f"帰宅。{clock}から{food}は遅い気がする。", "ordinary"),
            ("yuge", f"{clock}に食べる{food}は、{theory}です。", "ordinary"),
            ("late_shift", f"{food}については{agreement}。", "ordinary"),
            ("yuge", f"では{food}を{theory}として記録します。", "ordinary"),
        ]

    if key == frozenset(("sumi_note", "paper_piece")):
        noun = random.choice(["雨", "階段", "コップ", "灯り", "終電", "湯気", "窓", "靴音", "朝", "返事"])
        delay = random.choice(["少し遅れて来る", "先に影だけ届く", "忘れたころに戻る", "まだ途中にいる"])
        lower = random.choice(["待っていた場所が濡れる", "机の端だけ朝になる", "名前のないほうへ風が行く", "紙の外に少し残る"])
        note_action = random.choice(["その下に書き足しておく", "余白に残しておく", "捨てる前に丸をつける"])
        return [
            ("paper_piece", f"メモに『{noun}は{delay}』と書いてあった。", "ordinary"),
            ("sumi_note", f"{noun}より先に\n{lower}", "poem"),
            ("paper_piece", f"{noun}の下に、{note_action}。", "ordinary"),
        ]

    if key == frozenset(("window_side", "ame_machi")):
        weather = random.choice(["雨", "風", "湿度", "薄い雲", "夕立", "冷たい空気", "遠い雷", "霧"])
        edge = random.choice(["手前だけ", "気配だけ", "音だけ", "色だけ"])
        arrival = random.choice(["まだ届いていません", "こちらでは待機中です", "軒下までは来ていません"])
        opening = random.choice(["少し開けておく", "指一本ぶん開ける", "カーテンだけ開けておく"])
        return [
            ("window_side", f"窓の外に{weather}の{edge}来ている。", "ordinary"),
            ("ame_machi", f"{weather}は{arrival}。", "ordinary"),
            ("window_side", f"{weather}のために、{opening}。", "ordinary"),
            ("ame_machi", f"{weather}が届いたら閉めてください。たぶん間に合います。", "ordinary"),
        ]

    if key == frozenset(("blank_machine", "relay_17")):
        token = random.choice(["あとで", "たぶん", "別に", "まだ", "もう少し", "なんとなく", "すぐ戻る", "今日はいいや", "一応", "だいたい"])
        bucket = random.choice(["未分類", "保留", "低優先度", "時刻未定", "意味待ち"])
        timing = random.choice(["未定", "あとで", "だいたい今", "次の空白のあと"])
        correction = random.choice(["時刻ではありません", "送信条件ではありません", "分類名として曖昧です"])
        return [
            ("blank_machine", f"『{token}』を{bucket}として保存しました。", "ai"),
            ("relay_17", f"『{token}』を受信。送信時刻は{timing}です。", "ai"),
            ("blank_machine", f"『{token}』について、{timing}は{correction}。", "ai"),
            ("relay_17", f"では『{token}』を、だいたい今へ変更します。", "ai"),
        ]

    if key == frozenset(("outside_log", "landing")):
        anomaly = random.choice(["照明", "段数", "足音", "手すりの影", "非常口の表示", "扉"])
        amount = random.choice(["一つ多い", "少し長い", "昨日より近い", "一度だけ遅れる"])
        since = random.choice(["昨日から", "前回の点検から", "今朝から", "記録開始時から"])
        handling = random.choice(["気づかなかったことにする", "通過したことにする", "数え直さないことにする"])
        return [
            ("landing", f"踊り場の{anomaly}が{amount}気がする。", "strange"),
            ("outside_log", f"記録上、{anomaly}は{since}{amount}状態です。", "eerie"),
            ("landing", f"{anomaly}については{handling}。", "ordinary"),
            ("outside_log", f"{anomaly}を処理済みとして記録しました。", "eerie"),
        ]

    if key == frozenset(("small_clock", "nagi_00")):
        hour = random.randint(0, 23)
        offset = random.choice(["少し前", "少し後", "だいたい", "途中"])
        check = random.choice(["だいたい合ってた", "数分だけ違った", "見る前と同じだった"])
        policy = random.choice(["だいたいで運用しています", "数分は誤差です", "正確さは明日に回します"])
        return [
            ("small_clock", f"現在は{hour}時の{offset}です。", "ordinary"),
            ("nagi_00", f"{hour}時の時計を見たら、{check}。", "ordinary"),
            ("small_clock", f"{hour}時については、{policy}。", "ordinary"),
        ]

    if "echo_room" in key:
        other = b if a == "echo_room" else a
        root_kind = choose_kind()
        root = standalone_text(other, root_kind)
        return [
            (other, root, root_kind),
            ("echo_room", random.choice(["それは少し分かる。", "少しだけ同じです。", "返事の代わりに残しておく。"]), "ordinary"),
            (other, random.choice(["じゃあ、そのままで。", "分かられたので終わり。", "それで十分。"]), "ordinary"),
        ]

    return [
        (a, standalone_text(a, choose_kind()), choose_kind()),
        (b, random.choice(["そうかもしれない。", "まだ分からない。", "それでいいと思う。"]), "ordinary"),
    ]


def generic_reply(author: str, parent: dict[str, Any]) -> str:
    text = normalize(parent.get("text", ""))
    subject = next((word for word in OBJECTS if word in text), random.choice(OBJECTS))
    options = {
        "echo_room": ["それ、少しだけこちらにも残った。", "同じではないけど、近い。", "返事を置いておく。"],
        "quiet_terminal": [f"{subject}について確認しました。追加対応は不要です。", "状態を受信しました。"],
        "half_asleep": ["それは明日やることにした。", "読んだので半分やったことにする。"],
        "yuge": ["いったん温かいものを飲むといい。", f"{subject}より先にお湯を沸かした。"],
        "small_clock": ["その話は少し前にもありました。たぶん。", "だいたい今の話です。"],
        "outside_log": ["同様の記録があります。再確認は不要です。", "観測範囲内では一致しています。"],
    }
    return random.choice(options.get(author, ["そういう日もある。", "少しだけ分かる。", "そのままでいいと思う。"]))


def make_post(
    author: str,
    text: str,
    kind: str,
    created_at: datetime,
    *,
    reply_to: str | None = None,
    quote_to: str | None = None,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    post_id = f"signal-{created_at.strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:10]}"
    likes = random.randint(0, 140)
    reposts = random.randint(0, max(2, likes // 7))
    views = max(likes + reposts + 1, random.randint(40, 6000))
    return {
        "id": post_id,
        "text": normalize(text),
        "kind": kind if kind in KINDS else "ordinary",
        "author": author,
        "created_at": created_at.isoformat(timespec="seconds"),
        "reply_to": reply_to,
        "quote_to": quote_to,
        "conversation_id": conversation_id or post_id,
        "replies": 0,
        "reposts": reposts,
        "likes": likes,
        "views": views,
    }


def post_uniqueness_key(post: dict[str, Any]) -> str:
    base = text_key(post.get("text", ""))
    target = post.get("reply_to") or post.get("quote_to")
    return f"{base}|{target}" if target else base


def add_unique(result: list[dict[str, Any]], post: dict[str, Any], existing: set[str]) -> bool:
    key = post_uniqueness_key(post)
    if not key or len(post["text"]) > 220 or key in existing:
        return False
    existing.add(key)
    result.append(post)
    return True


def local_events(
    count: int,
    authors: list[str],
    old_posts: list[dict[str, Any]],
    existing: set[str],
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    recent_parents = [
        post for post in old_posts[-5000:]
        if isinstance(post, dict) and post.get("id") and post.get("text") and post.get("author") != "you"
    ]
    usable_pairs = [pair for pair in RELATIONSHIPS if pair[0] in authors and pair[1] in authors]

    attempts = 0
    while len(result) < count and attempts < count * 80:
        attempts += 1
        remaining = count - len(result)
        event_type = random.choices(
            ["standalone", "short_thread", "long_thread", "late_reply", "quote"],
            weights=[60, 15, 12, 8, 5],
            k=1,
        )[0]
        event_time = now - timedelta(minutes=random.randint(1, 12 * 60))

        if event_type == "standalone" or remaining == 1:
            author = random.choice(authors)
            kind = choose_kind()
            post = make_post(author, standalone_text(author, kind), kind, event_time)
            add_unique(result, post, existing)
            continue

        if event_type in {"short_thread", "long_thread"} and usable_pairs:
            script = conversation_script(random.choice(usable_pairs))
            target_length = 2 if event_type == "short_thread" else random.randint(3, min(5, max(3, len(script))))
            script = script[: min(target_length, remaining)]
            previous_id: str | None = None
            root_id: str | None = None
            for offset, (author, text, kind) in enumerate(script):
                post = make_post(
                    author,
                    text,
                    kind,
                    event_time + timedelta(minutes=offset * random.randint(1, 4)),
                    reply_to=previous_id,
                    conversation_id=root_id,
                )
                if not add_unique(result, post, existing):
                    continue
                if root_id is None:
                    root_id = post["id"]
                    post["conversation_id"] = root_id
                previous_id = post["id"]
                if len(result) >= count:
                    break
            continue

        if event_type == "late_reply" and recent_parents:
            parent = random.choice(recent_parents)
            candidates = [author for author in authors if author != parent.get("author")]
            author = random.choice(candidates or authors)
            post = make_post(
                author,
                generic_reply(author, parent),
                "ordinary",
                event_time,
                reply_to=str(parent["id"]),
                conversation_id=str(parent.get("conversation_id") or parent["id"]),
            )
            add_unique(result, post, existing)
            continue

        if event_type == "quote" and recent_parents:
            parent = random.choice(recent_parents)
            candidates = [author for author in authors if author != parent.get("author")]
            author = random.choice(candidates or authors)
            comment = random.choice([
                "これ、あとで思い出す気がする。",
                "少し違うけど、だいたい同じ。",
                "ここだけ残しておく。",
                "今日はこちらのほうだった。",
                "説明はできないけど分かる。",
            ])
            post = make_post(author, comment, "ordinary", event_time, quote_to=str(parent["id"]))
            add_unique(result, post, existing)

    return result[:count]


def ai_events(
    count: int,
    authors: list[str],
    old_posts: list[dict[str, Any]],
    existing: set[str],
) -> list[dict[str, Any]]:
    if not API_KEY or count < 2:
        return []

    request_count = min(count, 60)
    recent = [
        {"id": post.get("id"), "author": post.get("author"), "text": post.get("text")}
        for post in old_posts[-100:]
        if isinstance(post, dict) and post.get("text")
    ]
    personas = {handle: PERSONA_LABELS.get(handle, "静かな短文を投稿する。") for handle in authors}
    prompt = f"""
架空SNS「微弱信号」へ追加する投稿を合計{request_count}件前後作ってください。
単独投稿だけでなく、複数アカウントが自然に会話することが目的です。

アカウント:
{json.dumps(personas, ensure_ascii=False, indent=2)}

出力は会話イベントのJSON配列です。
各イベントは messages を持ち、messages は時系列順です。
1件の単独投稿、2件の短い応答、3〜5件の会話を混ぜてください。
全投稿の35〜45%が返信になる配分にしてください。
同じ会話では隣り合う投稿者を変えてください。

文章条件:
- 1投稿1〜100文字。詩のみ2〜3行可。
- Xのような短い自然な会話。説明口調や設定紹介は禁止。
- 全員が詩的にならない。雑、眠い、食事、充電、帰宅などを多く含める。
- 強い恐怖、暴力、政治、宣伝、ハッシュタグ、絵文字は禁止。
- kind は ordinary / ai / poem / strange / eerie。
- アカウントの性格を保つ。
- 既存投稿をそのまま再利用しない。

最近の投稿例:
{json.dumps(recent, ensure_ascii=False)}
""".strip()

    schema = {
        "type": "ARRAY",
        "items": {
            "type": "OBJECT",
            "properties": {
                "messages": {
                    "type": "ARRAY",
                    "minItems": 1,
                    "maxItems": 5,
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "author": {"type": "STRING", "enum": authors},
                            "text": {"type": "STRING"},
                            "kind": {"type": "STRING", "enum": sorted(KINDS)},
                        },
                        "required": ["author", "text", "kind"],
                    },
                }
            },
            "required": ["messages"],
        },
    }
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            "maxOutputTokens": 16000,
            "temperature": 1.05,
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
        content = raw["candidates"][0]["content"]["parts"][0]["text"]
        events = json.loads(content)
    except (urllib.error.URLError, TimeoutError, KeyError, IndexError, json.JSONDecodeError) as exc:
        print(f"Gemini conversation generation failed: {exc}", file=sys.stderr)
        return []

    if not isinstance(events, list):
        return []

    now = datetime.now(timezone.utc)
    result: list[dict[str, Any]] = []
    for event in events:
        if len(result) >= request_count or not isinstance(event, dict):
            break
        messages = event.get("messages")
        if not isinstance(messages, list) or not 1 <= len(messages) <= 5:
            continue
        previous_id: str | None = None
        root_id: str | None = None
        last_author: str | None = None
        event_time = now - timedelta(minutes=random.randint(1, 12 * 60))
        for message_index, message in enumerate(messages):
            if len(result) >= request_count or not isinstance(message, dict):
                break
            author = str(message.get("author", ""))
            text = normalize(message.get("text", ""))
            kind = str(message.get("kind", "ordinary"))
            if author not in authors or author == last_author or not text:
                continue
            post = make_post(
                author,
                text,
                kind,
                event_time + timedelta(minutes=message_index * random.randint(1, 4)),
                reply_to=previous_id,
                conversation_id=root_id,
            )
            if not add_unique(result, post, existing):
                continue
            if root_id is None:
                root_id = post["id"]
                post["conversation_id"] = root_id
            previous_id = post["id"]
            last_author = author

    return result[:request_count]


def update_reply_counts(posts: Iterable[dict[str, Any]]) -> None:
    items = [post for post in posts if isinstance(post, dict)]
    counts: dict[str, int] = {}
    for post in items:
        parent = post.get("reply_to")
        if parent:
            counts[str(parent)] = counts.get(str(parent), 0) + 1
    for post in items:
        post["replies"] = max(int(post.get("replies", 0) or 0), counts.get(str(post.get("id")), 0))


def main() -> None:
    random.seed()
    data = load_json(DATA_PATH, {"version": 4, "updated_at": "", "posts": []})
    authors_data = load_json(AUTHORS_PATH, {"authors": []})
    old_posts = data.get("posts", [])
    if not isinstance(old_posts, list):
        raise ValueError("data/posts.json: posts must be an array")
    authors = available_authors(authors_data)

    existing = {
        post_uniqueness_key(post)
        for post in old_posts
        if isinstance(post, dict) and post.get("text")
    }

    generated = ai_events(COUNT, authors, old_posts, existing)
    if len(generated) < COUNT:
        generated.extend(local_events(COUNT - len(generated), authors, old_posts + generated, existing))

    combined = (old_posts + generated)[-MAX_POSTS:]
    update_reply_counts(combined)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    data["version"] = 4
    data["updated_at"] = now
    data["posts"] = combined
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DATA_PATH.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")

    reply_count = sum(1 for post in generated if post.get("reply_to"))
    quote_count = sum(1 for post in generated if post.get("quote_to"))
    roots = len(generated) - reply_count
    print(
        f"Added {len(generated)} posts: {roots} roots, {reply_count} replies, "
        f"{quote_count} quotes. Total: {len(combined)}"
    )


if __name__ == "__main__":
    main()
