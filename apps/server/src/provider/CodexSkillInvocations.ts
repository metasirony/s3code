// @effect-diagnostics nodeBuiltinImport:off - normalize Windows and Unix catalog paths independently of the server host.
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import type { SkillIdentity } from "@t3tools/contracts";
import type * as CodexSchema from "effect-codex-app-server/schema";

type Skill = CodexSchema.V2SkillsListResponse__SkillMetadata;
type Command = Extract<
  CodexSchema.V2ItemCompletedNotification__ThreadItem,
  { type: "commandExecution" }
>;

function skillPath(path: string, cwd: string, home: string): string {
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(cwd) || /^(?:[a-z]:[\\/]|\\\\)/i.test(path);
  const expanded = path.replace(/^(?:~|\$HOME|\$env:USERPROFILE)(?=[\\/]|$)/i, home);
  return windows
    ? NodePath.win32.resolve(cwd, expanded).replaceAll("\\", "/").toLowerCase()
    : NodePath.posix.resolve(cwd, expanded);
}

export function skillIdentity(skill: Skill, cwd: string, home: string): SkillIdentity {
  const path = skillPath(skill.path, cwd, home);
  return {
    key: JSON.stringify([skill.scope, skill.pluginId ?? null, path]),
    name: skill.name,
    path,
    scope: skill.scope,
    pluginId: skill.pluginId ?? null,
  };
}

export function requestedCodexSkills(
  text: string,
  skills: ReadonlyArray<Skill>,
): ReadonlyArray<Skill> {
  const selected = new Map<string, Skill>();
  for (const match of text.matchAll(/(?:^|[^\w\\$])\$([a-zA-Z0-9][a-zA-Z0-9:_-]*)/g)) {
    const skill = skills.find((candidate) => candidate.enabled && candidate.name === match[1]);
    if (skill === undefined) continue;
    selected.set(skill.path, skill);
  }
  return [...selected.values()];
}

function tokenize(command: string, windows: boolean): string[] | null {
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (char === quote) {
      quote = "";
      continue;
    }
    if (!quote && (char === "'" || char === '"')) {
      quote = char;
      continue;
    }
    if (!windows && char === "\\" && quote !== "'") {
      const next = command[++i];
      if (next === undefined) return null;
      token += next;
      continue;
    }
    if (!quote && /[\s;|&,]/.test(char)) {
      if (token) tokens.push(token);
      token = "";
      if (!/\s/.test(char)) {
        if ((char === "&" || char === "|") && command[i + 1] === char) {
          tokens.push(char + char);
          i++;
        } else tokens.push(char);
      } else if (char === "\n") tokens.push(";");
    } else token += char;
  }
  if (quote) return null;
  if (token) tokens.push(token);
  return tokens;
}

function readPaths(
  command: string,
  windows: boolean,
): { paths: string[]; canMaskReadFailure: boolean } | null {
  const tokens = tokenize(command, windows);
  if (!tokens?.length) return null;
  const executable = tokens[0]!
    .split(/[\\/]/)
    .at(-1)!
    .replace(/\.exe$/i, "")
    .toLowerCase();
  if (["powershell", "pwsh", "bash", "sh", "zsh"].includes(executable)) {
    const flag = tokens.findIndex((token) => /^(?:-command|-c|-lc)$/i.test(token));
    return flag > 0 && flag === tokens.length - 2
      ? readPaths(tokens[flag + 1]!, /^(powershell|pwsh)$/.test(executable))
      : null;
  }
  // Do not infer execution through conditionals, redirects, substitutions or scripts.
  if (
    tokens.some(
      (token) =>
        /[<>`{}()]/.test(token) ||
        token === "||" ||
        token === "&" ||
        (token.includes("$") && !/^(?:\$HOME|\$env:USERPROFILE)[\\/]/i.test(token)),
    )
  )
    return null;
  const paths: string[] = [];
  let group: string[] = [];
  let piped = false;
  const consume = () => {
    if (!group.length) return true;
    const [raw, ...args] = group;
    const name = raw!.toLowerCase();
    if (piped) return ["select-object", "select", "head", "tail", "more"].includes(name);
    if (name === "get-content" || (windows && ["gc", "type", "cat"].includes(name))) {
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (/^-(?:path|literalpath|raw)$/i.test(arg) || arg === ",") continue;
        if (/^-(?:totalcount|first|head|tail|encoding|readcount)$/i.test(arg)) {
          i++;
          continue;
        }
        if (arg.startsWith("-") || /[*?[\]]/.test(arg)) return false;
        paths.push(arg);
      }
      return true;
    }
    if (["cat", "head", "tail", "sed"].includes(name)) {
      let expression = name !== "sed";
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (["-n", "-c", "--lines", "--bytes"].includes(arg) && name !== "cat" && name !== "sed") {
          i++;
          continue;
        }
        if (
          arg === "--" ||
          (name === "cat" && /^-[benstuvAET]+$/.test(arg)) ||
          (name === "sed" && arg === "-n") ||
          (/^-\d+$/.test(arg) && name !== "sed")
        )
          continue;
        if (!expression) {
          if (!/^\d+(?:,\d+)?p$/.test(arg)) return false;
          expression = true;
          continue;
        }
        if (arg.startsWith("-") || /[*?[\]]/.test(arg)) return false;
        paths.push(arg);
      }
      return expression;
    }
    return false;
  };
  for (const token of [...tokens, ";"]) {
    if ([";", "&&", "|"].includes(token)) {
      if (!consume()) return null;
      group = [];
      piped = token === "|";
    } else group.push(token);
  }
  return {
    paths,
    canMaskReadFailure: tokens.some(
      (token, index) => token === "|" || (token === ";" && index < tokens.length - 1),
    ),
  };
}

export function observedCodexSkillReads(
  item: Command,
  skills: ReadonlyArray<Skill>,
  home: string,
): ReadonlyArray<SkillIdentity> {
  if (item.status !== "completed" || item.exitCode !== 0) return [];
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(item.cwd);
  const parsed = readPaths(item.command, windows);
  // Codex collapses duplicate commandActions and can classify PowerShell reads as unknown.
  // Parse supported shell forms first to retain every read; trust read actions only for simple readers.
  const paths =
    parsed?.paths ??
    item.commandActions.flatMap((action) =>
      action.type === "read" &&
      action.command === item.command &&
      /^(?:cat|head|tail|more|less|nl)\s/.test(action.command) &&
      !/[;\r\n&|<>`$(){}]/.test(action.command)
        ? [action.path]
        : [],
    );
  if (paths.length === 0) return [];
  // A later command or pipeline can hide a read error; otherwise exit zero also covers the read.
  if (
    parsed?.canMaskReadFailure &&
    /^(?:Get-Content|gc|cat|type|head|tail|sed|nl|more|less)\s*:/im.test(
      NodeUtil.stripVTControlCharacters(item.aggregatedOutput ?? ""),
    )
  )
    return [];
  const known = new Map(skills.map((skill) => [skillPath(skill.path, item.cwd, home), skill]));
  return paths.flatMap((path) => {
    const skill = known.get(skillPath(path, item.cwd, home));
    return skill ? [skillIdentity(skill, item.cwd, home)] : [];
  });
}
