const path = require("node:path");
const fs = require("node:fs");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const appRepoRoot = path.resolve(projectRoot, "../..");
const corePackagesRoot = path.resolve(appRepoRoot, "../Tonehub/packages");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

const watchFolders = [appRepoRoot, corePackagesRoot];
// Optional short pnpm store on Windows (see local .npmrc virtual-store-dir).
const pnpmStore = "C:\\p";
if (fs.existsSync(pnpmStore)) watchFolders.push(pnpmStore);
config.watchFolders = watchFolders;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(appRepoRoot, "node_modules"),
];
const expoFontShim = path.resolve(projectRoot, "src/shims/expo-font.js");
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "react-native-worklets": path.resolve(projectRoot, "node_modules/react-native-worklets"),
  "expo-font": expoFontShim,
};
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "expo-font" || moduleName.startsWith("expo-font/")) {
    return { filePath: expoFontShim, type: "sourceFile" };
  }
  if (defaultResolve) return defaultResolve(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
