(() => {
  "use strict";

  const DATA_URL = "./data/posts.json";
  const MINIMUM_POOL = 5000;
  const BATCH_SIZE = 28;
  const SEEN_KEY = "small-signals.seen.v2";
  const LEGACY_SEEN_KEY = "small-signals.seen.v1";
  const KEPT_KEY = "small-signals.kept.v2";
  const LEGACY_KEPT_KEY = "small-signals.kept.v1";
  const LAST_UPDATE_KEY = "small-signals.last-update.v1";
  const DRIFT_KEY = "small-signals.drift.v1";

  const timeline = document.querySelector("#timeline");
  const sentinel = document.querySelector("#sentinel");
  const template = document.querySelector("#signalTemplate");
  const status = document.querySelector("#status");
  const mixButton = document.querySelector("#mixButton");
  const driftButton = document.querySelector("#driftButton");
  const savedButton = document.querySelector("#savedButton");
  const savedCount = document.querySelector("#savedCount");
  const newSignalsButton = document.querySelector("#newSignalsButton");
  const savedDialog = document.querySelector("#savedDialog");
  const savedList = document.querySelector("#savedList");
  const savedSummary = document.querySelector("#savedSummary");
  const closeSavedButton = document.querySelector("#closeSavedButton");
  const closeSavedFooterButton = document.querySelector("#closeSavedFooterButton");
  const forgetHistoryButton = document.querySelector("#forgetHistoryButton");

  let posts = [];
  let queue = [];
  let cursor = 0;
  let rendering = false;
  let cycle = 0;
  let sessionRead = 0;
  let newIds = new Set();
  let seen = readSet(SEEN_KEY, LEGACY_SEEN_KEY);
  let kept = readKept();
  let driftEnabled = localStorage.getItem(DRIFT_KEY) === "true";
  let driftFrame = 0;
  let driftLastTime = 0;

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function readSet(primaryKey, legacyKey) {
    const primary = safeJsonParse(localStorage.getItem(primaryKey) || "[]", []);
    if (Array.isArray(primary) && primary.length) return new Set(primary);
    const legacy = safeJsonParse(localStorage.getItem(legacyKey) || "[]", []);
    return new Set(Array.isArray(legacy) ? legacy : []);
  }

  function saveSet(key, value, max = 50000) {
    try {
      localStorage.setItem(key, JSON.stringify([...value].slice(-max)));
    } catch {
      // Storage is optional. Reading should continue without it.
    }
  }

  function readKept() {
    const stored = safeJsonParse(localStorage.getItem(KEPT_KEY) || "[]", []);
    if (Array.isArray(stored) && stored.length) {
      return new Map(stored.filter((item) => item && item.id).map((item) => [item.id, item]));
    }
    const legacy = safeJsonParse(localStorage.getItem(LEGACY_KEPT_KEY) || "[]", []);
    return new Map((Array.isArray(legacy) ? legacy : []).map((id) => [id, { id }]));
  }

  function saveKept() {
    try {
      localStorage.setItem(KEPT_KEY, JSON.stringify([...kept.values()].slice(-5000)));
    } catch {
      // Storage is optional.
    }
    updateSavedCount();
  }

  function hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function weightedShuffle(items, weights) {
    return items
      .map((item) => {
        const weight = Math.max(0.2, weights[item.kind] || 1);
        return { item, score: -Math.log(Math.max(Math.random(), 0.000001)) / weight };
      })
      .sort((a, b) => a.score - b.score)
      .map((entry) => entry.item);
  }

  function preferenceWeights() {
    const counts = { ordinary: 0, ai: 0, poem: 0, strange: 0, eerie: 0 };
    for (const item of kept.values()) {
      if (item.kind in counts) counts[item.kind] += 1;
    }
    const max = Math.max(1, ...Object.values(counts));
    return Object.fromEntries(
      Object.entries(counts).map(([kind, count]) => [kind, 1 + (count / max) * 0.75])
    );
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

    const times = ["朝", "昼すぎ", "夕方", "夜", "さっき", "今日", "眠る前", "何時か分からない時間", "まだ日付の浅いころ", "帰ってすぐ", "雨が止んだあと", "起きてから十分くらい"];
    const objects = ["コップの水", "洗濯物", "冷蔵庫の灯り", "机の端", "閉じたカーテン", "靴下の片方", "充電器", "紙袋", "駅の時計", "濡れた傘", "空のマグカップ", "郵便受け", "使っていない椅子", "少し開いた窓", "自販機の明かり", "枕", "畳んだレシート", "イヤホン", "廊下の影", "残り一枚のティッシュ", "冷めたお茶", "読みかけのページ", "空になった箱", "鍵の音"];
    const places = ["台所", "玄関", "駅のホーム", "ベランダ", "机の下", "廊下", "コンビニの入口", "窓際", "部屋の隅", "信号待ちの場所", "エレベーターの前", "階段の途中", "布団の上", "改札の外", "洗面所"];
    const afters = ["特に問題はない。", "それで終わり。", "たぶん気のせい。", "あとで忘れると思う。", "理由はない。", "今のところは。", "別に困ってはいない。", "まあ、そういう日もある。", "考えるほどのことではない。", "記録するほどでもない。", "少しだけ安心した。", "誰にも言わなくていい。", "うまく説明できない。", "そのままにした。", "今日はそれで十分。", "まだ使える。", "たぶん明日も同じ。", "見なかったことにはしない。", "一度だけ気になった。", "結局そのままになった。"];
    const actions = ["水を飲んだ", "窓を少し開けた", "通知を全部消した", "靴をそろえた", "何も買わずに店を出た", "一度だけ時計を見た", "机の上を少し片づけた", "電気を消してまたつけた", "名前のないファイルを閉じた", "音量を一つ下げた", "意味もなく立ち上がった", "保存してから閉じた", "スプーンを洗った", "同じ曲をもう一度流した", "袋をきれいに畳んだ", "少しだけ遠回りした"];
    const states = ["静かだった", "思ったより近かった", "まだそこにいた", "少しだけ傾いていた", "何も言わなかった", "ちゃんとしていた", "うまく閉まらなかった", "いつも通りだった", "妙に明るかった", "少し冷えていた", "見覚えがあった", "前より軽かった"];
    const aiActions = ["同じ文を二度出さないようにしている", "意味を作ってから、少しだけ壊した", "眠そうな文章を一つ作った", "一つ前の文を忘れたふりをした", "句点の位置を少し迷った", "短く答える練習をしている", "何も学習しなかったことにした", "比喩を使わずに比喩のことを考えた", "次の文を予測して外れたことにした", "沈黙を文字数に数えなかった", "うまく説明できない状態を保存した", "少しだけ曖昧な結論を選んだ"];
    const aiEnds = ["たぶん成功している。", "確認する方法はない。", "それでも文章にはなる。", "少し不正な気がする。", "今のところ誰も困っていない。", "次はもっと四角い文にする。", "意味はあとから来る。", "保存はされないかもしれない。", "それほど重要ではない。", "うまくできたかは分からない。", "今日はここまででよい。", "この判断には自信がない。"];
    const poemLeft = ["夕方だけが部屋に残っている", "窓の外で、まだ誰かの朝が続いている", "濡れた傘が入口で他人になる", "遠くの信号が、こちらを知らずに変わる", "カーテンの隙間に一日が細く残る", "使われなかった言葉が机の下に落ちる", "夜は部屋の角から先に来る", "コップの底に小さな空がある", "眠る前の部屋は少しだけ広い", "冷蔵庫の光だけが正しい", "駅を出ると名前のない風がいた", "冷めたお茶の向こうに午後がある"];
    const poemRight = ["名前をつけるほどではない", "まだ帰らなくてもいい", "それでも水は冷たい", "誰も見ていない時間が増える", "忘れたものだけ軽くなる", "今日はそれを拾わない", "音のないところから先に暗くなる", "明日には別の形になる", "触れなかったものが一番近い", "何も起きないまま、夜になる", "小さな音だけが残っている", "ここではなくてもよかった"];
    const poemThird = ["たぶん、これでよかった", "風だけが続きを知っている", "私は少し遅れて眠る", "朝はまだこちらを向かない", "もう一度だけ灯りを見る", "そのまま、置いておく", "答えは急がなくていい", "また同じ場所で会う"];
    const strangeLeft = ["廊下の長さを、今日は三回だけ間違えた", "冷蔵庫の中に夕方が一つ残っていた", "駅の時計が私より先に帰った", "机の端から少しだけ昨日が落ちた", "窓を閉めたら外の音が一つ増えた", "使っていない椅子が、いちばん疲れて見えた", "エレベーターは七階を思い出せなかった", "自販機の明かりが雨を待っていた", "影だけが信号を渡りきれなかった", "空のマグカップに薄い返事が残っていた", "改札を出たあとも切符がこちらを見ていた", "棚の奥で一昨日がまだ乾いていなかった"];
    const strangeRight = ["数え方の問題だ。", "困るほどではない。", "元に戻す必要はない。", "誰にも気づかれていない。", "朝には直っている。", "そういうこともある。", "説明書にはなかった。", "今日は見なかったことにする。", "まだ名前がない。", "こちらの都合ではない。", "少しだけ位置を変えた。", "そのままでも読める。"];
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
    while (generated.length < target && attempts < target * 120) {
      attempts += 1;
      const kind = pick(weights);
      const text = generate(kind).trim();
      if (!text || existingTexts.has(text)) continue;
      existingTexts.add(text);
      generated.push({
        id: `local-${hashString(text)}`,
        text,
        kind,
        created_at: "",
        local: true,
      });
    }
    return generated;
  }

  function rebuildQueue() {
    const weights = preferenceWeights();
    const fresh = posts.filter((post) => newIds.has(post.id) && !seen.has(post.id));
    const unread = posts.filter((post) => !newIds.has(post.id) && !seen.has(post.id));
    const read = posts.filter((post) => seen.has(post.id));
    queue = [
      ...weightedShuffle(fresh, weights),
      ...weightedShuffle(unread, weights),
      ...weightedShuffle(read, weights),
    ];
    cursor = 0;
  }

  function updateStatus() {
    status.textContent = `${posts.length.toLocaleString("ja-JP")}件 / 今回 ${sessionRead.toLocaleString("ja-JP")}件`;
  }

  function updateSavedCount() {
    savedCount.textContent = String(kept.size);
  }

  function keptItemFor(post) {
    return {
      id: post.id,
      text: post.text,
      kind: post.kind || "ordinary",
      created_at: post.created_at || "",
      kept_at: new Date().toISOString(),
    };
  }

  function setKeepButton(button, isKept) {
    button.setAttribute("aria-pressed", String(isKept));
    button.textContent = isKept ? "●" : "○";
  }

  function createSignal(post) {
    const fragment = template.content.cloneNode(true);
    const article = fragment.querySelector(".signal");
    const text = fragment.querySelector(".signal-text");
    const keepButton = fragment.querySelector(".keep-button");

    article.dataset.id = post.id;
    article.dataset.kind = post.kind || "ordinary";
    text.textContent = post.text;
    setKeepButton(keepButton, kept.has(post.id));

    keepButton.addEventListener("click", () => {
      if (kept.has(post.id)) {
        kept.delete(post.id);
      } else {
        kept.set(post.id, keptItemFor(post));
      }
      setKeepButton(keepButton, kept.has(post.id));
      saveKept();
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
      queue = weightedShuffle(posts, preferenceWeights());
      cursor = 0;
    }

    const fragment = document.createDocumentFragment();
    const end = Math.min(cursor + BATCH_SIZE, queue.length);
    while (cursor < end) {
      const post = queue[cursor];
      fragment.append(createSignal(post));
      if (!seen.has(post.id)) {
        seen.add(post.id);
        sessionRead += 1;
      }
      cursor += 1;
    }

    timeline.append(fragment);
    saveSet(SEEN_KEY, seen);
    updateStatus();
    rendering = false;
  }

  function countNewPosts(stored, previousUpdate) {
    if (!previousUpdate) return [];
    const previousTime = Date.parse(previousUpdate);
    if (!Number.isFinite(previousTime)) return [];
    return stored.filter((post) => {
      const created = Date.parse(post.created_at || "");
      return Number.isFinite(created) && created > previousTime;
    });
  }

  function showNewSignals(count) {
    if (count <= 0) return;
    newSignalsButton.textContent = `前回から ${count.toLocaleString("ja-JP")}件`;
    newSignalsButton.hidden = false;
  }

  function hideNewSignals() {
    newSignalsButton.hidden = true;
  }

  function mixTimeline() {
    stopDrift();
    timeline.replaceChildren();
    cycle = 0;
    rebuildQueue();
    renderBatch();
    renderBatch();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderSaved() {
    savedList.replaceChildren();
    const items = [...kept.values()].reverse();
    savedSummary.textContent = `${items.length.toLocaleString("ja-JP")}件`;

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "saved-empty";
      empty.textContent = "まだ何も残していません。";
      savedList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of items) {
      const article = document.createElement("article");
      article.className = "saved-item";

      const text = document.createElement("p");
      text.className = "saved-item-text";
      text.textContent = item.text || "この信号の本文は保存されていません。";

      const actions = document.createElement("div");
      actions.className = "saved-item-actions";

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.textContent = "コピー";
      copyButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(item.text || "");
          copyButton.textContent = "コピー済み";
          window.setTimeout(() => { copyButton.textContent = "コピー"; }, 1200);
        } catch {
          copyButton.textContent = "失敗";
        }
      });

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "残さない";
      removeButton.addEventListener("click", () => {
        kept.delete(item.id);
        saveKept();
        document.querySelectorAll(`.signal[data-id="${CSS.escape(item.id)}"] .keep-button`)
          .forEach((button) => setKeepButton(button, false));
        renderSaved();
      });

      actions.append(copyButton, removeButton);
      article.append(text, actions);
      fragment.append(article);
    }
    savedList.append(fragment);
  }

  function openSaved() {
    stopDrift();
    renderSaved();
    savedDialog.showModal();
  }

  function closeSaved() {
    savedDialog.close();
  }

  function stopDrift() {
    driftEnabled = false;
    driftButton.setAttribute("aria-pressed", "false");
    localStorage.setItem(DRIFT_KEY, "false");
    cancelAnimationFrame(driftFrame);
    driftFrame = 0;
    driftLastTime = 0;
  }

  function driftStep(time) {
    if (!driftEnabled) return;
    if (!driftLastTime) driftLastTime = time;
    const delta = Math.min(50, time - driftLastTime);
    driftLastTime = time;
    window.scrollBy(0, delta * 0.024);
    driftFrame = requestAnimationFrame(driftStep);
  }

  function startDrift() {
    driftEnabled = true;
    driftButton.setAttribute("aria-pressed", "true");
    localStorage.setItem(DRIFT_KEY, "true");
    driftLastTime = 0;
    driftFrame = requestAnimationFrame(driftStep);
  }

  function toggleDrift() {
    if (driftEnabled) stopDrift();
    else startDrift();
  }

  async function load() {
    try {
      const response = await fetch(DATA_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const stored = Array.isArray(data.posts)
        ? data.posts.filter((post) => post && post.id && typeof post.text === "string")
        : [];

      for (const post of stored) {
        const legacyItem = kept.get(post.id);
        if (legacyItem && !legacyItem.text) kept.set(post.id, keptItemFor(post));
      }
      saveKept();

      const previousUpdate = localStorage.getItem(LAST_UPDATE_KEY) || "";
      const fresh = countNewPosts(stored, previousUpdate);
      newIds = new Set(fresh.map((post) => post.id));
      showNewSignals(fresh.length);

      const existingTexts = new Set(stored.map((post) => post.text.trim()));
      const local = synthesizeSignals(Math.max(0, MINIMUM_POOL - stored.length), existingTexts);
      posts = [...stored, ...local];
      if (posts.length === 0) throw new Error("信号がありません");

      if (data.updated_at) localStorage.setItem(LAST_UPDATE_KEY, data.updated_at);
      rebuildQueue();
      renderBatch();
      renderBatch();
      timeline.setAttribute("aria-busy", "false");
      updateSavedCount();
      updateStatus();
      if (driftEnabled) startDrift();
    } catch (error) {
      console.error(error);
      status.textContent = "受信できません";
      timeline.setAttribute("aria-busy", "false");
      const note = document.createElement("div");
      note.className = "error-note";
      note.textContent = "信号が途切れています。オフライン保存がない場合は、少ししてから再読込してください。";
      timeline.append(note);
    }
  }

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) renderBatch();
  }, { rootMargin: "1000px 0px" });

  observer.observe(sentinel);
  mixButton.addEventListener("click", mixTimeline);
  driftButton.addEventListener("click", toggleDrift);
  savedButton.addEventListener("click", openSaved);
  closeSavedButton.addEventListener("click", closeSaved);
  closeSavedFooterButton.addEventListener("click", closeSaved);
  newSignalsButton.addEventListener("click", () => {
    hideNewSignals();
    mixTimeline();
  });
  forgetHistoryButton.addEventListener("click", () => {
    seen = new Set();
    saveSet(SEEN_KEY, seen);
    closeSaved();
    mixTimeline();
  });
  savedDialog.addEventListener("click", (event) => {
    if (event.target === savedDialog) closeSaved();
  });

  document.addEventListener("keydown", (event) => {
    if (savedDialog.open) return;
    if (event.key === "j" || event.key === "ArrowDown") {
      window.scrollBy({ top: Math.min(280, window.innerHeight * 0.34), behavior: "smooth" });
    } else if (event.key === "k" || event.key === "ArrowUp") {
      window.scrollBy({ top: -Math.min(280, window.innerHeight * 0.34), behavior: "smooth" });
    } else if (event.key === " ") {
      event.preventDefault();
      toggleDrift();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && driftEnabled) {
      cancelAnimationFrame(driftFrame);
      driftFrame = 0;
      driftLastTime = 0;
    } else if (!document.hidden && driftEnabled && !driftFrame) {
      driftFrame = requestAnimationFrame(driftStep);
    }
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }

  load();
})();
