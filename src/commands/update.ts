import { Command } from "commander";

export function updateCommand(): Command {
  return new Command("update")
    .description("生成済みのプロジェクトに、新しいハーネスを反映する")
    .action(() => {
      process.stderr.write("このコマンドは未実装です（Issue #35 で実装予定）\n");
      process.exitCode = 1;
    });
}
