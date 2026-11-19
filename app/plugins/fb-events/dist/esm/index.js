import { registerPlugin } from '@capacitor/core';

// No web implementation: on web / outside the native app every call rejects with "not implemented".
// Callers should wrap calls in try/catch (or .catch()) so the game never stops on analytics.
const FbEvents = registerPlugin('FbEvents');

export * from './definitions';
export { FbEvents };
