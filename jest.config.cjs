module.exports = {
  rootDir: __dirname,
  testEnvironment: "node",
  testTimeout: 60000,
  transform: {
    "^.+\\.[tj]sx?$": "babel-jest",
  },
  moduleNameMapper: {
    "^openai$": "<rootDir>/tests/jest/openaiStub.js",
    "^react$": "<rootDir>/node_modules/react",
    "^react-dom$": "<rootDir>/node_modules/react-dom",
    "^react-dom/client$": "<rootDir>/node_modules/react-dom/client",
    "\\.(css|scss|sass|less)$": "identity-obj-proxy",
  },
  setupFilesAfterEnv: ["<rootDir>/tests/jest/setupTests.js"],
  testPathIgnorePatterns: ["/node_modules/", "/backend/node_modules/", "/frontend/node_modules/"],
};
