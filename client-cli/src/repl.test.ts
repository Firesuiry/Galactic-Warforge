import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createSerialLineProcessor } from './repl.js';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createSerialLineProcessor', () => {
  it('runs lines strictly in sequence', async () => {
    const order: string[] = [];
    const process = createSerialLineProcessor(async (line: string) => {
      order.push(`start:${line}`);
      await delay(5);
      order.push(`end:${line}`);
    });

    const first = process('one');
    const second = process('two');
    await Promise.all([first, second]);

    assert.deepEqual(order, [
      'start:one',
      'end:one',
      'start:two',
      'end:two',
    ]);
  });
});
