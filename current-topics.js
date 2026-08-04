(() => {
  'use strict';

  const compact = (title) => {
    const value = String(title || '').replace(/[「」『』【】]/g, '').trim();
    const first = value.split(/[。！？!?：:]/)[0].trim();
    return (first || value).slice(0, 34);
  };

  const openTopic = (title) => {
    const query = compact(title);
    location.hash = '#/explore';
    let attempts = 0;
    const apply = () => {
      const input = document.querySelector('.explore-search input');
      if (!input && attempts++ < 20) return setTimeout(apply, 50);
      if (!input) return;
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    };
    setTimeout(apply, 0);
  };

  const render = (topics) => {
    const list = document.querySelector('#trendList');
    if (!list || !Array.isArray(topics) || !topics.length) return;
    list.replaceChildren();
    for (const topic of topics.slice(0, 5)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'trend-item current-topic';
      const small = document.createElement('small');
      small.textContent = `${topic.source || 'ニュース'} · いまの話題`;
      const strong = document.createElement('strong');
      strong.textContent = topic.title || '今日の話題';
      const span = document.createElement('span');
      span.textContent = '関連する投稿を表示';
      button.append(small, strong, span);
      button.addEventListener('click', () => openTopic(topic.title));
      list.append(button);
    }
  };

  fetch(`./data/topics.json?v=7-${Date.now()}`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`topics: ${response.status}`);
      return response.json();
    })
    .then((data) => render(data.topics))
    .catch(() => {});
})();
