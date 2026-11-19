import { createFileRoute } from "@tanstack/react-router";

import { SkillAnalyticsPage } from "../components/skills/SkillAnalyticsPage";

export const Route = createFileRoute("/_chat/skills")({
  component: SkillAnalyticsPage,
});
