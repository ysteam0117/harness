import { Command } from "commander";

export function statusCommand(): Command {
  return new Command("status")
    .description("今のハーネスのバージョン・最新のバージョン・主な変更点を表示する")
    .action(() => {
      process.stderr.write("このコマンドは未実装です（Issue #35 で実装予定）\n");
      process.exitCode = 1;
    });
}
