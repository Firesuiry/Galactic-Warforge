import {
  PUBLIC_COMMAND_DEFINITIONS,
  type CommandPermissionCategory,
} from '@shared/command-catalog';

export interface ProviderCommandDefinition {
  command: string;
  label: string;
  permissionCategory: CommandPermissionCategory;
}

const EXTRA_PROVIDER_COMMANDS: ProviderCommandDefinition[] = [
  { command: 'health', label: 'health', permissionCategory: 'observe' },
  { command: 'metrics', label: 'metrics', permissionCategory: 'observe' },
  { command: 'summary', label: 'summary', permissionCategory: 'observe' },
  { command: 'stats', label: 'stats', permissionCategory: 'observe' },
  { command: 'galaxy', label: 'galaxy', permissionCategory: 'observe' },
  { command: 'system', label: 'system', permissionCategory: 'observe' },
  { command: 'system_runtime', label: 'system_runtime', permissionCategory: 'observe' },
  { command: 'planet', label: 'planet', permissionCategory: 'observe' },
  { command: 'scene', label: 'scene', permissionCategory: 'observe' },
  { command: 'inspect', label: 'inspect', permissionCategory: 'observe' },
  { command: 'fleet_status', label: 'fleet_status', permissionCategory: 'observe' },
  { command: 'fog', label: 'fog', permissionCategory: 'observe' },
  { command: 'save', label: 'save', permissionCategory: 'management' },
];

function buildPublicProviderCommands() {
  return PUBLIC_COMMAND_DEFINITIONS
    .filter((definition) => definition.cliCommandName)
    .map((definition) => ({
      command: definition.cliCommandName as string,
      label: definition.cliCommandName === definition.apiCommandName
        ? definition.cliCommandName
        : `${definition.cliCommandName} (${definition.apiCommandName})`,
      permissionCategory: definition.permissionCategory,
    }));
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

export const PROVIDER_COMMAND_DEFINITIONS: ProviderCommandDefinition[] = [
  ...EXTRA_PROVIDER_COMMANDS,
  ...buildPublicProviderCommands(),
]
  .reduce<ProviderCommandDefinition[]>((definitions, definition) => {
    if (definitions.some((current) => current.command === definition.command)) {
      return definitions;
    }
    return [...definitions, definition];
  }, [])
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
