import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeConfig } from 'vite';
import type { StorybookConfig } from '@storybook/react-vite';

const storybookDir = fileURLToPath(new URL('.', import.meta.url));

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  async viteFinal(baseConfig) {
    return mergeConfig(baseConfig, {
      resolve: {
        alias: {
          '@': path.resolve(storybookDir, '../src'),
          '@shared': path.resolve(storybookDir, '../../shared-client/src'),
        },
      },
    });
  },
};

export default config;
