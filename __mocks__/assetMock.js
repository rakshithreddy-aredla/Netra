// Stands in for bundled binary assets (audio, images) under Jest, which has no
// Metro asset pipeline. Expo turns a `require()` of an asset into a module
// object at runtime; this mimics that shape.
module.exports = { uri: 'test-asset-stub', __esModule: true, default: 'test-asset-stub' };