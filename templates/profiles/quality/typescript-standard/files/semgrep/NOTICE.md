# .semgrep/ のルールの出どころ

このフォルダの `*.yaml` は、公開のルール集 semgrep/semgrep-rules（https://github.com/semgrep/semgrep-rules）から選んだもので、中身は変えていません。各ファイルの先頭に、元のファイルと版（コミット）を書いています。

ライセンスは、同じコミットの LICENSE のとおり、LGPL 2.1（GNU Lesser General Public License, Version 2.1）に、次の「Commons Clause」の条件を付けたものです。

> The Software is provided to you by the Licensor under the License, as defined below, subject to the following condition.
>
> Without limiting other conditions in the License, the grant of rights under the License will not include, and the License does not grant to you, the right to Sell the Software.
>
> For purposes of the foregoing, "Sell" means practicing any or all of the rights granted to you under the License to provide to third parties, for a fee or other consideration (including without limitation fees for hosting or consulting/ support services related to the Software), a product or service whose value derives, entirely or substantially, from the functionality of the Software. Any license notice or attribution required by the License must also include this Commons Clause License Condition notice.
>
> Software: semgrep-rules (https://github.com/semgrep/semgrep-rules)
> License: LGPL 2.1 (GNU Lesser General Public License, Version 2.1)
> Licensor: Semgrep, Inc. (https://semgrep.dev)

- ルールを足す・版を更新するときは、取り込む版のライセンスを確かめる。2024-12-13 より後の版は、ルールの配布を認めない別のライセンス（Semgrep Rules License v1.0）になっているため、取り込まない
- 誤検知は、ルールを書き換えず、該当の行に `// nosemgrep: <ルールの id> <理由>` を付けて抑える（理由は必須）。手順は docs/testing/security.md
