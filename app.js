(() => {
  "use strict";
  const fail = (error) => {
    console.error(error);
    const target = document.querySelector("#viewContent") || document.body;
    target.innerHTML = '<div class="empty-state"><h2>信号を展開できません</h2><p>ブラウザを更新してください。</p></div>';
  };
  (async () => {
    if (!("DecompressionStream" in window)) {
      throw new Error("This browser does not support DecompressionStream.");
    }
    const response = await fetch("./assets/app.v3.js.gz", { cache: "no-store" });
    if (!response.ok || !response.body) throw new Error(`Runtime HTTP ${response.status}`);
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    const code = await new Response(stream).text();
    (0, eval)(`${code}\n//# sourceURL=small-signals-v3.js`);
  })().catch(fail);
})();
