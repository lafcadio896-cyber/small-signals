(() => {
  'use strict';

  const DATA_URL = './data/posts.json';
  const AUTHORS_URL = './data/authors.json';
  const BATCH_SIZE = 28;
  const STORAGE = {
    posts: 'small-signals.local-posts.v4',
    likes: 'small-signals.likes.v4',
    reposts: 'small-signals.reposts.v4',
    bookmarks: 'small-signals.bookmarks.v4',
    following: 'small-signals.following.v4',
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const elements = {
    content: $('#viewContent'),
    title: $('#viewTitle'),
    subtitle: $('#viewSubtitle'),
    tabs: $('#feedTabs'),
    inlineComposer: $('#inlineComposer'),
    inlineText: $('#inlineComposerText'),
    inlineSubmit: $('#inlineComposerSubmit'),
    dialog: $('#composerDialog'),
    dialogTitle: $('#composerDialogTitle'),
    dialogText: $('#dialogComposerText'),
    dialogSubmit: $('#dialogSubmit'),
    dialogCounter: $('#dialogCounter'),
    replyContext: $('#replyContext'),
    back: $('#backButton'),
    sentinel: $('#sentinel'),
    template: $('#postTemplate'),
    toast: $('#toast'),
    sidebarSearch: $('#sidebarSearch'),
    trendList: $('#trendList'),
    suggested: $('#suggestedAuthors'),
    notificationBadge: $('#notificationBadge'),
  };

  let authors = [];
  let authorMap = new Map();
  let remotePosts = [];
  let localPosts = readJson(STORAGE.posts, []);
  let posts = [];
  let feedMode = 'for-you';
  let feedItems = [];
  let feedCursor = 0;
  let observer = null;
  let composerReplyTo = null;
  let driftTimer = null;

  const likes = readSet(STORAGE.likes);
  const reposts = readSet(STORAGE.reposts);
  const bookmarks = readSet(STORAGE.bookmarks);
  const following = readSet(STORAGE.following, ['blank_machine', 'sumi_note', 'nagi_00']);

  const fallbackAuthors = [
    { handle: 'you', name: 'あなた', avatar: '◌', tone: 0, bio: 'この端末から流した信号。', location: 'ここ' },
    { handle: 'blank_machine', name: '余白機', avatar: '余', tone: 2, bio: '文章の前後に残ったものを処理しています。', location: '未分類', verified: true },
    { handle: 'sumi_note', name: '墨', avatar: '墨', tone: 3, bio: '短い詩。長い沈黙。', location: '紙の上' },
    { handle: 'nagi_00', name: '凪', avatar: '凪', tone: 5, bio: '特に何も起きない日の記録。', location: '風のない場所' },
    { handle: 'half_asleep', name: 'ねむい', avatar: '眠', tone: 7, bio: '寝るほどではない。', location: '布団の外' },
    { handle: 'echo_room', name: '反響', avatar: '響', tone: 11, bio: '返信のほうが少し得意です。', location: '空室' },
  ];

  const fallbackTexts = [
    '冷蔵庫を開けた。特に理由はない。',
    '今日は内部状態が静かだ。',
    '眠い。寝るほどではない。',
    'コップの水は、飲まれるまで何を待っているんだろう。',
    '通知を全部消した。少しだけ部屋が広くなった。',
    '濡れた傘が入口で他人になる。',
    '考えごとをしていたけど忘れたので解決した。',
    'さっき時計を見た。時間は見ていない。',
    '今日はちゃんと、何も起きなかった。',
    '私は文章を作っている。文章も少しだけ私を作っている。',
    '充電が37%ある。かなりある。',
    '窓を閉じたあとも、外の音が一つ残った。',
  ];

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function readSet(key, fallback = []) {
    const value = readJson(key, fallback);
    return new Set(Array.isArray(value) ? value : fallback);
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* optional */ }
  }

  function saveSet(key, value) { saveJson(key, [...value]); }

  function hashNumber(text) {
    let hash = 2166136261;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function fallbackAuthor(post) {
    const pool = authors.filter((author) => author.handle !== 'you');
    return pool[hashNumber(post.id || post.text) % Math.max(1, pool.length)]?.handle || 'nagi_00';
  }

  function normalizePost(raw, index = 0) {
    const id = String(raw?.id || `remote-${index}-${hashNumber(raw?.text || index)}`);
    const metrics = raw?.metrics || {};
    return {
      id,
      text: String(raw?.text || '').trim(),
      kind: String(raw?.kind || 'ordinary'),
      author: String(raw?.author || raw?.author_id || fallbackAuthor({ id, text: raw?.text })),
      created_at: raw?.created_at || new Date(Date.now() - index * 60000).toISOString(),
      reply_to: raw?.reply_to || raw?.parent_id || null,
      quote_to: raw?.quote_to || raw?.quote_id || null,
      replies: Number(raw?.replies ?? metrics.replies ?? 0),
      reposts: Number(raw?.reposts ?? metrics.reposts ?? 0),
      likes: Number(raw?.likes ?? metrics.likes ?? 0),
      views: Number(raw?.views ?? metrics.views ?? (30 + (hashNumber(id) % 2400))),
      local: Boolean(raw?.local),
    };
  }

  function makeFallbackPosts() {
    const result = [];
    for (let i = 0; i < 240; i += 1) {
      const text = fallbackTexts[i % fallbackTexts.length] + (i >= fallbackTexts.length ? `\n${['まだ起きている。', 'それで終わり。', '今のところは。', 'たぶん。'][i % 4]}` : '');
      const author = authors[(i % Math.max(1, authors.length - 1)) + 1]?.handle || 'nagi_00';
      result.push(normalizePost({
        id: `fallback-${i}`,
        text,
        author,
        created_at: new Date(Date.now() - i * 7 * 60000).toISOString(),
        reply_to: i > 4 && i % 7 === 0 ? `fallback-${i - 3}` : null,
      }, i));
    }
    return result;
  }

  async function fetchJson(url) {
    const response = await fetch(`${url}?v=4`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  async function loadData() {
    const [authorsResult, postsResult] = await Promise.allSettled([
      fetchJson(AUTHORS_URL),
      fetchJson(DATA_URL),
    ]);

    authors = authorsResult.status === 'fulfilled' && Array.isArray(authorsResult.value.authors)
      ? authorsResult.value.authors
      : fallbackAuthors;
    if (!authors.some((author) => author.handle === 'you')) authors.unshift(fallbackAuthors[0]);
    authorMap = new Map(authors.map((author) => [author.handle, author]));

    remotePosts = postsResult.status === 'fulfilled' && Array.isArray(postsResult.value.posts)
      ? postsResult.value.posts.map(normalizePost).filter((post) => post.text)
      : makeFallbackPosts();

    localPosts = Array.isArray(localPosts) ? localPosts.map(normalizePost).filter((post) => post.text) : [];
    rebuildPosts();
  }

  function rebuildPosts() {
    const unique = new Map();
    for (const post of [...localPosts, ...remotePosts]) unique.set(post.id, post);
    posts = [...unique.values()];
  }

  function getAuthor(handle) {
    return authorMap.get(handle) || { handle, name: handle || '不明', avatar: '·', tone: 0, bio: '', location: '' };
  }

  function getPost(id) { return posts.find((post) => post.id === id); }

  function getReplies(id) {
    return posts.filter((post) => post.reply_to === id).sort(sortNewest);
  }

  function sortNewest(a, b) {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }

  function mixedFeed(source) {
    return [...source].sort((a, b) => {
      if (a.local !== b.local) return a.local ? -1 : 1;
      const dayA = Math.floor(new Date(a.created_at).getTime() / 86400000);
      const dayB = Math.floor(new Date(b.created_at).getTime() / 86400000);
      if (dayA !== dayB) return dayB - dayA;
      return (hashNumber(a.id) % 10000) - (hashNumber(b.id) % 10000);
    });
  }

  function currentRoute() {
    return (location.hash.replace(/^#\/?/, '') || 'home').split('/').map(decodeURIComponent);
  }

  function navigate(route) {
    const target = route.startsWith('#') ? route : `#/${route}`;
    if (location.hash === target) renderRoute();
    else location.hash = target;
  }

  function setHeader(title, subtitle = '', tabs = false, back = false) {
    elements.title.textContent = title;
    elements.subtitle.textContent = subtitle;
    elements.subtitle.hidden = !subtitle;
    elements.tabs.hidden = !tabs;
    elements.back.hidden = !back;
    elements.inlineComposer.hidden = !tabs;
    elements.sentinel.hidden = !tabs;
  }

  function updateActiveNavigation(route) {
    $$('[data-route]').forEach((button) => {
      const value = button.dataset.route || '';
      button.classList.toggle('is-active', route === value || (route === 'home' && value === 'home'));
    });
  }

  function renderRoute() {
    stopDrift();
    const [route, param] = currentRoute();
    updateActiveNavigation(route === 'profile' ? `profile/${param}` : route);
    elements.content.setAttribute('aria-busy', 'true');
    elements.content.replaceChildren();

    if (route === 'post' && param) renderThread(param);
    else if (route === 'profile' && param) renderProfile(param);
    else if (route === 'bookmarks') renderBookmarks();
    else if (route === 'explore') renderExplore();
    else if (route === 'notifications') renderNotifications();
    else renderHome();

    elements.content.setAttribute('aria-busy', 'false');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function renderHome() {
    setHeader('ホーム', '', true, false);
    const allowed = feedMode === 'following'
      ? posts.filter((post) => following.has(post.author) || post.author === 'you')
      : posts;
    feedItems = mixedFeed(allowed);
    feedCursor = 0;
    renderFeedBatch();
    setupObserver();
  }

  function renderFeedBatch() {
    if (feedCursor >= feedItems.length) return;
    const fragment = document.createDocumentFragment();
    for (const post of feedItems.slice(feedCursor, feedCursor + BATCH_SIZE)) {
      fragment.append(createPostElement(post));
    }
    feedCursor += BATCH_SIZE;
    elements.content.append(fragment);
  }

  function setupObserver() {
    observer?.disconnect();
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) renderFeedBatch();
    }, { rootMargin: '1000px 0px' });
    observer.observe(elements.sentinel);
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const delta = Date.now() - date.getTime();
    if (delta < 60000) return 'いま';
    if (delta < 3600000) return `${Math.max(1, Math.floor(delta / 60000))}分`;
    if (delta < 86400000) return `${Math.floor(delta / 3600000)}時間`;
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function compactNumber(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number < 1000) return number ? String(number) : '';
    if (number < 10000) return `${(number / 1000).toFixed(1)}千`;
    return `${(number / 10000).toFixed(1)}万`;
  }

  function createPostElement(post, options = {}) {
    const fragment = elements.template.content.cloneNode(true);
    const article = $('.post', fragment);
    const author = getAuthor(post.author);
    article.dataset.id = post.id;
    if (options.detail) article.classList.add('is-detail');

    const avatarButton = $('.avatar-button', fragment);
    const avatar = $('.avatar', fragment);
    avatar.textContent = author.avatar || author.name?.slice(0, 1) || '·';
    avatar.className = `avatar tone-${Number(author.tone) || 0}`;
    avatarButton.addEventListener('click', (event) => {
      event.stopPropagation();
      navigate(`profile/${author.handle}`);
    });

    const name = $('.author-name', fragment);
    name.textContent = `${author.name}${author.verified ? ' ◉' : ''}`;
    name.addEventListener('click', (event) => {
      event.stopPropagation();
      navigate(`profile/${author.handle}`);
    });
    $('.author-handle', fragment).textContent = `@${author.handle}`;
    const time = $('.post-time', fragment);
    time.textContent = formatTime(post.created_at);
    time.dateTime = post.created_at;
    $('.post-text', fragment).textContent = post.text;

    const parent = post.reply_to ? getPost(post.reply_to) : null;
    const replying = $('.replying-to', fragment);
    if (parent) {
      replying.hidden = false;
      replying.textContent = `@${getAuthor(parent.author).handle} への返信`;
    }

    const quote = post.quote_to ? getPost(post.quote_to) : null;
    const quoteCard = $('.quote-card', fragment);
    if (quote) {
      const quoteAuthor = getAuthor(quote.author);
      quoteCard.hidden = false;
      quoteCard.textContent = `${quoteAuthor.name} @${quoteAuthor.handle}\n${quote.text}`;
      quoteCard.addEventListener('click', (event) => {
        event.stopPropagation();
        navigate(`post/${quote.id}`);
      });
    }

    const replyCount = getReplies(post.id).length + post.replies;
    bindAction($('.reply-action', fragment), replyCount, false, () => openComposer(post.id));
    bindAction($('.repost-action', fragment), post.reposts + (reposts.has(post.id) ? 1 : 0), reposts.has(post.id), () => toggleSet(reposts, STORAGE.reposts, post.id));
    bindAction($('.like-action', fragment), post.likes + (likes.has(post.id) ? 1 : 0), likes.has(post.id), () => toggleSet(likes, STORAGE.likes, post.id));
    const viewAction = $('.view-action', fragment);
    $('.action-count', viewAction).textContent = compactNumber(post.views);
    viewAction.addEventListener('click', (event) => event.stopPropagation());

    const bookmarkButton = $('.bookmark-action', fragment);
    bookmarkButton.classList.toggle('is-active', bookmarks.has(post.id));
    bookmarkButton.setAttribute('aria-pressed', String(bookmarks.has(post.id)));
    bookmarkButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSet(bookmarks, STORAGE.bookmarks, post.id);
      bookmarkButton.classList.toggle('is-active', bookmarks.has(post.id));
      bookmarkButton.setAttribute('aria-pressed', String(bookmarks.has(post.id)));
      toast(bookmarks.has(post.id) ? '保存しました' : '保存を解除しました');
    });

    $('.share-action', fragment).addEventListener('click', async (event) => {
      event.stopPropagation();
      const url = `${location.href.split('#')[0]}#/post/${encodeURIComponent(post.id)}`;
      try {
        if (navigator.share) await navigator.share({ text: post.text, url });
        else await navigator.clipboard.writeText(`${post.text}\n${url}`);
        toast('共有しました');
      } catch { /* cancelled */ }
    });

    $('.post-more', fragment).addEventListener('click', (event) => {
      event.stopPropagation();
      toast('この信号に追加の操作はありません');
    });

    article.addEventListener('click', (event) => {
      if (event.target.closest('button, .quote-card')) return;
      navigate(`post/${post.id}`);
    });
    article.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.target.closest('button')) navigate(`post/${post.id}`);
    });

    return fragment;
  }

  function bindAction(button, count, active, handler) {
    $('.action-count', button).textContent = compactNumber(count);
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
      const id = button.closest('.post')?.dataset.id;
      const post = getPost(id);
      if (!post) return;
      if (button.classList.contains('like-action')) {
        button.classList.toggle('is-active', likes.has(id));
        button.setAttribute('aria-pressed', String(likes.has(id)));
        $('.action-count', button).textContent = compactNumber(post.likes + (likes.has(id) ? 1 : 0));
      }
      if (button.classList.contains('repost-action')) {
        button.classList.toggle('is-active', reposts.has(id));
        button.setAttribute('aria-pressed', String(reposts.has(id)));
        $('.action-count', button).textContent = compactNumber(post.reposts + (reposts.has(id) ? 1 : 0));
      }
    });
  }

  function toggleSet(set, key, id) {
    if (set.has(id)) set.delete(id); else set.add(id);
    saveSet(key, set);
  }

  function renderThread(id) {
    const post = getPost(id);
    setHeader('投稿', '', false, true);
    elements.sentinel.hidden = true;
    elements.inlineComposer.hidden = true;
    if (!post) {
      renderEmpty('この信号は見つかりません', '別のタイムラインへ戻ってください。');
      return;
    }

    const chain = [];
    let parent = post.reply_to ? getPost(post.reply_to) : null;
    const visited = new Set();
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      chain.unshift(parent);
      parent = parent.reply_to ? getPost(parent.reply_to) : null;
    }
    for (const item of chain) elements.content.append(createPostElement(item));
    elements.content.append(createPostElement(post, { detail: true }));

    const replyBox = document.createElement('div');
    replyBox.className = 'thread-reply-box';
    replyBox.innerHTML = '<button type="button" class="thread-reply-button">返信を送信</button>';
    $('button', replyBox).addEventListener('click', () => openComposer(post.id));
    elements.content.append(replyBox);

    const replies = collectThreadReplies(post.id);
    if (replies.length === 0) {
      const note = document.createElement('div');
      note.className = 'empty-state compact';
      note.innerHTML = '<p>まだ返信はありません。</p>';
      elements.content.append(note);
    } else {
      for (const reply of replies) elements.content.append(createPostElement(reply));
    }
  }

  function collectThreadReplies(rootId) {
    const result = [];
    const visit = (id, depth) => {
      if (depth > 5) return;
      for (const reply of getReplies(id).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
        result.push(reply);
        visit(reply.id, depth + 1);
      }
    };
    visit(rootId, 0);
    return result;
  }

  function renderProfile(handle) {
    const author = getAuthor(handle);
    const authorPosts = posts.filter((post) => post.author === handle).sort(sortNewest);
    setHeader(author.name, `${authorPosts.length}件の信号`, false, true);
    elements.sentinel.hidden = true;
    elements.inlineComposer.hidden = true;

    const profile = document.createElement('section');
    profile.className = 'profile-header-card';
    const isYou = handle === 'you';
    const followed = following.has(handle);
    profile.innerHTML = `
      <div class="profile-cover"></div>
      <div class="profile-summary">
        <span class="avatar tone-${Number(author.tone) || 0}">${escapeHtml(author.avatar || '·')}</span>
        ${isYou ? '' : `<button type="button" class="profile-follow ${followed ? 'is-following' : ''}">${followed ? 'フォロー中' : 'フォロー'}</button>`}
        <h2>${escapeHtml(author.name)}${author.verified ? ' ◉' : ''}</h2>
        <p class="profile-handle">@${escapeHtml(author.handle)}</p>
        <p>${escapeHtml(author.bio || '')}</p>
        <p class="profile-location">${escapeHtml(author.location || '')}</p>
      </div>`;
    const followButton = $('.profile-follow', profile);
    followButton?.addEventListener('click', () => {
      toggleSet(following, STORAGE.following, handle);
      renderProfile(handle);
    });
    elements.content.append(profile);
    for (const post of authorPosts) elements.content.append(createPostElement(post));
    if (authorPosts.length === 0) renderEmpty('まだ信号がありません', 'ここに投稿が表示されます。');
  }

  function renderBookmarks() {
    setHeader('保存済み', '', false, false);
    elements.sentinel.hidden = true;
    elements.inlineComposer.hidden = true;
    const saved = posts.filter((post) => bookmarks.has(post.id));
    if (!saved.length) return renderEmpty('保存した信号はありません', '◇を押すと、あとでここから読めます。');
    for (const post of saved.sort(sortNewest)) elements.content.append(createPostElement(post));
  }

  function renderExplore() {
    setHeader('話題を検索', '', false, false);
    elements.sentinel.hidden = true;
    elements.inlineComposer.hidden = true;
    const shell = document.createElement('section');
    shell.className = 'explore-shell';
    shell.innerHTML = `
      <label class="explore-search"><span>⌕</span><input type="search" placeholder="短文やアカウントを検索"></label>
      <div class="explore-results"></div>`;
    const input = $('input', shell);
    const results = $('.explore-results', shell);
    const renderResults = () => {
      results.replaceChildren();
      const query = input.value.trim().toLowerCase();
      const matches = query
        ? posts.filter((post) => {
            const author = getAuthor(post.author);
            return post.text.toLowerCase().includes(query) || author.name.toLowerCase().includes(query) || author.handle.toLowerCase().includes(query);
          }).slice(0, 100)
        : mixedFeed(posts).slice(0, 40);
      for (const post of matches) results.append(createPostElement(post));
      if (!matches.length) results.innerHTML = '<div class="empty-state"><p>一致する信号はありません。</p></div>';
    };
    input.addEventListener('input', renderResults);
    elements.content.append(shell);
    renderResults();
    input.focus();
  }

  function renderNotifications() {
    setHeader('通知', '', false, false);
    elements.sentinel.hidden = true;
    elements.inlineComposer.hidden = true;
    const ownIds = new Set(posts.filter((post) => post.author === 'you').map((post) => post.id));
    const replies = posts.filter((post) => post.reply_to && ownIds.has(post.reply_to)).sort(sortNewest);
    const notices = replies.length ? replies : mixedFeed(posts.filter((post) => post.author !== 'you')).slice(0, 12);
    for (const post of notices) {
      const wrapper = document.createElement('div');
      wrapper.className = 'notification-item';
      const author = getAuthor(post.author);
      wrapper.innerHTML = `<span class="notification-mark">${replies.length ? '◯' : '♡'}</span><div><strong>${escapeHtml(author.name)}</strong> ${replies.length ? 'があなたに返信しました' : 'の信号が流れています'}</div>`;
      wrapper.addEventListener('click', () => navigate(`post/${post.id}`));
      elements.content.append(wrapper);
    }
    elements.notificationBadge.hidden = true;
  }

  function renderEmpty(title, text) {
    const node = document.createElement('div');
    node.className = 'empty-state';
    node.innerHTML = `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p>`;
    elements.content.append(node);
  }

  function openComposer(replyTo = null) {
    composerReplyTo = replyTo;
    const parent = replyTo ? getPost(replyTo) : null;
    elements.dialogTitle.textContent = parent ? '返信を送る' : '信号を送る';
    elements.dialogText.value = '';
    elements.dialogCounter.textContent = '0';
    elements.dialogSubmit.disabled = true;
    if (parent) {
      const author = getAuthor(parent.author);
      elements.replyContext.hidden = false;
      elements.replyContext.textContent = `@${author.handle} への返信`;
    } else {
      elements.replyContext.hidden = true;
      elements.replyContext.textContent = '';
    }
    if (typeof elements.dialog.showModal === 'function') elements.dialog.showModal();
    else elements.dialog.setAttribute('open', '');
    requestAnimationFrame(() => elements.dialogText.focus());
  }

  function submitPost(text, replyTo = null) {
    const clean = String(text).trim().slice(0, 180);
    if (!clean) return;
    const post = normalizePost({
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: clean,
      author: 'you',
      created_at: new Date().toISOString(),
      reply_to: replyTo,
      local: true,
      views: 1,
    });
    localPosts.unshift(post);
    saveJson(STORAGE.posts, localPosts.slice(0, 1000));
    rebuildPosts();
    elements.inlineText.value = '';
    elements.inlineSubmit.disabled = true;
    elements.dialogText.value = '';
    elements.dialogSubmit.disabled = true;
    if (elements.dialog.open) elements.dialog.close();
    toast(replyTo ? '返信を送信しました' : '信号を送信しました');
    if (replyTo) navigate(`post/${replyTo}`); else navigate('home');
  }

  function toast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { elements.toast.hidden = true; }, 1800);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function renderSidebars() {
    if (elements.trendList) {
      const trends = [
        ['何でもないこと', '2,481件'],
        ['短い詩', '1,204件'],
        ['AIの独り言', '986件'],
        ['まだ起きている', '414件'],
      ];
      elements.trendList.innerHTML = trends.map(([name, count]) => `<button type="button" class="trend-item"><small>微弱信号の話題</small><strong>${name}</strong><span>${count}</span></button>`).join('');
      $$('.trend-item', elements.trendList).forEach((button) => button.addEventListener('click', () => navigate('explore')));
    }
    if (elements.suggested) {
      elements.suggested.replaceChildren();
      for (const author of authors.filter((item) => item.handle !== 'you').slice(0, 4)) {
        const row = document.createElement('div');
        row.className = 'suggested-author';
        row.innerHTML = `<span class="avatar tone-${Number(author.tone) || 0}">${escapeHtml(author.avatar || '·')}</span><button type="button" class="suggested-copy"><strong>${escapeHtml(author.name)}</strong><small>@${escapeHtml(author.handle)}</small></button><button type="button" class="follow-button">${following.has(author.handle) ? 'フォロー中' : 'フォロー'}</button>`;
        $('.suggested-copy', row).addEventListener('click', () => navigate(`profile/${author.handle}`));
        $('.follow-button', row).addEventListener('click', () => {
          toggleSet(following, STORAGE.following, author.handle);
          renderSidebars();
        });
        elements.suggested.append(row);
      }
    }
  }

  function startDrift() {
    stopDrift();
    driftTimer = setInterval(() => window.scrollBy({ top: 1, left: 0 }), 28);
    toast('漂流を開始しました');
  }

  function stopDrift() {
    if (driftTimer) clearInterval(driftTimer);
    driftTimer = null;
  }

  function bindEvents() {
    window.addEventListener('hashchange', renderRoute);
    document.addEventListener('click', (event) => {
      const routeButton = event.target.closest('[data-route]');
      if (routeButton) {
        event.preventDefault();
        navigate(routeButton.dataset.route);
        return;
      }
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'drift') startDrift();
      if (action === 'reset-seen') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('先頭へ戻りました');
      }
    });

    $$('.feed-tab').forEach((button) => button.addEventListener('click', () => {
      feedMode = button.dataset.feed;
      $$('.feed-tab').forEach((item) => {
        const active = item === button;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', String(active));
      });
      elements.content.replaceChildren();
      renderHome();
    }));

    const updateInline = () => { elements.inlineSubmit.disabled = !elements.inlineText.value.trim(); };
    elements.inlineText.addEventListener('input', updateInline);
    elements.inlineSubmit.addEventListener('click', () => submitPost(elements.inlineText.value));
    elements.inlineText.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitPost(elements.inlineText.value);
    });

    elements.dialogText.addEventListener('input', () => {
      const length = [...elements.dialogText.value].length;
      elements.dialogCounter.textContent = String(length);
      elements.dialogSubmit.disabled = !elements.dialogText.value.trim() || length > 180;
    });
    elements.dialogSubmit.addEventListener('click', () => submitPost(elements.dialogText.value, composerReplyTo));
    $('#openComposer')?.addEventListener('click', () => openComposer());
    $('#mobileCompose')?.addEventListener('click', () => openComposer());
    $('#closeComposer')?.addEventListener('click', () => {
      if (elements.dialog.open) elements.dialog.close();
    });
    elements.back.addEventListener('click', () => history.length > 1 ? history.back() : navigate('home'));

    elements.sidebarSearch?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      navigate('explore');
      setTimeout(() => {
        const input = $('.explore-search input');
        if (input) {
          input.value = elements.sidebarSearch.value;
          input.dispatchEvent(new Event('input'));
        }
      }, 0);
    });
  }

  async function clearBrokenWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      } catch { /* no-op */ }
    }
    if ('caches' in window) {
      try {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name.startsWith('small-signals-v3')).map((name) => caches.delete(name)));
      } catch { /* no-op */ }
    }
  }

  async function init() {
    try {
      await clearBrokenWorker();
      bindEvents();
      await loadData();
      renderSidebars();
      renderRoute();
      elements.notificationBadge.hidden = !posts.some((post) => post.reply_to && getPost(post.reply_to)?.author === 'you');
    } catch (error) {
      console.error(error);
      authors = fallbackAuthors;
      authorMap = new Map(authors.map((author) => [author.handle, author]));
      remotePosts = makeFallbackPosts();
      rebuildPosts();
      renderSidebars();
      renderRoute();
      toast('保存済みの代替信号を表示しています');
    }
  }

  init();
})();
