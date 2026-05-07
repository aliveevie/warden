module.exports = {
  rootDir: __dirname,
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],
  moduleNameMapper: {
    "^@warden/fhe$":      "<rootDir>/packages/fhe/src/index.ts",
    "^@warden/custody$":  "<rootDir>/packages/custody/src/index.ts",
    "^@warden/sdk$":      "<rootDir>/packages/sdk/src/index.ts",
    "^@warden/brain$":    "<rootDir>/packages/brain/src/index.ts",
    "^@warden/settlement$": "<rootDir>/packages/settlement/src/index.ts",
  },
  setupFiles: ["<rootDir>/jest.setup.js"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { isolatedModules: true, tsconfig: { target: "ES2020", module: "commonjs", esModuleInterop: true, strict: false } }],
  },
};
