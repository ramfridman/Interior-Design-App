/** Web Worker entry of the daylight solver (module worker). See engine.js for the message protocol. */
import { createEngine } from './engine.js';

const engine = createEngine((msg, transfer) => self.postMessage(msg, transfer || []));
self.onmessage = (e) => engine.handle(e.data);
