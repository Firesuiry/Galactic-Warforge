import { describe, expect, it } from "vitest";

import {
  PUBLIC_COMMAND_DEFINITIONS,
  type PublicCommandId,
} from "@shared/command-catalog";

import { PLANET_COMMAND_RENDERERS } from "@/features/planet-commands/catalog";

describe("planet command catalog", () => {
  it("为所有必需的 Web 命令提供渲染器", () => {
    const requiredCommandIds = PUBLIC_COMMAND_DEFINITIONS.filter(
      (definition) => definition.webSurface === "required",
    ).map((definition) => definition.id);

    const missing = requiredCommandIds.filter(
      (commandId) =>
        !PLANET_COMMAND_RENDERERS[commandId as PublicCommandId],
    );

    expect(missing).toEqual([]);
  });
});
