// Tests must replace fetch explicitly with a local fake. Never contact configured providers.
globalThis.fetch=async()=>{throw new Error('OFFLINE_TEST_NETWORK_BLOCKED: replace fetch with an explicit test fake');};
