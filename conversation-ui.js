(() => {
  'use strict';

  const DATA_URL = './data/posts.json';
  const AUTHORS_URL = './data/authors.json';
  const LOCAL_POSTS_KEY = 'small-signals.local-posts.v4';
  const FOLLOWING_KEY = 'small-signals.following.v4';
  const VERSION = '6';

  const state = {
    remotePosts: [],
    authors: [],
    authorMap: new Map(),
    posts: [],
    postMap: new Map(),
    actionProxies: new Map(),
    ready: false,
    rendering: false,
    scheduled: false,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function readFollowing() {
    const values = readJson(FOLLOWING_KEY, []);
    return new Set(Array.isArray(values) ? values : []);
  }

  function normalizePost(raw, index = 0) {
    const id = String(raw?.id || `post-${index}`);
    const metrics = raw?.metrics || {};
    return {
      id,
      text: String(raw?.text || '').trim(),
      author: String(raw?.author || raw?.author_id || 'nagi_00'),
      created_at: raw?.created_at || new Date(Date.now() - index * 60000).toISOString(),
      reply_to: raw?.reply_to || raw?.parent_id || null,
      quote_to: raw?.quote_to || raw?.quote_id || null,
      replies: Number(raw?.replies ?? metrics.replies ?? 0),
      reposts: Number(raw?.reposts ?? metrics.reposts ?? 0),
      likes: Number(raw?.likes ?? metrics.likes ?? 0),
      views: Number(raw?.views ?? metrics.views ?? 0),
      local: Boolean(raw?.local),
    };
  }

  function refreshPosts() {
    const local = readJson(LOCAL_POSTS_KEY, []);
    const normalizedLocal = Array.isArray(local)
      ? local.map(normalizePost).filter((post) => post.text)
      : [];
    const unique = new Map();
    for (const post of [...normalizedLocal, ...state.remotePosts]) unique.set(post.id, post);
    state.posts = [...unique.values()];
    state.postMap = unique;
  }

  function getPost(id) {
    return state.postMap.get(String(id));
  }

  function getAuthor(handle) {
    return state.authorMap.get(handle) || {
      handle: handle || 'unknown',
      name: handle || '不明',
      avatar: '·',
      tone: 0,
      verified: false,
    };
  }

  function directReplies(id) {
    return state.posts.filter((post) => post.reply_to === id);
  }

  function directReplyCount(post) {
    return Math.max(Number(post?.replies) || 0, directReplies(post.id).length);
  }

  function descendantCount(id, visited = new Set()) {
    if (visited.has(id)) return 0;
    visited.add(id);
    let count = 0;
    for (const reply of directReplies(id)) {
      count += 1 + descendantCount(reply.id, visited);
    }
    return count;
  }

  function route() {
    return (location.hash.replace(/^#\/?/, '') || 'home').split('/').map(decodeURIComponent);
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

  function formatFullTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(date);
  }

  function compactNumber(value) {
    const number = Math.max(0, Number(value) || 0);
    if (number < 1000) return number ? String(number) : '';
    if (number < 10000) return `${(number / 1000).toFixed(1)}千`;
    return `${(number / 10000).toFixed(1)}万`;
  }

  async function loadData() {
    const [authorsResult, postsResult] = await Promise.allSettled([
      fetch(`${AUTHORS_URL}?v=${VERSION}`, { cache: 'no-store' }).then((response) => {
        if (!response.ok) throw new Error(`authors: ${response.status}`);
        return response.json();
      }),
      fetch(`${DATA_URL}?v=${VERSION}`, { cache: 'no-store' }).then((response) => {
        if (!response.ok) throw new Error(`posts: ${response.status}`);
        return response.json();
      }),
    ]);

    if (authorsResult.status === 'fulfilled' && Array.isArray(authorsResult.value.authors)) {
      state.authors = authorsResult.value.authors;
      state.authorMap = new Map(state.authors.map((author) => [author.handle, author]));
    }
    if (postsResult.status === 'fulfilled' && Array.isArray(postsResult.value.posts)) {
      state.remotePosts = postsResult.value.posts.map(normalizePost).filter((post) => post.text);
    }
    refreshPosts();
    state.ready = true;
  }

  function captureActionProxies(root) {
    for (const article of $$('.post[data-id]', root)) {
      const id = article.dataset.id;
      if (!id) continue;
      state.actionProxies.set(id, {
        reply: $('.reply-action', article),
        repost: $('.repost-action', article),
        like: $('.like-action', article),
        bookmark: $('.bookmark-action', article),
        share: $('.share-action', article),
      });
    }
  }

  function runProxy(id, action) {
    const target = state.actionProxies.get(id)?.[action];
    if (target) {
      target.click();
      return true;
    }
    return false;
  }

  function navigate(path) {
    location.hash = `#/${path}`;
  }

  function createCard(post, options = {}) {
    const template = $('#postTemplate');
    const article = template.content.firstElementChild.cloneNode(true);
    const author = getAuthor(post.author);
    article.dataset.id = post.id;
    article.classList.add('x-post-card');
    if (options.ancestor) article.classList.add('x-thread-ancestor');
    if (options.focal) article.classList.add('x-focal-post', 'is-focal');
    if (options.reply) article.classList.add('x-thread-reply');

    const avatarButton = $('.avatar-button', article);
    const avatar = $('.avatar', article);
    avatar.textContent = author.avatar || author.name?.slice(0, 1) || '·';
    avatar.className = `avatar tone-${Number(author.tone) || 0}`;
    avatarButton.addEventListener('click', (event) => {
      event.stopPropagation();
      navigate(`profile/${author.handle}`);
    });

    const name = $('.author-name', article);
    name.textContent = author.name || author.handle;
    if (author.verified) {
      const verified = document.createElement('span');
      verified.className = 'x-verified';
      verified.textContent = '✓';
      name.append(verified);
    }
    name.addEventListener('click', (event) => {
      event.stopPropagation();
      navigate(`profile/${author.handle}`);
    });
    $('.author-handle', article).textContent = `@${author.handle}`;
    const time = $('.post-time', article);
    time.textContent = formatTime(post.created_at);
    time.dateTime = post.created_at;
    $('.post-text', article).textContent = post.text;

    const parent = post.reply_to ? getPost(post.reply_to) : null;
    const replying = $('.replying-to', article);
    if (parent) {
      const parentAuthor = getAuthor(parent.author);
      replying.hidden = false;
      replying.innerHTML = '返信先: ';
      const handle = document.createElement('span');
      handle.textContent = `@${parentAuthor.handle}`;
      replying.append(handle);
    }

    const quote = post.quote_to ? getPost(post.quote_to) : null;
    const quoteCard = $('.quote-card', article);
    if (quote) {
      const quoteAuthor = getAuthor(quote.author);
      quoteCard.hidden = false;
      quoteCard.innerHTML = '';
      const meta = document.createElement('div');
      meta.className = 'quote-meta';
      meta.textContent = `${quoteAuthor.name} @${quoteAuthor.handle}`;
      const text = document.createElement('div');
      text.textContent = quote.text;
      quoteCard.append(meta, text);
      quoteCard.addEventListener('click', (event) => {
        event.stopPropagation();
        navigate(`post/${quote.id}`);
      });
    }

    const actions = {
      reply: $('.reply-action', article),
      repost: $('.repost-action', article),
      like: $('.like-action', article),
      bookmark: $('.bookmark-action', article),
      share: $('.share-action', article),
    };
    $('.action-count', actions.reply).textContent = compactNumber(directReplyCount(post));
    $('.action-count', actions.repost).textContent = compactNumber(post.reposts);
    $('.action-count', actions.like).textContent = compactNumber(post.likes);
    $('.action-count', $('.view-action', article)).textContent = compactNumber(post.views);

    for (const [action, button] of Object.entries(actions)) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!runProxy(post.id, action) && action === 'reply') openFallbackReply(post);
      });
    }
    $('.view-action', article).addEventListener('click', (event) => event.stopPropagation());
    $('.post-more', article).addEventListener('click', (event) => event.stopPropagation());

    article.addEventListener('click', (event) => {
      if (event.target.closest('button, .quote-card')) return;
      navigate(`post/${post.id}`);
    });
    article.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.target.closest('button')) navigate(`post/${post.id}`);
    });
    return article;
  }

  function ancestorChain(post) {
    const result = [];
    const visited = new Set([post.id]);
    let current = post.reply_to ? getPost(post.reply_to) : null;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      result.unshift(current);
      current = current.reply_to ? getPost(current.reply_to) : null;
    }
    return result;
  }

  function rankReplies(rootPost, replies) {
    const following = readFollowing();
    return [...replies].sort((a, b) => {
      const aOriginal = a.author === rootPost.author ? 1 : 0;
      const bOriginal = b.author === rootPost.author ? 1 : 0;
      if (aOriginal !== bOriginal) return bOriginal - aOriginal;
      const aFollowed = following.has(a.author) ? 1 : 0;
      const bFollowed = following.has(b.author) ? 1 : 0;
      if (aFollowed !== bFollowed) return bFollowed - aFollowed;
      if (a.likes !== b.likes) return b.likes - a.likes;
      return new Date(a.created_at) - new Date(b.created_at);
    });
  }

  function createBranch(post, rootPost, depth = 0) {
    const branch = document.createElement('section');
    branch.className = 'x-reply-branch';
    branch.style.setProperty('--branch-indent', `${Math.min(depth, 3) * 22}px`);
    branch.append(createCard(post, { reply: true }));

    const children = rankReplies(rootPost, directReplies(post.id));
    if (children.length) {
      const childCount = descendantCount(post.id);
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'x-show-replies';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = `<span class="x-branch-knot" aria-hidden="true"></span><span>返信を表示（${childCount}件）</span>`;

      const childContainer = document.createElement('div');
      childContainer.className = 'x-branch-children';
      childContainer.hidden = true;
      let built = false;
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        toggle.lastElementChild.textContent = open ? `返信を表示（${childCount}件）` : '返信を隠す';
        childContainer.hidden = open;
        if (!built) {
          for (const child of children) childContainer.append(createBranch(child, rootPost, depth + 1));
          built = true;
        }
      });
      branch.append(toggle, childContainer);
    }
    return branch;
  }

  function createDetailMeta(post) {
    const meta = document.createElement('div');
    meta.className = 'x-detail-meta';
    const views = Number(post.views) || 0;
    meta.innerHTML = `<span>${formatFullTime(post.created_at)}</span>${views ? `<span>·</span><strong>${compactNumber(views)}</strong><span> 件の表示</span>` : ''}`;
    return meta;
  }

  function renderConversation(id) {
    if (!state.ready || state.rendering) return;
    refreshPosts();
    const post = getPost(id);
    if (!post) return;

    const content = $('#viewContent');
    if (!content || content.querySelector('.x-conversation-view')) return;
    state.rendering = true;
    captureActionProxies(content);

    const view = document.createElement('div');
    view.className = 'x-conversation-view';
    const ancestors = ancestorChain(post);
    for (const ancestor of ancestors) view.append(createCard(ancestor, { ancestor: true }));

    const focal = createCard(post, { focal: true });
    const main = $('.post-main', focal);
    main.insertBefore(createDetailMeta(post), $('.post-actions', focal));
    view.append(focal);

    const replyBox = document.createElement('div');
    replyBox.className = 'x-reply-composer';
    replyBox.innerHTML = '<span class="avatar tone-0">◌</span><button type="button">返信をポスト</button>';
    $('button', replyBox).addEventListener('click', () => {
      if (!runProxy(post.id, 'reply')) openFallbackReply(post);
    });
    view.append(replyBox);

    const direct = rankReplies(post, directReplies(post.id));
    if (direct.length) {
      const divider = document.createElement('div');
      divider.className = 'x-replies-divider';
      divider.textContent = `${direct.length}件の返信`;
      view.append(divider);
      for (const reply of direct) view.append(createBranch(reply, post));
    } else {
      const empty = document.createElement('div');
      empty.className = 'x-no-replies';
      empty.innerHTML = '<strong>まだ返信はありません</strong><span>最初の返信を送ってみましょう。</span>';
      view.append(empty);
    }

    content.replaceChildren(view);
    state.rendering = false;
  }

  function enhanceTimeline(root) {
    if (!state.ready) return;
    refreshPosts();
    captureActionProxies(root);
    for (const article of $$('.post[data-id]:not(.x-timeline-enhanced)', root)) {
      const post = getPost(article.dataset.id);
      if (!post) continue;
      article.classList.add('x-timeline-enhanced');

      const replyButton = $('.reply-action', article);
      const count = directReplyCount(post);
      if (replyButton) $('.action-count', replyButton).textContent = compactNumber(count);

      if (!post.reply_to) continue;
      const parent = getPost(post.reply_to);
      if (!parent) continue;
      const parentAuthor = getAuthor(parent.author);
      const replying = $('.replying-to', article);
      if (replying) {
        replying.hidden = false;
        replying.innerHTML = '返信先: ';
        const handle = document.createElement('span');
        handle.textContent = `@${parentAuthor.handle}`;
        replying.append(handle);
      }

      const context = document.createElement('button');
      context.type = 'button';
      context.className = 'x-conversation-link';
      const repliesBelow = descendantCount(post.id);
      context.textContent = repliesBelow ? `この会話を表示 · 続き${repliesBelow}件` : 'この会話を表示';
      context.addEventListener('click', (event) => {
        event.stopPropagation();
        navigate(`post/${post.id}`);
      });
      const actions = $('.post-actions', article);
      actions?.before(context);
    }
  }

  function openFallbackReply(parent) {
    let dialog = $('#xReplyDialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'xReplyDialog';
      dialog.className = 'x-reply-dialog';
      dialog.innerHTML = `
        <form method="dialog">
          <div class="x-reply-dialog-head"><button value="cancel" type="submit">キャンセル</button><strong>返信</strong><button class="x-reply-send" type="button" disabled>返信</button></div>
          <div class="x-reply-dialog-context"></div>
          <textarea maxlength="180" rows="6" placeholder="返信をポスト"></textarea>
        </form>`;
      document.body.append(dialog);
    }
    const author = getAuthor(parent.author);
    const context = $('.x-reply-dialog-context', dialog);
    const textarea = $('textarea', dialog);
    const send = $('.x-reply-send', dialog);
    context.textContent = `@${author.handle} さんに返信`;
    textarea.value = '';
    send.disabled = true;
    textarea.oninput = () => { send.disabled = !textarea.value.trim(); };
    send.onclick = () => {
      const text = textarea.value.trim().slice(0, 180);
      if (!text) return;
      const local = readJson(LOCAL_POSTS_KEY, []);
      const newPost = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        author: 'you',
        created_at: new Date().toISOString(),
        reply_to: parent.id,
        local: true,
        views: 1,
      };
      const next = [newPost, ...(Array.isArray(local) ? local : [])].slice(0, 1000);
      localStorage.setItem(LOCAL_POSTS_KEY, JSON.stringify(next));
      dialog.close();
      location.reload();
    };
    dialog.showModal();
    requestAnimationFrame(() => textarea.focus());
  }

  function scheduleEnhancement() {
    if (state.scheduled) return;
    state.scheduled = true;
    setTimeout(() => {
      state.scheduled = false;
      if (!state.ready) return;
      const content = $('#viewContent');
      if (!content) return;
      const [name, id] = route();
      if (name === 'post' && id) renderConversation(id);
      else enhanceTimeline(content);
    }, 30);
  }

  function observe() {
    const content = $('#viewContent');
    if (!content) return;
    const observer = new MutationObserver(() => scheduleEnhancement());
    observer.observe(content, { childList: true, subtree: true });
    window.addEventListener('hashchange', scheduleEnhancement);
    scheduleEnhancement();
  }

  async function init() {
    observe();
    await loadData();
    scheduleEnhancement();
  }

  init().catch((error) => console.error('conversation-ui', error));
})();