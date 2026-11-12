import {
  BRAND_MARK_PATH,
  BRAND_MARK_VIEW_BOX,
  BRAND_MARK_ASPECT_RATIO,
} from "@t3tools/shared/brand";
import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = BRAND_MARK_ASPECT_RATIO;
  return (
    <Svg
      accessibilityLabel="S3"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox={BRAND_MARK_VIEW_BOX}
    >
      <ThemedPath
        d={BRAND_MARK_PATH}
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
