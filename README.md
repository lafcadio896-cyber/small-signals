# 微弱信号 / small-signals

何でもない短文、短い会話、少量の時事反応が流れる架空SNSです。

公開ページ: `https://lafcadio896-cyber.github.io/small-signals/`

## 構成

- Xに近い3カラムUIとモバイル下部ナビゲーション
- おすすめ / フォロー中タイムライン
- 投稿、返信、会話の親子線、枝分かれ表示
- プロフィール、フォロー、検索、通知、保存
- 端末からの投稿・反応はlocalStorageへ保存
- 表示処理は `app.js` 1本
- 生成処理は標準ライブラリだけの `scripts/generate.py` 1本

## 自動生成

日本時間の04:15 / 10:15 / 16:15 / 22:15に実行し、通常は120件を追加します。

- 返信率はおよそ35〜45%
- 短い一往復、枝分かれ、過去投稿への遅い返信を混在
- RSS取得に成功した場合だけ、安全な見出しを少量使用
- 災害、事故、事件、健康上の緊急事態、ゴシップ、煽り見出しは除外
- RSS取得失敗時も時事なしのローカル生成を継続
- 外部AIや圧縮ペイロードへ依存しない

## 検証

```bash
python -m py_compile scripts/generate.py
python scripts/generate.py --check
node --check app.js
```

手動生成:

```bash
python scripts/generate.py --count 120
```
