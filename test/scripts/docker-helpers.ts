// #17 smoke 共通：Linux コンテナを動かせる Docker か、コンテナの root が作ったファイルの後始末。
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { gitleaksImage } from "../../src/adopt/secret-scan.js";

/** Linux コンテナを動かせる Docker があるか（GitHub の Windows ランナーは Windows コンテナのため、false） */
export function linuxDockerAvailable(): boolean {
  const r = spawnSync("docker", ["info", "--format", "{{.OSType}}"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return r.status === 0 && r.stdout.trim().toLowerCase() === "linux";
}

/**
 * フォルダを消す。コンテナの root が作ったファイル（ランナーのユーザーでは消せない）は、
 * コンテナの中で、権限を戻して中身を消してから、ホストで消す。
 */
export function removeWithContainer(base: string, mountedChildren: string[]): void {
  for (const child of mountedChildren) {
    spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${child}:/work`,
        "--entrypoint",
        "sh",
        gitleaksImage(),
        "-c",
        "chmod -R 777 /work 2>/dev/null; rm -rf /work/* /work/.[!.]* /work/..?* 2>/dev/null; true",
      ],
      { stdio: "ignore", windowsHide: true },
    );
  }
  rmSync(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}
