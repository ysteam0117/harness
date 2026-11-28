import path from "node:path";
import ts from "typescript";
import { afterAll, expect, it } from "vitest";
import { buildProject } from "../../src/generate/project.js";
import { cleanupProjectTmp, contentOf, projectInput } from "./project-helpers.js";

afterAll(cleanupProjectTmp);

const examplePath = "frontend/src/rules-examples/async-query.test.tsx";

// ハーネスには画面用の依存が無いため、例で使う型だけを用意する。
const exampleDependencyTypes = `
declare module "react" {
  export function useState<T>(initial: T): [T, (value: T) => void];
  export function useEffect(effect: () => void, deps: readonly unknown[]): void;
}
declare module "react/jsx-runtime" {
  export namespace JSX {
    interface Element {}
    interface IntrinsicElements {
      a: { href?: string; children: string };
    }
  }
}
declare module "@testing-library/react" {
  export function render(element: import("react/jsx-runtime").JSX.Element): void;
  export const screen: {
    queryByRole(role: string, options: { name: string }): Element | null;
    getByRole(role: string, options: { name: string }): Element;
    findByRole(role: string, options: { name: string }): Promise<Element>;
  };
  export function waitFor<T>(assertion: () => T): Promise<T>;
}
declare module "vitest" {
  export function it(name: string, test: () => Promise<void>): void;
  export function expect(value: unknown): {
    toBe(expected: unknown): void;
    toBeNull(): void;
  };
}
`;

it.each([
  { backend: "hono", infra: "cloudflare" },
  { backend: "spring_boot", infra: "container" },
])("F-24 #101: $backend の生成先の言語設定で例を型検査できる", async ({ backend, infra }) => {
  const files = buildProject(
    await projectInput({ backend, infra, database: "none", auth: "none" }),
  ).files;
  const projectRoot = process.cwd();
  const configPath = path.join(projectRoot, "tsconfig.json");
  const config = ts.parseConfigFileTextToJson(configPath, contentOf(files, "tsconfig.json"));
  expect(config.error).toBeUndefined();
  expect(
    config.config.extends,
    "tsconfig に extends を足すときは、このテストでも設定の継承を解決する",
  ).toBeUndefined();
  const { options, errors } = ts.convertCompilerOptionsFromJson(
    config.config.compilerOptions,
    projectRoot,
    configPath,
  );
  expect(errors).toEqual([]);

  // 実行環境ごとの型の自動読み込みだけを外し、標準ライブラリと他の言語設定を使う。
  const compilerOptions = { ...options, types: [] };
  const host = ts.createCompilerHost(compilerOptions);
  const example = path.join(projectRoot, examplePath);
  const dependencies = path.join(projectRoot, "example-dependencies.d.ts");
  const sources = new Map([
    [example, contentOf(files, examplePath)],
    [dependencies, exampleDependencyTypes],
  ]);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const content = sources.get(path.normalize(name));
    return content === undefined
      ? getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(name, content, languageVersion);
  };
  const program = ts.createProgram([example, dependencies], compilerOptions, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  }));
  expect(diagnostics).toEqual([]);
});
