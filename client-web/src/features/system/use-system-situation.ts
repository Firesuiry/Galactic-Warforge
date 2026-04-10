import type { StateSummary, SystemRuntimeView, SystemView } from "@shared/types";

import {
  buildSystemSituationModel,
  type SystemSituationViewModel,
} from "@/features/system/system-situation-model";

export function useSystemSituation(input: {
  system?: SystemView;
  runtime?: SystemRuntimeView;
  summary?: StateSummary;
}): SystemSituationViewModel {
  return buildSystemSituationModel(input);
}
