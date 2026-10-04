import {
  AGENT_COMMAND_CATALOG,
  PUBLIC_COMMAND_DEFINITIONS,
  type CommandPermissionCategory,
} from '@shared/command-catalog';

export interface ProviderCommandDefinition {
  command: string;
  label: string;
  permissionCategory: CommandPermissionCategory;
}

const API_NAME_BY_CLI_COMMAND = new Map(
  PUBLIC_COMMAND_DEFINITIONS
    .filter((definition) => definition.cliCommandName)
    .map((definition) => [definition.cliCommandName as string, definition.apiCommandName]),
);

function providerCommandLabel(command: string) {
  const apiCommandName = API_NAME_BY_CLI_COMMAND.get(command);
  return apiCommandName && apiCommandName !== command ? `${command} (${apiCommandName})` : command;
}

const COMMAND_CATEGORY_ORDER: CommandPermissionCategory[] = [
  'observe',
  'build',
  'research',
  'management',
  'combat',
];

function compareCategoryOrder(
  left: CommandPermissionCategory,
  right: CommandPermissionCategory,
) {
  return COMMAND_CATEGORY_ORDER.indexOf(left) - COMMAND_CATEGORY_ORDER.indexOf(right);
}

export const PROVIDER_COMMAND_DEFINITIONS: ProviderCommandDefinition[] = Object.entries(AGENT_COMMAND_CATALOG)
  .map(([command, { category }]) => ({
    command,
    label: providerCommandLabel(command),
    permissionCategory: category,
  }))
  .sort((left, right) => (
    compareCategoryOrder(left.permissionCategory, right.permissionCategory)
    || left.command.localeCompare(right.command, 'en')
  ));

export const DEFAULT_PROVIDER_COMMAND_WHITELIST = PROVIDER_COMMAND_DEFINITIONS.map(
  (definition) => definition.command,
);

const PROVIDER_COMMAND_DEFINITION_BY_ID = new Map(
  PROVIDER_COMMAND_DEFINITIONS.map((definition) => [definition.command, definition]),
);

export function listProviderCommandsByCategory() {
  return COMMAND_CATEGORY_ORDER
    .map((permissionCategory) => ({
      permissionCategory,
      commands: PROVIDER_COMMAND_DEFINITIONS.filter(
        (definition) => definition.permissionCategory === permissionCategory,
      ),
    }))
    .filter((group) => group.commands.length > 0);
}

export function getProviderCommandCoverageCategories(commandWhitelist: string[]) {
  const categories = new Set<CommandPermissionCategory>();
  for (const command of commandWhitelist) {
    const definition = PROVIDER_COMMAND_DEFINITION_BY_ID.get(command);
    if (definition) {
      categories.add(definition.permissionCategory);
    }
  }
  return [...categories].sort(compareCategoryOrder);
}

export function getMissingPolicyCategories(
  commandWhitelist: string[],
  policyCategories: string[],
) {
  const coveredCategories = new Set(getProviderCommandCoverageCategories(commandWhitelist));
  return policyCategories.filter((category) => !coveredCategories.has(category as CommandPermissionCategory));
}
