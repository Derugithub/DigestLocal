const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite on web loads a wasm module and needs SharedArrayBuffer headers.
config.resolver.assetExts.push('wasm');
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    return middleware(req, res, next);
  };
};

// Dev web bundles are built with lazy bundling off (see EXPO_NO_METRO_LAZY) so the
// sqlite worker is in the graph. Metro only writes worker URLs when includeAsyncPaths
// is set, which it ties to lazy mode. Force the URLs so the worker can load.
const upstreamSerializer = config.serializer.customSerializer;
config.serializer.customSerializer = (entryPoint, preModules, graph, options) => {
  return upstreamSerializer(entryPoint, preModules, graph, {
    ...options,
    includeAsyncPaths: true,
  });
};

module.exports = config;
