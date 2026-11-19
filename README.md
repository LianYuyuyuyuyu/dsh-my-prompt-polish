# dsh-my-prompt-polish

[中文](./README.zh.md) | English

A polish button in the DeepSeek Harness (DSH) composer.

Click it and the text in your input box is rewritten by the model, using **the rule you wrote yourself** in the plugin's settings page. Click it again and the draft goes back to exactly what you typed. Nothing is sent: the button only edits the draft, you still press Enter yourself.

## What it does

1. **One button, two states.** Idle it shows a sparkle icon. After a successful rewrite it turns into an undo icon — one click restores the original text. A third state appears while a request is in flight (spinner) and a fourth when something went wrong (warning icon, with the reason in the tooltip).
2. **Your rule, not a preset.** Settings → 提示词优化 (`Prompt polish`) has a text box holding the base rule. Whatever is in it is used as the system prompt on every call. There is a "restore default rule" button that puts back the built-in four-point Chinese rewriting rule.
3. **Your model, not a hardcoded one.** The model picker offers "follow the current session model" (the default) or any provider/model pair already configured in DSH. The plugin never asks for an API key of its own — it reuses the providers you already set up.
4. **It refuses to wreck your work.** It will not replace the draft if the draft changed while the request was running; it will not polish a draft that contains `@` references (replacing the whole draft would drop them); it will not restore "the original" if you have kept editing since the rewrite.

## Install

From GitHub:

```sh
dsh plugin --profile web add github:LianYuyuyuyuyu/dsh-my-prompt-polish
```

(`web` is the default profile name; put your own profile name there if the host uses a different one.) Then restart the host.

Or, if you have added this repository's `index.json` as a plugin market index source under **Plugins → Discover → Index sources**, install it from that list in one click.

## Use

1. Type something in the composer.
2. Click the sparkle icon.
3. The draft is replaced by the rewritten version. Click the undo icon to go back.

Settings live in **Settings → 提示词优化**: the base rule, the model, and the two file paths the plugin writes to.

## Files it writes

- `$DSH_HOME/prompt-polish/rule.md` — your base rule (`$DSH_HOME` defaults to `~/.dsh`).
- `$DSH_HOME/prompt-polish/config.json` — the chosen provider and model.

Both are per-user. Deleting them restores the defaults.

## Requirements

- DSH `>= 0.2.2-rc.1`. It needs the `conversation.input.left` and `settings.section` slots and the `llm` and `webServer` services.
- Some model configured in DSH. The plugin has no credentials of its own.

## Limits, stated plainly

- The rewrite is one model call, so it costs tokens and takes as long as your model takes.
- The button replaces the **whole draft**. That is why it refuses when the draft contains `@` references or images.
- Pretty much every rewrite is a full-length rewrite; very short drafts usually come back longer. That is the point, but it is not always what you want.

## License

BSD-3-Clause. See [LICENSE](./LICENSE).
