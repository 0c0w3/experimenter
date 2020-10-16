import { METRICS_TIPS } from "experimenter-rapid/components/visualization/constants/tooltips";

export enum SIGNIFICANCE {
  POSITIVE,
  NEGATIVE,
  NEUTRAL,
}

export enum VARIANT_TYPE {
  CONTROL,
  VARIANT,
}

export const METRIC = {
  RETENTION: "retained",
  SEARCH: "search_count",
  USER_COUNT: "identity",
};

export const STATISTIC = {
  PERCENT: "percentage",
  BINOMIAL: "binomial",
  MEAN: "mean",
  COUNT: "count",
};

export const BRANCH_COMPARISON = {
  ABSOLUTE: "absolute",
  DIFFERENCE: "difference",
  UPLIFT: "relative_uplift",
};

export const TABLE_LABEL = {
  HIGHLIGHTS: "highlights",
  RESULTS: "results",
};

// This is used as an ordered list of metrics to
// display in the results table from left to right.
export const RESULTS_METRICS_LIST = [
  {
    value: METRIC.RETENTION,
    name: "2-Week Browser Retention",
    tooltip: METRICS_TIPS.RETENTION,
  },
  {
    value: METRIC.SEARCH,
    name: "Daily Mean Searches Per User",
    tooltip: METRICS_TIPS.SEARCH,
  },
  {
    value: METRIC.USER_COUNT,
    name: "Total Users",
    tooltip: METRICS_TIPS.USER_COUNT,
  },
];

// This is used as an ordered list of items to
// display in the highlights table from top to bottom.
export const HIGHLIGHTS_METRICS_LIST = [
  {
    value: METRIC.RETENTION,
    name: "Retention",
    tooltip: METRICS_TIPS.RETENTION,
  },
  {
    value: METRIC.SEARCH,
    name: "Search",
    tooltip: METRICS_TIPS.SEARCH,
  },
];