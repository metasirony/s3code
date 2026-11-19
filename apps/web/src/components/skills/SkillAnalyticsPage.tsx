import { EnvironmentId, type SkillAnalyticsWindowDays } from "@t3tools/contracts";
import { connectionCatalogDisplayUrl } from "@t3tools/client-runtime/connection";
import { BoxIcon, MonitorIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { mergeSkillAnalytics, useSkillAnalytics } from "../../state/skillAnalytics";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WINDOW_OPTIONS } from "../usage/usageShortcuts";

const PERIODS = [...WINDOW_OPTIONS, { days: 0, label: "All time" }] as const;

type Summary = ReturnType<typeof mergeSkillAnalytics>;

function SkillTable({ skills }: { skills: Summary["skills"] }) {
  const max = skills[0]?.reads ?? 0;
  return (
    <div
      className="overflow-x-auto rounded-xl border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      tabIndex={0}
      role="region"
      aria-label="Skills breakdown table"
    >
      <table className="w-full min-w-[39rem] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-1/4" />
          <col />
          <col className="w-20" />
          <col className="w-17" />
          <col className="w-28" />
        </colgroup>
        <thead className="bg-muted/45 text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Skill
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Path
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Requests
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Reads
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              From subagents
            </th>
          </tr>
        </thead>
        <tbody>
          {skills.map(({ skill, requests, reads, fromSubagents }) => (
            <tr key={skill.key} className="border-t border-border/65 align-top tabular-nums">
              <th scope="row" className="px-3 py-2.5 font-medium">
                <span className="flex items-start gap-2">
                  <BoxIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{skill.name}</span>
                </span>
                {reads > 0 ? (
                  <div
                    aria-hidden
                    className="mt-1.5 h-0.5 rounded bg-primary/55"
                    style={{ width: `${(reads / max) * 100}%` }}
                  />
                ) : null}
              </th>
              <td className="px-3 py-2.5 font-mono text-muted-foreground [overflow-wrap:anywhere]">
                {skill.path}
              </td>
              <td className="px-3 py-2.5 text-right text-muted-foreground">
                {requests.toLocaleString()}
              </td>
              <td className="px-3 py-2.5 text-right font-medium">{reads.toLocaleString()}</td>
              <td className="px-3 py-2.5 text-right text-muted-foreground">
                {fromSubagents.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkillAnalyticsPage() {
  const [selection, setSelection] = useState<EnvironmentId | null>(null);
  const [days, setDays] = useState<SkillAnalyticsWindowDays>(30);
  const [query, setQuery] = useState("");
  const { presentations, environments, refresh } = useSkillAnalytics(days, selection);
  const summary = mergeSkillAnalytics(
    environments.flatMap((environment) => (environment.summary ? [environment.summary] : [])),
  );
  const environmentReads = new Map(
    environments.flatMap(({ id, summary }) =>
      summary ? [[id, summary.skills.reduce((sum, row) => sum + row.reads, 0)] as const] : [],
    ),
  );
  const search = query.trim().toLocaleLowerCase();
  const rows = search
    ? summary.skills.filter(
        ({ skill }) =>
          skill.name.toLocaleLowerCase().includes(search) ||
          skill.path.toLocaleLowerCase().includes(search),
      )
    : summary.skills;
  const loading = environments.some((entry) => entry.pending);
  const hasResults = environmentReads.size > 0;
  const labels = new Map<string, number>();
  for (const { entry } of presentations.values()) {
    labels.set(entry.target.label, (labels.get(entry.target.label) ?? 0) + 1);
  }
  const environmentLabels = new Map(
    Array.from(presentations, ([id, { entry }]) => [
      id,
      (labels.get(entry.target.label) ?? 0) > 1
        ? `${entry.target.label} · ${connectionCatalogDisplayUrl(entry) ?? id}`
        : entry.target.label,
    ]),
  );
  const environmentOptions = [
    { value: "", label: "All environments" },
    ...Array.from(environmentLabels, ([value, label]) => ({ value, label })),
  ];
  if (selection !== null && !presentations.has(selection)) {
    environmentOptions.push({ value: selection, label: "Removed environment" });
  }
  const selectPeriod = (value: string | null | undefined) => {
    const period = PERIODS.find((option) => String(option.days) === value);
    if (period) setDays(period.days);
  };

  return (
    <AppRouteModal label="Skill analytics">
      <header className="@container/skills-header flex min-h-12 shrink-0 items-center gap-1 border-b ps-4 pe-2 sm:ps-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="shrink-0 text-sm font-medium">Skills</h1>
          <span aria-hidden className="text-muted-foreground">
            /
          </span>
          <div className="min-w-0">
            <Select
              items={environmentOptions}
              value={selection ?? ""}
              onValueChange={(value) => setSelection(value ? EnvironmentId.make(value) : null)}
            >
              <SelectTrigger
                aria-label="Environment"
                variant="ghost"
                size="compact"
                className="max-w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {environmentOptions.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </div>
        <div className="hidden shrink-0 @2xl/skills-header:block">
          <ToggleGroup
            aria-label="Time period"
            variant="segmented"
            value={[String(days)]}
            onValueChange={(values) => selectPeriod(values[0])}
          >
            {PERIODS.map(({ days, label }) => (
              <Toggle key={days} value={String(days)}>
                {label}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>
        <div className="shrink-0 @2xl/skills-header:hidden">
          <Select
            items={PERIODS.map((period) => ({ value: String(period.days), label: period.label }))}
            value={String(days)}
            onValueChange={selectPeriod}
          >
            <SelectTrigger aria-label="Time period" variant="ghost" size="compact">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {PERIODS.map(({ days, label }) => (
                <SelectItem key={days} value={String(days)}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh skill analytics"
          title="Refresh skill analytics"
          disabled={!environments.some((entry) => entry.query !== undefined)}
          onClick={refresh}
        >
          <RefreshCwIcon />
        </Button>
        <AppRouteModalClose />
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <WorkspacePageContainer width="wide">
          {hasResults && environmentReads.size < environments.length ? (
            <p role="status" className="text-xs text-muted-foreground">
              Showing data from {environmentReads.size} of {environments.length} environments.
            </p>
          ) : null}
          {hasResults ? (
            <dl className="grid grid-cols-3 gap-3 rounded-xl border bg-card p-3 sm:gap-6 sm:p-5">
              <div>
                <dt className="text-xs text-muted-foreground">Recorded skill reads</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {summary.reads.toLocaleString()}
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {summary.skills.filter((row) => row.reads > 0).length.toLocaleString()} different
                  skills read
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">User requests</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {summary.requests.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Chats with reads</dt>
                <dd className="text-2xl font-semibold tabular-nums">
                  {summary.chatsWithReads.toLocaleString()}
                </dd>
              </div>
            </dl>
          ) : null}
          {environments.length > 0 ? (
            <ul aria-label="Reads by environment" className="grid gap-2 sm:grid-cols-2">
              {environments.map(({ id, status }) => {
                const label = environmentLabels.get(id);
                const reads = environmentReads.get(id);
                return (
                  <li key={id} className="min-w-0 rounded-lg border bg-card px-3 py-2.5">
                    <div className="flex items-center gap-2 text-xs">
                      <MonitorIcon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      {selection === null ? (
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          onClick={() => setSelection(id)}
                        >
                          {label}
                        </button>
                      ) : (
                        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                      )}
                      {reads !== undefined ? (
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          <b className="text-foreground">{reads.toLocaleString()}</b> reads
                        </span>
                      ) : null}
                    </div>
                    {status ? (
                      <p role="status" className="mt-1 text-xs text-muted-foreground">
                        {status}
                      </p>
                    ) : null}
                    {reads !== undefined ? (
                      <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/65"
                          style={{ width: `${summary.reads ? (reads / summary.reads) * 100 : 0}%` }}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {selection === null
                ? "Connect an environment to see skill statistics."
                : "This environment was removed."}
            </p>
          )}
          {hasResults ? (
            <section aria-labelledby="skills-breakdown" className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="skills-breakdown" className="text-sm font-medium">
                  Skills breakdown
                </h2>
                <div className="w-full sm:w-52">
                  <InputGroup>
                    <InputGroupInput
                      type="search"
                      aria-label="Search skills by name or path"
                      placeholder="Search skills…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <InputGroupAddon>
                      <SearchIcon aria-hidden />
                    </InputGroupAddon>
                  </InputGroup>
                </div>
              </div>
              {rows.length > 0 ? (
                <SkillTable skills={rows} />
              ) : (
                <p
                  role="status"
                  className="rounded-xl border py-6 text-center text-sm text-muted-foreground"
                >
                  {search
                    ? "No skills match your search."
                    : "No recorded skill activity in this period."}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Reads count observed successful instruction reads, including repeats and reads from
                subagents. Requests count user requests separately.
              </p>
            </section>
          ) : loading ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading skill analytics…
            </p>
          ) : null}
        </WorkspacePageContainer>
      </ScrollArea>
    </AppRouteModal>
  );
}
