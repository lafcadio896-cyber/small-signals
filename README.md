# 微弱信号 / small-signals

詩、AIの独り言、何でもない短文を延々と読むための小さなタイムライン。

- 初期ストック: 5,000件（保存済み短文＋ブラウザ内合成）
- 無限スクロール
- 既読を優先的に避ける（ブラウザ内保存）
- 気に入った信号を端末内に残せる
- 1日4回、各120件を自動追加
- Gemini APIが未設定・失敗時もローカル生成へ自動フォールバック

## GitHub Pages

`Settings → Pages → Build and deployment → Source` を **GitHub Actions** に設定すると、`Deploy Pages` ワークフローから公開されます。

想定URL:

`https://lafcadio896-cyber.github.io/small-signals/`

## AI生成を有効にする

リポジトリの `Settings → Secrets and variables → Actions` でRepository secretを追加します。

- Name: `GEMINI_API_KEY`
- Value: Gemini APIキー

モデルを変更する場合はActions variableとして `GEMINI_MODEL` を追加してください。未設定時は `gemini-3.5-flash-lite` を使います。

APIキーがなくても、自動生成自体は止まりません。

## 手動生成

Actionsの `Generate signals` から `Run workflow` を実行します。件数は1〜500件です。

ローカルでは次のように実行できます。

```bash
POST_COUNT=120 python scripts/generate.py
```
