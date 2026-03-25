import { useEffect, type PropsWithChildren } from 'react';

import type { Decorator } from '@storybook/react-vite';

import type { SelectedEntity } from '@/features/planet-map/model';
import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';
import { createFixtureServerUrl, getFixtureScenario } from '@/fixtures';
import { resetSessionStore, useSessionStore } from '@/stores/session';

export const baselineScenario = getFixtureScenario('baseline');

interface StoryHarnessProps extends PropsWithChildren {
  selection?: SelectedEntity | null;
}

function StoryHarness({ children, selection = null }: StoryHarnessProps) {
  useEffect(() => {
    resetSessionStore();
    resetPlanetViewStore();
    useSessionStore.getState().setSession({
      serverUrl: createFixtureServerUrl('baseline'),
      playerId: 'p1',
      playerKey: 'key_player_1',
    });

    if (selection) {
      usePlanetViewStore.getState().setSelected(selection);
    }

    return () => {
      resetPlanetViewStore();
      resetSessionStore();
    };
  }, [selection]);

  return (
    <div style={{ minHeight: '100vh', padding: 24 }}>
      {children}
    </div>
  );
}

export const withBaselineSession: Decorator = (Story) => (
  <StoryHarness>
    <Story />
  </StoryHarness>
);

export function withPlanetSelection(selection: SelectedEntity): Decorator {
  return (Story) => (
    <StoryHarness selection={selection}>
      <Story />
    </StoryHarness>
  );
}
