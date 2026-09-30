import { readFileSync } from "node:fs";
import { Command, Help } from "commander";
import { createCommand } from "./commands/create.js";
import { statusCommand } from "./commands/status.js";
import { updateCommand } from "./commands/update.js";

function readVersion(): string {
  const packageJson = new URL("../package.json", import.meta.url);
  const { version } = JSON.parse(readFileSync(packageJson, "utf8")) as { version: string };
  return version;
}

/** commander の英語のエラー文のうち、よく出るものを日本語にする（それ以外はそのまま出す） */
function translateError(message: string): string {
  return message
    .replace(/^error: unknown command '(.*)'/m, "エラー: 知らないコマンドです：$1")
    .replace(/^error: unknown option '(.*)'/m, "エラー: 知らないオプションです：$1")
    .replace(
      /^error: option '(.*)' argument missing/m,
      "エラー: オプションの値が指定されていません：$1",
    )
    .replace(/^error: (?!unknown)/m, "エラー: ");
}

/** 使い方の行・コマンドの一覧にある英語の置き場所の表記を日本語にする */
function translatePlaceholders(text: string): string {
  return text.replaceAll("[options]", "[オプション]").replaceAll("[command]", "[コマンド]");
}

export function createProgram(): Command {
  const program = new Command("harness");
  program
    .description("AI 開発ハーネスを作成・更新するコマンド")
    .version(readVersion(), "-v, --version", "バージョンを表示する")
    .helpOption("-h, --help", "使い方を表示する")
    .helpCommand("help [コマンド]", "コマンドの使い方を表示する")
    .configureOutput({
      outputError: (str, write) => write(translateError(str)),
    })
    .showHelpAfterError("（使い方は harness --help で確認できます）")
    .configureHelp({
      commandUsage(cmd) {
        return translatePlaceholders(Help.prototype.commandUsage.call(this, cmd));
      },
      subcommandTerm(cmd) {
        return translatePlaceholders(Help.prototype.subcommandTerm.call(this, cmd));
      },
      styleTitle: (title) => {
        const titles: Record<string, string> = {
          "Usage:": "使い方:",
          "Options:": "オプション:",
          "Commands:": "コマンド:",
          "Arguments:": "引数:",
        };
        return titles[title] ?? title;
      },
    });
  // ルートの設定（出力・exitOverride・見出しの日本語化など）を、実行するサブコマンドにも引き継ぐ。
  // 利用側が createProgram() の後にルートへ設定を足しても届くよう、実行の直前に写す。
  program.hook("preSubcommand", (root, subcommand) => {
    subcommand.copyInheritedSettings(root);
  });
  program.addCommand(createCommand());
  program.addCommand(updateCommand());
  program.addCommand(statusCommand());
  return program;
}
