import { describe, expect, it } from "vite-plus/test";
import type * as CodexSchema from "effect-codex-app-server/schema";
import {
  observedCodexSkillReads,
  requestedCodexSkills,
  skillIdentity,
} from "./CodexSkillInvocations.ts";

const unixSkill = {
  name: "review",
  path: "/home/me/.agents/skills/review/SKILL.md",
  scope: "user",
  description: "Review",
  enabled: true,
} satisfies CodexSchema.V2SkillsListResponse__SkillMetadata;
const windowsSkill = { ...unixSkill, path: "C:\\Users\\me\\.agents\\skills\\review\\SKILL.md" };
const commandItem = (command: string, windows = false) =>
  ({
    type: "commandExecution",
    id: "read-1",
    command,
    cwd: windows ? "C:\\Users\\me" : "/home/me",
    processId: null,
    status: "completed",
    exitCode: 0,
    aggregatedOutput: "# Review instructions",
    commandActions: [{ type: "unknown", command }],
    durationMs: 1,
  }) satisfies Extract<
    CodexSchema.V2ItemCompletedNotification__ThreadItem,
    { type: "commandExecution" }
  >;

describe("Codex skill observations", () => {
  it.each([
    ["cat .agents/skills/review/SKILL.md", false, 1],
    ["head -n 30 '/home/me/.agents/skills/review/SKILL.md'", false, 1],
    ["sed -n '1,100p' .agents/skills/review/SKILL.md", false, 1],
    ["cat ~/.agents/skills/review/SKILL.md && cat ~/.agents/skills/review/SKILL.md", false, 2],
    ['cat "$HOME/.agents/skills/review/SKILL.md"', false, 1],
    ["bash -lc 'cat .agents/skills/review/SKILL.md'", false, 1],
    ["Get-Content -Raw -LiteralPath 'C:\\Users\\me\\.agents\\skills\\review\\SKILL.md'", true, 1],
    ["Get-Content .agents/skills/review/SKILL.md | Select-Object -First 50", true, 1],
    ["gc .agents/skills/review/SKILL.md; gc .agents/skills/review/SKILL.md", true, 2],
    ["type C:/USERS/ME/.agents/skills/review/skill.MD", true, 1],
    ['powershell.exe -NoProfile -Command "Get-Content .agents/skills/review/SKILL.md"', true, 1],
    ['Get-Content "$env:USERPROFILE/.agents/skills/review/SKILL.md"', true, 1],
    ["rg --files | rg SKILL.md", false, 0],
    ["find . -name SKILL.md", false, 0],
    ["ls .agents/skills/review/SKILL.md", false, 0],
    ["echo .agents/skills/review/SKILL.md", false, 0],
    ["type .agents/skills/review/SKILL.md", false, 0],
    ["Get-Content .agents/skills/review/SKILL.md -ErrorAction SilentlyContinue", true, 0],
    ["Get-ChildItem -Recurse -Filter SKILL.md", true, 0],
    ["Select-String SKILL.md .agents/skills/review/SKILL.md", true, 0],
    ["python .agents/skills/review/scripts/run.py", false, 0],
    ["python -c \"print(open('.agents/skills/review/SKILL.md').read())\"", false, 0],
    ["cat /unknown/SKILL.md", false, 0],
    ["cat /home/ME/.agents/skills/review/SKILL.md", false, 0],
    ["false && cat .agents/skills/review/SKILL.md || true", false, 0],
    ["cat .agents/skills/review/SKILL.md > /dev/null", false, 0],
  ])("recognizes %s", (command, windows, count) => {
    expect(
      observedCodexSkillReads(
        commandItem(command, windows),
        [windows ? windowsSkill : unixSkill],
        windows ? "C:/Users/me" : "/home/me",
      ),
    ).toHaveLength(count);
  });

  it.each([
    ["cat .agents/skills/review/SKILL.md", false, 1],
    ["cat .agents/skills/review/SKILL.md && cat .agents/skills/review/SKILL.md", false, 2],
    ["bash -lc 'cat .agents/skills/review/SKILL.md'", false, 1],
    ["Get-Content .agents/skills/review/SKILL.md", true, 1],
    ['pwsh -Command "Get-Content .agents/skills/review/SKILL.md"', true, 1],
    ["nl .agents/skills/review/SKILL.md", false, 1],
  ])("trusts an unmasked successful reader's exit code: %s", (command, windows, count) => {
    const skill = windows ? windowsSkill : unixSkill;
    expect(
      observedCodexSkillReads(
        {
          ...commandItem(command, windows),
          aggregatedOutput:
            "# Instructions\ncat: missing: No such file or directory\nGet-Content: Cannot find path",
          commandActions: [{ type: "read", command, name: "SKILL.md", path: skill.path }],
        },
        [skill],
        windows ? "C:/Users/me" : "/home/me",
      ),
    ).toHaveLength(count);
  });

  it("requires a successful read and retains repeated reads even when commandActions collapse them", () => {
    const command = "cat .agents/skills/review/SKILL.md";
    const item = commandItem(`${command} && ${command}`);
    const actions = [{ type: "read", command, name: "SKILL.md", path: unixSkill.path }] as const;
    expect(
      observedCodexSkillReads({ ...item, commandActions: actions }, [unixSkill], "/home/me"),
    ).toHaveLength(2);
    expect(observedCodexSkillReads({ ...item, exitCode: 1 }, [unixSkill], "/home/me")).toEqual([]);
    expect(
      observedCodexSkillReads(
        {
          ...item,
          aggregatedOutput: "Explain how to fix No such file and Cannot find path errors.",
        },
        [unixSkill],
        "/home/me",
      ),
    ).toHaveLength(2);
    expect(
      observedCodexSkillReads(
        {
          ...commandItem(`${command}; cat other.txt`),
          aggregatedOutput: "cat: missing: No such file or directory",
        },
        [unixSkill],
        "/home/me",
      ),
    ).toEqual([]);
    expect(
      observedCodexSkillReads(
        { ...item, status: "inProgress", exitCode: null },
        [unixSkill],
        "/home/me",
      ),
    ).toEqual([]);
    expect(
      observedCodexSkillReads(
        {
          ...commandItem("Get-Content .agents/skills/review/SKILL.md; Get-Content other.txt", true),
          aggregatedOutput: "Get-Content: Cannot find path",
        },
        [windowsSkill],
        "C:/Users/me",
      ),
    ).toEqual([]);
    expect(
      observedCodexSkillReads(
        {
          ...commandItem("bash -lc 'cat .agents/skills/review/SKILL.md | head -n 30'"),
          aggregatedOutput: "\u001b[31mcat: missing: No such file or directory\u001b[0m",
        },
        [unixSkill],
        "/home/me",
      ),
    ).toEqual([]);
    const multiline = "nl .agents/skills/review/SKILL.md\nnl other.txt";
    expect(
      observedCodexSkillReads(
        {
          ...commandItem(multiline),
          aggregatedOutput: "nl: missing: No such file or directory",
          commandActions: [
            { type: "read", command: multiline, name: "SKILL.md", path: unixSkill.path },
          ],
        },
        [unixSkill],
        "/home/me",
      ),
    ).toEqual([]);
  });

  it("resolves unique enabled mentions once per message and preserves catalog identity", () => {
    expect(requestedCodexSkills("Use $review, then $review and $missing", [unixSkill])).toEqual([
      unixSkill,
    ]);
    expect(requestedCodexSkills("$review", [{ ...unixSkill, enabled: false }])).toEqual([]);
    const plugin = { ...unixSkill, path: "/plugins/review/SKILL.md", pluginId: "plugin:review" };
    expect(requestedCodexSkills("$review", [unixSkill, plugin])).toEqual([unixSkill]);
    const reads = observedCodexSkillReads(
      commandItem(`cat '${unixSkill.path}' '${plugin.path}'`),
      [unixSkill, plugin],
      "/home/me",
    );
    expect(reads.map((skill) => skill.name)).toEqual(["review", "review"]);
    expect(new Set(reads.map((skill) => skill.key)).size).toBe(2);
    expect(
      skillIdentity(
        { ...windowsSkill, path: "c:/users/ME/.agents/skills/review/./SKILL.md" },
        "C:/Users/me",
        "C:/Users/me",
      ).key,
    ).toBe(skillIdentity(windowsSkill, "C:/Users/me", "C:/Users/me").key);
  });
});
