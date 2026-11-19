import { registerPlugin } from '@capacitor/core';
// The game calls it through Capacitor.nativePromise('InstallReferrer', 'get') — this file is only for completeness.
const InstallReferrer = registerPlugin('InstallReferrer');
export * from './definitions';
export { InstallReferrer };
