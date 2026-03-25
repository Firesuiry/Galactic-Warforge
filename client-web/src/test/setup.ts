import '@testing-library/jest-dom/vitest';

import { afterEach, beforeEach, vi } from 'vitest';

import { resetPlanetViewStore } from '@/features/planet-map/store';
import { resetSessionStore } from '@/stores/session';

const canvasContextStub = {
  arc: vi.fn(),
  beginPath: vi.fn(),
  clearRect: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  fillRect: vi.fn(),
  fillText: vi.fn(),
  lineTo: vi.fn(),
  measureText: vi.fn((text: string) => ({
    width: text.length * 8,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 4,
  })),
  moveTo: vi.fn(),
  restore: vi.fn(),
  save: vi.fn(),
  setLineDash: vi.fn(),
  setTransform: vi.fn(),
  stroke: vi.fn(),
  strokeRect: vi.fn(),
};

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: vi.fn(() => canvasContextStub),
});

Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
  value: vi.fn(() => 'data:image/png;base64,ZmFrZQ=='),
});

beforeEach(() => {
  localStorage.clear();
  resetSessionStore();
  resetPlanetViewStore();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
