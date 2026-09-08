# .claude/skills

このディレクトリはリポジトリ専用の Claude Code スキル置き場です。
Claude Code のセッション開始時に自動で読み込まれます（`/home/user/web` 配下で作業しているとき）。

## 導入済みスキル

| スキル | 提供元 | ライセンス | 取得元 |
|---|---|---|---|
| `frontend-design` | Anthropic | Apache-2.0 (`frontend-design/LICENSE.txt`) | [anthropics/skills](https://github.com/anthropics/skills) `skills/frontend-design` @ `41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f` |
| `ui-ux-pro-max` | NextLevelBuilder | MIT (`ui-ux-pro-max/LICENSE.txt`) | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) `.claude/skills/ui-ux-pro-max` @ `4aad0584d92131626b16d4ff4d77f0455385013c` |

いずれも上流をそのままコピーした vendored copy です。更新するときは上流から取り直し、
このファイルのコミットハッシュも合わせて書き換えてください。
