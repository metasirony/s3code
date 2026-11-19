import {
  AuthOrchestrationReadScope,
  type ScopedThreadRef,
  type SkillAnalyticsActor,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon, BoxIcon, ChevronDownIcon } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

const PERIODS = [
  { value: "all", label: "Entire chat" },
  { value: "latest", label: "Latest turn" },
  { value: "earlier", label: "Before latest turn" },
] as const;
type Period = (typeof PERIODS)[number]["value"];
const PAGE_SIZE = 10;
const NO_ACTORS: readonly SkillAnalyticsActor[] = [];
const NO_SKILLS: SkillAnalyticsActor["skills"] = [];

function readCounts(actors: readonly SkillAnalyticsActor[]) {
  let reads = 0;
  let latestReads = 0;
  for (const actor of actors) {
    for (const row of actor.skills) {
      reads += row.reads;
      latestReads += row.latest.reads;
    }
  }
  return { reads, latestReads };
}

function periodReads(counts: ReturnType<typeof readCounts>, period: Period) {
  if (period === "latest") return counts.latestReads;
  return period === "earlier" ? counts.reads - counts.latestReads : counts.reads;
}

function LatestReads({ count }: { count: number }) {
  return (
    <span className="font-medium text-muted-foreground tabular-nums">
      <span className="sr-only">Reads in the latest turn </span>
      {count > 0 ? `+${count}` : 0}
    </span>
  );
}

function SkillRows({ skills, period }: { skills: SkillAnalyticsActor["skills"]; period: Period }) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const pager = useRef<HTMLButtonElement>(null);
  const rows = skills
    .map((row) => ({
      skill: row.skill,
      reads: periodReads({ reads: row.reads, latestReads: row.latest.reads }, period),
      requests:
        period === "all"
          ? row.requests
          : period === "latest"
            ? row.latest.requests
            : row.requests - row.latest.requests,
      latestReads: period === "earlier" ? 0 : row.latest.reads,
      isNew: period !== "earlier" && row.reads > 0 && row.reads === row.latest.reads,
    }))
    .filter((row) => row.requests > 0 || row.reads > 0)
    .sort(
      (a, b) =>
        Number(b.isNew) - Number(a.isNew) ||
        b.reads - a.reads ||
        b.requests - a.requests ||
        a.skill.name.localeCompare(b.skill.name),
    );

  const remaining = rows.length - limit;
  if (rows.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground">
        {period === "latest"
          ? "No skill activity in the latest turn."
          : "No skill activity in this period."}
      </p>
    );
  }

  return (
    <>
      <table className="w-full table-fixed text-xs">
        <colgroup>
          <col />
          <col className="w-9" />
          <col className="w-9" />
          <col className="w-7" />
        </colgroup>
        <thead>
          <tr className="text-muted-foreground">
            <th scope="col" className="py-1 text-left font-normal">
              Skill
            </th>
            <th scope="col" className="text-right font-normal">
              <span className="sr-only">Requests</span>
              <span aria-hidden>Req.</span>
            </th>
            <th scope="col" className="text-right font-normal">
              Reads
            </th>
            <th scope="col" className="text-right font-normal">
              <span className="sr-only">Latest turn</span>
              <span aria-hidden>Δ</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((row) => (
            <tr key={row.skill.key} className="border-t border-border/45 tabular-nums">
              <th scope="row" className="py-1.5 text-left font-normal">
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger render={<span className="min-w-0 flex-1 truncate" />}>
                      {row.skill.name}
                    </TooltipTrigger>
                    <TooltipPopup className="max-w-72 [overflow-wrap:anywhere]">
                      {row.skill.path}
                    </TooltipPopup>
                  </Tooltip>
                  {row.isNew ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="shrink-0 rounded bg-accent px-1 text-2xs font-medium text-accent-foreground" />
                        }
                      >
                        New
                      </TooltipTrigger>
                      <TooltipPopup>
                        First recorded read by this agent in the latest turn
                      </TooltipPopup>
                    </Tooltip>
                  ) : null}
                </div>
              </th>
              <td className="text-right text-muted-foreground">{row.requests}</td>
              <td className="text-right font-medium">{row.reads}</td>
              <td className="text-right">
                {row.latestReads > 0 ? <LatestReads count={row.latestReads} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > PAGE_SIZE ? (
        <div className="flex flex-wrap gap-x-1">
          <Button
            ref={pager}
            size="xs"
            variant="ghost-muted"
            onClick={() => setLimit(remaining > 0 ? limit + PAGE_SIZE : PAGE_SIZE)}
          >
            {remaining > 0 ? (
              <>
                Show more
                <span className="tabular-nums">({remaining})</span>
              </>
            ) : (
              "Show less"
            )}
          </Button>
          {remaining > 0 && limit > PAGE_SIZE ? (
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => {
                pager.current?.focus();
                setLimit(PAGE_SIZE);
              }}
            >
              Show less
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function SubagentSkills({
  environmentId,
  actor,
  period,
}: {
  environmentId: ScopedThreadRef["environmentId"];
  actor: SkillAnalyticsActor;
  period: Period;
}) {
  const [open, setOpen] = useState(false);
  const counts = readCounts([actor]);
  return (
    <div>
      <div className="flex min-w-0 items-center">
        <ThreadDetailsControl part="primary" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronDownIcon className={cn("size-3 text-muted-foreground", !open && "-rotate-90")} />
          <span className="min-w-0 flex-1 truncate">{actor.title}</span>
          <span className="tabular-nums">{periodReads(counts, period)}</span>
          {period !== "earlier" ? <LatestReads count={counts.latestReads} /> : null}
        </ThreadDetailsControl>
        <Button
          render={
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams({
                environmentId,
                threadId: actor.threadId,
              })}
            />
          }
          size="icon-xs"
          variant="ghost-muted"
          aria-label={`Open subagent ${actor.title}`}
          title={`Open subagent ${actor.title}`}
        >
          <ArrowUpRightIcon />
        </Button>
      </div>
      {open ? (
        <div className="mb-1 border-s border-border ps-2">
          <SkillRows key={period} skills={actor.skills} period={period} />
        </div>
      ) : null}
    </div>
  );
}

function Subagents({
  environmentId,
  actors,
  period,
}: {
  environmentId: ScopedThreadRef["environmentId"];
  actors: readonly SkillAnalyticsActor[];
  period: Period;
}) {
  const [open, setOpen] = useState(false);
  const counts = readCounts(actors);
  return (
    <div className="mt-2 border-t border-border/65 pt-1">
      <ThreadDetailsControl aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="min-w-0 flex-1 truncate">Subagents · {actors.length}</span>
        <span className="tabular-nums">{periodReads(counts, period)} reads</span>
        {period !== "earlier" ? <LatestReads count={counts.latestReads} /> : null}
        <ChevronDownIcon className={cn("size-3 text-muted-foreground", open && "rotate-180")} />
      </ThreadDetailsControl>
      {open
        ? actors.map((actor) => (
            <SubagentSkills
              key={actor.threadId}
              environmentId={environmentId}
              actor={actor}
              period={period}
            />
          ))
        : null}
    </div>
  );
}

export function ThreadDetailsSkills({
  environmentId,
  threadId,
  ownOnly,
}: ScopedThreadRef & { ownOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("all");
  const canRead = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    canRead
      ? orchestrationEnvironment.skillAnalytics({
          environmentId,
          input: { kind: "thread", threadId, includeSubagents: !ownOnly },
        })
      : null,
  );
  const data = query.data?.kind === "thread" ? query.data : null;
  const actors = data?.actors ?? NO_ACTORS;
  const self = actors.find((actor) => actor.threadId === threadId);
  const others = actors.filter((actor) => actor.threadId !== threadId);
  const total = readCounts(actors);
  const ownCounts = readCounts(self ? [self] : NO_ACTORS);

  return (
    <ThreadDetailsSection
      headingId="thread-details-skills-heading"
      title="Skills"
      showHeading={false}
    >
      <ThreadDetailsControl aria-expanded={open} onClick={() => setOpen(!open)}>
        <BoxIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
        <span className="flex-1">Skills</span>
        {data && !query.error && canRead ? (
          <>
            <span className="tabular-nums">
              <span className="sr-only">Total recorded reads </span>
              {total.reads}
            </span>
            <LatestReads count={total.latestReads} />
          </>
        ) : null}
        <ChevronDownIcon className={cn("size-3 text-muted-foreground", open && "rotate-180")} />
      </ThreadDetailsControl>
      {open ? (
        <div data-thread-details-skills-body className="space-y-2 px-2.5 pb-1 pt-1">
          {!canRead || query.error ? (
            <div className="text-xs text-muted-foreground">
              <p role="status">{query.error ?? "Skill statistics are unavailable."}</p>
              {canRead ? (
                <Button size="xs" variant="ghost-muted" onClick={query.refresh}>
                  Retry
                </Button>
              ) : null}
            </div>
          ) : data === null ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading skills…
            </p>
          ) : (
            <>
              {!ownOnly && others.length > 0 ? (
                <p className="text-2xs text-muted-foreground tabular-nums">
                  Total {total.reads} · main {ownCounts.reads} · subagents{" "}
                  {total.reads - ownCounts.reads}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-y-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base font-semibold tabular-nums">
                    {periodReads(ownCounts, period)}
                  </span>
                  <span className="text-xs text-muted-foreground">own reads</span>
                  {period === "all" ? <LatestReads count={ownCounts.latestReads} /> : null}
                </div>
                <Select
                  items={PERIODS}
                  value={period}
                  onValueChange={(value) => {
                    if (value !== null) setPeriod(value);
                  }}
                >
                  <SelectTrigger variant="ghost" size="xs" aria-label="Skill statistics period">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {PERIODS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              {!ownOnly ? (
                <h4 className="text-2xs font-medium text-muted-foreground">Main agent</h4>
              ) : null}
              <SkillRows key={period} skills={self?.skills ?? NO_SKILLS} period={period} />
              {others.length > 0 ? (
                <Subagents environmentId={environmentId} actors={others} period={period} />
              ) : null}
              <p className="text-2xs text-muted-foreground">
                Reads count observed successful instruction reads, including repeats.
              </p>
            </>
          )}
        </div>
      ) : null}
    </ThreadDetailsSection>
  );
}
