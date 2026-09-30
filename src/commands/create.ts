import { Command } from "commander";

export function createCommand(): Command {
  return new Command("create")
    .description("質問に答えて、プロジェクトを生成する")
    .option("--answers <file>", "質問への回答をまとめたファイルを指定する")
    .action(() => {
      process.stderr.write("このコマンドは未実装です（Issue #31〜#34 で実装予定）\n");
      process.exitCode = 1;
    });
}
