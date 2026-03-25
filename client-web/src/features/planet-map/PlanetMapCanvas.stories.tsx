import type { Meta, StoryObj } from '@storybook/react-vite';

import { PlanetMapCanvas } from '@/features/planet-map/PlanetMapCanvas';
import { baselineScenario, withBaselineSession, withPlanetSelection } from '@/stories/fixture-story';

const planet = baselineScenario.planets['planet-1-1'];
const fog = baselineScenario.fogByPlanet['planet-1-1'];
const assembler = planet.buildings?.['assembler-1'];

const meta = {
  title: 'Planet/MapCanvas',
  component: PlanetMapCanvas,
  decorators: [withBaselineSession],
  args: {
    fog,
    planet,
  },
  render: (args) => (
    <div className="panel planet-map-shell" style={{ minHeight: 760 }}>
      <PlanetMapCanvas {...args} />
    </div>
  ),
} satisfies Meta<typeof PlanetMapCanvas>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SelectedAssembler: Story = {
  decorators: assembler ? [
    withPlanetSelection({
      kind: 'building',
      id: assembler.id,
      position: assembler.position,
    }),
  ] : [],
};
