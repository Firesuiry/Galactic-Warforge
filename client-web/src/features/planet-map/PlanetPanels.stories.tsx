import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  PlanetActivityPanel,
  PlanetEntityPanel,
} from '@/features/planet-map/PlanetPanels';
import { baselineScenario, withBaselineSession, withPlanetSelection } from '@/stories/fixture-story';

const planet = baselineScenario.planets['planet-1-1'];
const fog = baselineScenario.fogByPlanet['planet-1-1'];
const summary = baselineScenario.summary;
const stats = baselineScenario.statsByPlayer.p1;
const assembler = planet.buildings?.['assembler-1'];

const meta = {
  title: 'Planet/Panels',
  component: PlanetEntityPanel,
  decorators: [withBaselineSession],
  args: {
    fog,
    planet,
    stats,
    summary,
  },
} satisfies Meta<typeof PlanetEntityPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const BuildingDetails: Story = {
  args: {
    fog,
    planet,
    stats,
    summary,
  },
  decorators: assembler ? [
    withPlanetSelection({
      kind: 'building',
      id: assembler.id,
      position: assembler.position,
    }),
  ] : [],
  render: () => (
    <div className="panel" style={{ maxWidth: 420 }}>
      <PlanetEntityPanel fog={fog} planet={planet} stats={stats} summary={summary} />
    </div>
  ),
};

export const ActivityTimeline: Story = {
  args: {
    fog,
    planet,
    stats,
    summary,
  },
  render: () => (
    <PlanetActivityPanel
      alerts={baselineScenario.alertSnapshot.alerts}
      events={baselineScenario.eventSnapshot.events}
      planet={planet}
    />
  ),
};
