module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
  plugins: [
    function () {
      return {
        visitor: {
          MetaProperty(path) {
            path.replaceWithSourceString('({ env: { TWURPLE_MOCK_API_PORT: process.env.TWURPLE_MOCK_API_PORT } })');
          },
        },
      };
    },
  ],
};
