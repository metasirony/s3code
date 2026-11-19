import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationReadScope,
  type EnvironmentId,
  type SkillAnalytics,
  type SkillAnalyticsWindowDays,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { orchestrationEnvironment } from "./orchestration";
import { environmentPresentations } from "./presentation";
import { environmentSession, sessionHasScope } from "./session";

type EnvironmentAnalytics = Extract<SkillAnalytics, { kind: "environment" }>;
type AnalyticsQuery = ReturnType<typeof orchestrationEnvironment.skillAnalytics>;

interface EnvironmentStatus {
  readonly id: EnvironmentId;
  readonly summary: EnvironmentAnalytics | null;
  readonly status: string | null;
  readonly pending: boolean;
  readonly query?: AnalyticsQuery;
}

const environmentAnalyticsAtom = Atom.family((key: string) =>
  Atom.make((get): readonly EnvironmentStatus[] => {
    const [days, selection] = JSON.parse(key) as [SkillAnalyticsWindowDays, EnvironmentId | null];
    const environments = get(environmentPresentations.presentationsAtom);
    const statuses: EnvironmentStatus[] = [];
    for (const [id, { entry, connection }] of environments) {
      if (selection !== null && id !== selection) continue;
      const details = { id, summary: null };
      if (!entry.enabled) {
        statuses.push({ ...details, pending: false, status: "Environment is disabled." });
        continue;
      }
      if (connection.phase !== "connected") {
        const pending = connection.phase === "connecting";
        statuses.push({
          ...details,
          pending,
          status: pending ? "Connecting…" : "Environment is unavailable.",
        });
        continue;
      }
      const session = get(environmentSession.sessionStateAtom(id));
      if (!sessionHasScope(session, AuthOrchestrationReadScope)) {
        const pending = session._tag === "Initial";
        statuses.push({
          ...details,
          pending,
          status: pending ? "Checking access…" : "Chat read access is unavailable.",
        });
        continue;
      }
      const query = orchestrationEnvironment.skillAnalytics({
        environmentId: id,
        input: { kind: "environment", days },
      });
      const result = get(query);
      const data = result._tag === "Success" ? result.value : null;
      statuses.push({
        ...details,
        query,
        pending: result._tag === "Initial",
        summary: data?.kind === "environment" ? data : null,
        status:
          result._tag === "Failure"
            ? "Could not load skill statistics."
            : result._tag === "Initial"
              ? "Loading…"
              : null,
      });
    }
    return statuses;
  }).pipe(Atom.withLabel("web-skill-analytics")),
);

export function useSkillAnalytics(days: SkillAnalyticsWindowDays, selection: EnvironmentId | null) {
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const environments = useAtomValue(environmentAnalyticsAtom(JSON.stringify([days, selection])));
  return {
    presentations,
    environments,
    refresh: () => {
      for (const environment of environments) {
        if (environment.query) appAtomRegistry.refresh(environment.query);
      }
    },
  };
}

export function mergeSkillAnalytics(summaries: readonly EnvironmentAnalytics[]) {
  const bySkill = new Map<string, EnvironmentAnalytics["skills"][number]>();
  let reads = 0;
  let requests = 0;
  let chatsWithReads = 0;
  for (const summary of summaries) {
    chatsWithReads += summary.chatsWithReads;
    for (const row of summary.skills) {
      reads += row.reads;
      requests += row.requests;
      const previous = bySkill.get(row.skill.key);
      bySkill.set(
        row.skill.key,
        previous
          ? {
              skill: previous.skill,
              reads: previous.reads + row.reads,
              requests: previous.requests + row.requests,
              fromSubagents: previous.fromSubagents + row.fromSubagents,
            }
          : row,
      );
    }
  }
  const skills = Array.from(bySkill.values()).sort(
    (a, b) =>
      b.reads - a.reads ||
      b.requests - a.requests ||
      a.skill.name.localeCompare(b.skill.name) ||
      a.skill.path.localeCompare(b.skill.path),
  );
  return { reads, requests, chatsWithReads, skills };
}
