import { optimizeSouls } from '../../../../shared/soul-optimizer';
import type { OptimizationOptions, SuitProfile } from '../../../../shared/soul-optimizer';
import type { SoulRecord } from '../../../../shared/souls';

let cancelled = false;
self.onmessage = (event: MessageEvent<{ type: string; souls: SoulRecord[]; suits: SuitProfile[]; options: OptimizationOptions }>) => {
  if (event.data.type === 'cancel') { cancelled = true; return; }
  cancelled = false;
  const { souls, suits, options } = event.data;
  void optimizeSouls(souls, suits, options, progress => self.postMessage({ type: 'progress', progress }), () => cancelled)
    .then(result => self.postMessage({ type: 'result', result }))
    .catch((error: unknown) => self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }));
};
