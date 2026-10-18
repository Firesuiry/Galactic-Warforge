import { resetPlanetViewStore, usePlanetViewStore } from '@/features/planet-map/store';

describe('requestFocus：聚焦请求', () => {
  beforeEach(() => {
    resetPlanetViewStore();
  });

  it('写入目标格与 nonce，消费后清空', () => {
    usePlanetViewStore.getState().requestFocus({ x: 1, y: 2 });
    const request = usePlanetViewStore.getState().focusRequest;
    expect(request?.position).toEqual({ x: 1, y: 2 });
    expect(typeof request?.nonce).toBe('number');
    usePlanetViewStore.getState().consumeFocusRequest(request!.nonce);
    expect(usePlanetViewStore.getState().focusRequest).toBeNull();
  });
});
