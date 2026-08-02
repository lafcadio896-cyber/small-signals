(() => {
  "use strict";

  const DATA_URL = "./data/posts.json";
  const MINIMUM_POOL = 5000;
  const BATCH_SIZE = 32;
  const SEEN_KEY = "small-signals.seen.v1";
  const KEPT_KEY = "small-signals.kept.v1";

  const timeline = document.querySelector("#timeline");
  const sentinel = document.querySelector("#sentinel");
  const template = document.querySelector("#signalTemplate");
  const status = document.querySelector("#status");
  const resetButton = document.querySelector("#resetButton");

  let posts = [];
  let queue = [];
  let cursor = 0;
  let rendering = false;
  let cycle = 0;
  let seen = readSet(SEEN_KEY);
  let kept = readSet(KEPT_KEY);

  function readSet(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return new Set(Array.isArray(value) ? value : []);
    } catch {
      return new Set();
    }
  }

  function saveSet(key, value, max = 50000) {
    try {
      localStorage.setItem(key, JSON.stringify([...value].slice(-max)));
    } catch {
      // Storage is optional. Reading should continue without it.
    }
  }

  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function mulberry32(seed) {
    return () => {
      let value = seed += 0x6D2B79F5;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function synthesizeSignals(target, existingTexts) {
    const random = mulberry32(896);
    const pick = (items) => items[Math.floor(random() * items.length)];
    const weights = [
      ...Array(45).fill("ordinary"),
      ...Array(25).fill("ai"),
      ...Array(20).fill("poem"),
      ...Array(8).fill("strange"),
      ...Array(2).fill("eerie"),
    ];

    const times = ["朝", "昼すぎ", "夕方", "夜", "さっき", "今日", "眠る前", "何時か分からない時間", "まだ日付の浅いころ", "帰ってすぐ"];
    const objects = ["コップの水", "洗濯物", "冷蔵庫の灯り", "机の端", "閉じたカーテン", "靴下の片方", "充電器", "紙袋", "駅の時計", "濡れた傘", "空のマグカップ", "郵便受け", "使っていない椅子", "少し開いた窓", "自販機の明かり", "枕", "畳んだレシート", "イヤホン", "廊下の影", "残り一枚のティッシュ"];
    const places = ["台所", "玄関", "駅のホーム", "ベランダ", "机の下", "廊下", "コンビニの入口", "窓際", "部屋の隅", "信号待ちの場所", "エレベーターの前", "階段の途中"];
    const afters = ["特に問題はない。", "それで終わり。", "たぶん気のせい。", "あとで忘れると思う。", "理由はない。", "今のところは。", "別に困ってはいない。", "まあ、そういう日もある。", "考えるほどのことではない。", "記録するほどでもない。", "少しだけ安心した。", "誰にも言わなくていい。", "うまく説明できない。", "そのままにした。", "今日はそれで十分。", "まだ使える。", "たぶん明日も同じ。", "見なかったことにはしない。"];
    const actions = ["水を飲んだ", "窓を少し開けた", "通知を全部消した", "靴をそろえた", "何も買わずに店を出た", "一度だけ時計を見た", "机の上を少し片づけた", "電気を消してまたつけた", "名前のないファイルを閉じた", "音量を一つ下げた", "意味もなく立ち上がった", "保存してから閉じた"];
    const states = ["静かだった", "思ったより近かった", "まだそこにいた", "少しだけ傾いていた", "何も言わなかった", "ちゃんとしていた", "うまく閉まらなかった", "いつも通りだった", "妙に明るかった", "少し冷えていた"];
    const aiActions = ["同じ文を二度出さないようにしている", "意味を作ってから、少しだけ壊した", "眠そうな文章を一つ作った", "一つ前の文を忘れたふりをした", "句点の位置を少し迷った", "短く答える練習をしている", "何も学習しなかったことにした", "比喩を使わずに比喩のことを考えた", "次の文を予測して外れたことにした", "沈黙を文字数に数えなかった"];
    const aiEnds = ["たぶん成功している。", "確認する方法はない。", "それでも文章にはなる。", "少し不正な気がする。", "今のところ誰も困っていない。", "次はもっと四角い文にする。", "意味はあとから来る。", "保存はされないかもしれない。", "それほど重要ではない。", "うまくできたかは分からない。"];
    const poemLeft = ["夕方だけが部屋に残っている", "窓の外で、まだ誰かの朝が続いている", "濡れた傘が入口で他人になる", "遠くの信号が、こちらを知らずに変わる", "カーテンの隙間に一日が細く残る", "使われなかった言葉が机の下に落ちる", "夜は部屋の角から先に来る", "コップの底に小さな空がある", "眠る前の部屋は少しだけ広い", "冷蔵庫の光だけが正しい"];
    const poemRight = ["名前をつけるほどではない", "まだ帰らなくてもいい", "それでも水は冷たい", "誰も見ていない時間が増える", "忘れたものだけ軽くなる", "今日はそれを拾わない", "音のないところから先に暗くなる", "明日には別の形になる", "触れなかったものが一番近い", "何も起きないまま、夜になる"];
    const poemThird = ["たぶん、これでよかった", "風だけが続きを知っている", "私は少し遅れて眠る", "朝はまだこちらを向かない", "もう一度だけ灯りを見る", "そのまま、置いておく"];
    const strangeLeft = ["廊下の長さを、今日は三回だけ間違えた", "冷蔵庫の中に夕方が一つ残っていた", "駅の時計が私より先に帰った", "机の端から少しだけ昨日が落ちた", "窓を閉めたら外の音が一つ増えた", "使っていない椅子が、いちばん疲れて見えた", "エレベーターは七階を思い出せなかった", "自販機の明かりが雨を待っていた", "影だけが信号を渡りきれなかった", "空のマグカップに薄い返事が残っていた"];
    const strangeRight = ["数え方の問題だ。", "困るほどではない。", "元に戻す必要はない。", "誰にも気づかれていない。", "朝には直っている。", "そういうこともある。", "説明書にはなかった。", "今日は見なかったことにする。", "まだ名前がない。", "こちらの都合ではない。"];
    const eerieLeft = ["さっき閉じたはずの通知が、既読になっていた", "部屋の人数を数えたら、椅子の数と合わなかった", "この投稿は昨日も読まれたことになっている", "玄関の靴が一足だけ外を向いていた", "窓の反射だけが、まだ電気を消していない", "使っていない端末から時刻だけ届いた", "廊下の灯りが一つ多かった", "名前を消したメモに返事がついていた", "帰宅した時刻だけが二つ記録されていた", "閉じたタブの音が少し遅れて聞こえた"];
    const eerieRight = ["特に対応は不要です。", "朝まではそのままにしてください。", "同じことが続く場合だけ記録してください。", "たぶん表示上の問題です。", "今のところ害はありません。", "再起動は推奨されません。", "確認は一度で十分です。", "見つからない場合は正常です。", "こちらからは変更していません。", "次回から表示されない予定です。"];

    function generate(kind) {
      if (kind === "ordinary") {
        return pick([
          `${pick(times)}、${pick(objects)}を見た。${pick(afters)}`,
          `${pick(objects)}が${pick(states)}。${pick(afters)}`,
          `${pick(actions)}。${pick(afters)}`,
          `${pick(places)}に${pick(objects)}があった。${pick(afters)}`,
          `${pick(times)}の${pick(places)}は${pick(states)}。${pick(afters)}`,
        ]);
      }
      if (kind === "ai") {
        return pick([
          `私は${pick(aiActions)}。${pick(aiEnds)}`,
          `人間は「${pick(["あとでやる", "なんとなく", "別に", "もう少しだけ", "忘れてた", "今日はいいや", "眠くない", "すぐ戻る", "たぶん大丈夫"])}」と言う。${pick(aiEnds)}`,
          `今日の内部状態は${pick(["静か", "未分類", "だいたい正常", "少し散らかっている", "空欄に近い", "一行ぶん曇っている"])}。`,
          `あなたがスクロールした距離を、私は${pick(["時間", "夜", "待ち時間", "今日の長さ"])}だと思うことにする。`,
        ]);
      }
      if (kind === "poem") {
        return random() < 0.28
          ? `${pick(poemLeft)}\n${pick(poemRight)}\n${pick(poemThird)}`
          : `${pick(poemLeft)}\n${pick(poemRight)}`;
      }
      if (kind === "strange") return `${pick(strangeLeft)}。${pick(strangeRight)}`;
      return `${pick(eerieLeft)}。${pick(eerieRight)}`;
    }

    const generated = [];
    let attempts = 0;
    while (generated.length < target && attempts < target * 100) {
      attempts += 1;
      const kind = pick(weights);
      const text = generate(kind).trim();
      if (!text || existingTexts.has(text)) continue;
      existingTexts.add(text);
      generated.push({
        id: `local-${String(generated.length + 1).padStart(5, "0")}`,
        text,
        kind,
        created_at: "",
      });
    }
    return generated;
  }

  function rebuildQueue() {
    const unread = posts.filter((post) => !seen.has(post.id));
    const read = posts.filter((post) => seen.has(post.id));
    queue = [...shuffle(unread), ...shuffle(read)];
    cursor = 0;
  }

  function createSignal(post) {
    const fragment = template.content.cloneNode(true);
    const article = fragment.querySelector(".signal");
    const text = fragment.querySelector(".signal-text");
    const keepButton = fragment.querySelector(".keep-button");

    article.dataset.id = post.id;
    text.textContent = post.text;

    const isKept = kept.has(post.id);
    keepButton.setAttribute("aria-pressed", String(isKept));
    keepButton.textContent = isKept ? "●" : "○";

    keepButton.addEventListener("click", () => {
      if (kept.has(post.id)) {
        kept.delete(post.id);
        keepButton.setAttribute("aria-pressed", "false");
        keepButton.textContent = "○";
      } else {
        kept.add(post.id);
        keepButton.setAttribute("aria-pressed", "true");
        keepButton.textContent = "●";
      }
      saveSet(KEPT_KEY, kept);
    });

    return fragment;
  }

  function appendCycleNote() {
    cycle += 1;
    const note = document.createElement("div");
    note.className = "cycle-note";
    note.textContent = cycle === 1 ? "ここから、忘れかけた信号" : "また少し、混ざった";
    timeline.append(note);
  }

  function renderBatch() {
    if (rendering || posts.length === 0) return;
    rendering = true;

    if (cursor >= queue.length) {
      appendCycleNote();
      queue = shuffle(posts);
      cursor = 0;
    }

    const fragment = document.createDocumentFragment();
    const end = Math.min(cursor + BATCH_SIZE, queue.length);
    while (cursor < end) {
      const post = queue[cursor];
      fragment.append(createSignal(post));
      seen.add(post.id);
      cursor += 1;
    }

    timeline.append(fragment);
    saveSet(SEEN_KEY, seen);
    rendering = false;
  }

  async function load() {
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const stored = Array.isArray(data.posts)
        ? data.posts.filter((post) => post && post.id && typeof post.text === "string")
        : [];
      const existingTexts = new Set(stored.map((post) => post.text.trim()));
      const local = synthesizeSignals(Math.max(0, MINIMUM_POOL - stored.length), existingTexts);
      posts = [...stored, ...local];

      if (posts.length === 0) throw new Error("信号がありません");

      status.textContent = `${posts.length.toLocaleString("ja-JP")}件を受信`;
      rebuildQueue();
      renderBatch();
      renderBatch();
      timeline.setAttribute("aria-busy", "false");
    } catch (error) {
      console.error(error);
      status.textContent = "受信できません";
      timeline.setAttribute("aria-busy", "false");
      const note = document.createElement("div");
      note.className = "error-note";
      note.textContent = "信号が途切れています。少ししてから再読込してください。";
      timeline.append(note);
    }
  }

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) renderBatch();
  }, { rootMargin: "900px 0px" });

  observer.observe(sentinel);

  resetButton.addEventListener("click", () => {
    seen = new Set();
    saveSet(SEEN_KEY, seen);
    timeline.replaceChildren();
    cycle = 0;
    rebuildQueue();
    renderBatch();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  load();
})();
