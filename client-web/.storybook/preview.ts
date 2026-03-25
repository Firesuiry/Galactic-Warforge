import type { Preview } from '@storybook/react-vite';

import '../src/styles/index.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'deep-space',
      values: [
        { name: 'deep-space', value: '#090d18' },
        { name: 'night-panel', value: '#0f1526' },
      ],
    },
    layout: 'fullscreen',
  },
};

export default preview;
