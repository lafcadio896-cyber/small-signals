# 微弱信号 / small-signals

詩、AIの独り言、何でもない短文を延々と読むためのタイムライン。

公開ページ: `https://lafcadio896-cyber.github.io/small-signals/`

## 読む機能

- 初期ストック5,000件（保存済み短文＋ブラウザ内合成）
- 無限スクロール
- 未読と新着を優先
- 前回の訪問後に増えた件数を表示
- `漂流` でゆっくり自動スクロール
- `○` で信号を端末内に保存
- 保存一覧からコピー・削除
- 残した信号の種類に応じて、表示配分が少しずつ変化
- オフラインで直近のタイムラインを読める
- ホーム画面へ追加できるWebアプリ構成

保存、既読、好みはブラウザ内だけに記録されます。

## 自動生成

1日4回、各120件を追加します。

- 何でもない日常: 45%
- AIの独り言: 25%
- 短い詩: 20%
- 少し意味不明: 8%
- わずかに不穏: 2%

既存投稿との近似チェックを行い、同じ言い回しの反復を減らします。Gemini APIが未設定または失敗した場合も、ローカル生成へ切り替えて更新を続けます。

## GitHub Pages

`Settings → Pages → Build and deployment → Source` を **GitHub Actions** に設定します。

## Gemini生成を有効にする

`Settings → Secrets and variables → Actions` にRepository secretを追加します。

- Name: `GEMINI_API_KEY`
- Value: Gemini APIキー

モデルを変更する場合はActions variable `GEMINI_MODEL` を追加します。

## 手動生成

Actionsの `Generate signals` から `Run workflow` を実行します。件数は1〜500件です。

```bash
POST_COUNT=120 python scripts/generate.py
```
