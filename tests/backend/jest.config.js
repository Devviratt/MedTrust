module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.js'],
  coverageDirectory: '../../backend/coverage',
  collectCoverageFrom: [
    '../../backend/src/**/*.js',
    '!../../backend/src/server.js',
  ],
  coverageThreshold: {
    global: { branches: 60, functions: 65, lines: 65, statements: 65 },
  },
  testTimeout: 30000,
  setupFilesAfterEnv: [],
};
