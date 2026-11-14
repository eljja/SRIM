import { TrimSimulator } from '../physics/trim';
import type { TrimSetupConfig, TrimSnapshot } from '../physics/types';

export type TrimWorkerRequest =
  | { type: 'INIT'; config: TrimSetupConfig }
  | { type: 'RUN_BATCH'; count: number }
  | { type: 'GET_SNAPSHOT' };

export type TrimWorkerResponse = {
  type: 'SNAPSHOT';
  snapshot: TrimSnapshot;
};

let simulator: TrimSimulator | null = null;

self.onmessage = (event: MessageEvent<TrimWorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'INIT') {
    simulator = new TrimSimulator(msg.config);
    const snapshot = simulator.getSnapshot();
    self.postMessage({ type: 'SNAPSHOT', snapshot } satisfies TrimWorkerResponse);
  } else if (msg.type === 'RUN_BATCH' && simulator) {
    const snapshot = simulator.runBatch(msg.count);
    self.postMessage({ type: 'SNAPSHOT', snapshot } satisfies TrimWorkerResponse);
  } else if (msg.type === 'GET_SNAPSHOT' && simulator) {
    const snapshot = simulator.getSnapshot();
    self.postMessage({ type: 'SNAPSHOT', snapshot } satisfies TrimWorkerResponse);
  }
};
