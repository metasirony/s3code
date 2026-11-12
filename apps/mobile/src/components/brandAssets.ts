import Constants from "expo-constants";

const appVariant = Constants.expoConfig?.extra?.appVariant;

export const T3_CODE_BRAND_MARK_SOURCE =
  appVariant === "development"
    ? require("../../../../assets/dev/blueprint-universal-1024.png")
    : appVariant === "preview"
      ? require("../../../../assets/nightly/nightly-universal-1024.png")
      : require("../../../../assets/prod/black-universal-1024.png");
