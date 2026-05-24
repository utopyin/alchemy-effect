import * as Effect from "effect/Effect";
import * as fs from "node:fs/promises";

const HOSTS_PATH = "/etc/hosts";

export const syncLocalHosts = (
  marker: string,
  hostnames: Iterable<string>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const uniqueHosts = [...new Set(hostnames)].sort();
    const nextBlock = formatBlock(marker, uniqueHosts);

    const previous = yield* Effect.tryPromise(() =>
      fs.readFile(HOSTS_PATH, "utf8"),
    ).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          `Alchemy could not read ${HOSTS_PATH} for local dev domains: ${String(error)}`,
        ).pipe(Effect.as("")),
      ),
    );
    if (previous === "") {
      return;
    }
    const next = replaceBlock(previous, marker, nextBlock);
    if (next === previous) {
      return;
    }

    yield* Effect.tryPromise(() => fs.writeFile(HOSTS_PATH, next, "utf8")).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          [
            `Alchemy could not update ${HOSTS_PATH} for local dev domains.`,
            `Add this block manually or rerun with permission to edit ${HOSTS_PATH}:`,
            nextBlock.trimEnd(),
            `Cause: ${String(error)}`,
          ].join("\n"),
        ),
      ),
    );
  });

const formatBlock = (marker: string, hostnames: readonly string[]): string => {
  if (hostnames.length === 0) {
    return "";
  }
  return [
    `# alchemy:${marker}:start`,
    ...hostnames.map((hostname) => `127.0.0.1 ${hostname}`),
    `# alchemy:${marker}:end`,
    "",
  ].join("\n");
};

const replaceBlock = (
  hosts: string,
  marker: string,
  nextBlock: string,
): string => {
  const start = `# alchemy:${marker}:start`;
  const end = `# alchemy:${marker}:end`;
  const block = new RegExp(
    `\\n?${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`,
  );
  const withoutBlock = hosts.replace(block, "\n").replace(/\n{3,}/g, "\n\n");
  if (nextBlock === "") {
    return withoutBlock;
  }
  return `${withoutBlock.replace(/\s*$/, "\n\n")}${nextBlock}`;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
