module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.js'],
  coverageDirectory: '../../backend/coverage',
  moduleDirectories: ['node_modules', '../../backend/node_modules'],
  collectCoverageFrom: [
    '../../backend/src/**/*.js',
    '!../../backend/src/server.js',
  ],
  testTimeout: 30000,
  setupFilesAfterEnv: [],
};
