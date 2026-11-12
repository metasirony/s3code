import { BRAND_MARK_PATH, BRAND_MARK_VIEW_BOX } from "@t3tools/shared/brand";
import type { SVGProps } from "react";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox={BRAND_MARK_VIEW_BOX} xmlns="http://www.w3.org/2000/svg">
      <path d={BRAND_MARK_PATH} fill="currentColor" />
    </svg>
  );
}
