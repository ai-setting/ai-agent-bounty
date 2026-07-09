#!/usr/bin/env bun
/**
 * Standalone 包构建脚本（单包结构）
 *
 * 功能：
 * 1. 用 Bun.build({ compile }) 把 CLI 入口编译成原生二进制（多平台）
 * 2. 复制到 bounty-standalone/bin/bounty-<os>-<arch>
 * 3. 可选：把 bounty-standalone/ 包发布到 npmjs（--publish）或本地 pack（--dry-run）
 *
 * 使用：
 *   bun run scripts/build-standalone.ts               # 仅构建当前平台
 *   bun run scripts/build-standalone.ts --all         # 构建全平台
 *   bun run scripts/build-standalone.ts --publish     # 构建当前平台并发布到 npmjs
 *   bun run scripts/build-standalone.ts --all --publish   # 全平台构建并发布
 *   bun run scripts/build-standalone.ts --dry-run     # 仅 pack 到 .tgz，不发布
 *   bun run scripts/build-standalone.ts --version 0.5.0  # 指定版本号
 */

import path from "path";
import fs from "fs";
import { mkdir, chmod } from "node:fs/promises";
import { $ } from "bun";

const ROOT = path.resolve(".");
const STANDALONE_ROOT = path.join(ROOT, "bounty-standalone");

// 解析命令行参数
const args = process.argv.slice(2);

// 帮助信息
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
🏗️  Bounty Standalone Build Script

用法:
  bun run scripts/build-standalone.ts [选项]

选项:
  --help, -h          显示帮助信息
  --all               构建所有平台 (linux-arm64, linux-x64, darwin-arm64, darwin-x64, windows-x64)
  --publish           构建后发布到 npmjs
  --dry-run           仅构建 + npm pack（不出到 npmjs），用于本地验证
  --version <ver>     指定版本号 (默认使用 bounty-standalone/package.json 中的版本)

默认行为:
  - 不带 --all: 仅构建当前平台 ($(uname -s)-$(uname -m))
  - 不带 --publish: 仅构建，不打包
  - 不带 --dry-run: 不生成 .tgz

示例:
  # 仅构建当前平台二进制
  bun run scripts/build-standalone.ts

  # 构建并 pack 出 .tgz（本地验证）
  bun run scripts/build-standalone.ts --dry-run

  # 全平台构建
  bun run scripts/build-standalone.ts --all

  # 构建并发布到 npmjs
  bun run scripts/build-standalone.ts --publish

  # 全平台构建并发布
  bun run scripts/build-standalone.ts --all --publish

  # 指定版本号 + 发布
  bun run scripts/build-standalone.ts --version 0.5.0 --publish

npm 脚本:
  npm run build:standalone             # 当前平台构建
  npm run build:standalone:all         # 全平台构建
  npm run build:standalone:publish     # 当前平台构建 + 发布
  npm run build:standalone:all:publish # 全平台构建 + 发布
  npm run build:standalone:dry-run     # 当前平台 + npm pack
  npm run build:standalone:all:dry-run # 全平台 + npm pack

注意:
  - Windows 二进制只能在 Windows 上原生构建；Linux 上 --all 会跳过 windows。
  - 编译产物会 embed 所有 dependencies；bounty 依赖 @ai-setting/roy-agent-cli 等私有包，
    必须先有 node_modules 才能 build。
`);
  process.exit(0);
}

const PUBLISH_FLAG = args.includes("--publish");
const DRY_RUN_FLAG = args.includes("--dry-run");
const ALL_FLAG = args.includes("--all");

if (PUBLISH_FLAG && DRY_RUN_FLAG) {
  console.error("❌ --publish 和 --dry-run 互斥，请只用一个。");
  process.exit(1);
}

// 解析版本号参数
const versionIndex = args.indexOf("--version");
const STANDALONE_PKG_PATH = path.join(STANDALONE_ROOT, "package.json");
const ROOT_PKG_PATH = path.join(ROOT, "package.json");
const STANDALONE_PKG = JSON.parse(fs.readFileSync(STANDALONE_PKG_PATH, "utf-8"));
const ROOT_PKG = JSON.parse(fs.readFileSync(ROOT_PKG_PATH, "utf-8"));

// 版本优先级：命令行参数 > standalone package.json > root package.json
const DEFAULT_VERSION =
  STANDALONE_PKG.version || ROOT_PKG.version || "0.4.0";
const TARGET_VERSION =
  versionIndex !== -1 && args[versionIndex + 1]
    ? args[versionIndex + 1]
    : DEFAULT_VERSION;

const CHANNEL = process.env.CHANNEL || "dev";

// 平台定义
const TARGETS = [
  { os: "linux", arch: "arm64", name: "linux-arm64" },
  { os: "linux", arch: "x64", name: "linux-x64" },
  { os: "darwin", arch: "arm64", name: "darwin-arm64" },
  { os: "darwin", arch: "x64", name: "darwin-x64" },
  { os: "win32", arch: "x64", name: "windows-x64" },
];

const builtBinaries: string[] = [];
const skippedBinaries: string[] = [];

/**
 * 判断当前平台是否能构建某个目标平台
 * Bun.build 的 compile target 在 Linux 上不支持 windows 跨编译（Win 需在 Win 上原生构建）
 */
function canBuildTarget(target: { os: string; arch: string }): boolean {
  // Windows 二进制必须在 Windows 上构建
  if (target.os === "win32" && process.platform !== "win32") {
    return false;
  }
  return true;
}

async function buildPlatform(target: (typeof TARGETS)[number]) {
  const { os, arch, name } = target;

  if (!canBuildTarget(target)) {
    console.log(
      `\n⏭️  Skipping bounty-${name} (cross-compile not supported on ${process.platform})`,
    );
    skippedBinaries.push(`${name} (cross-compile unsupported)`);
    return false;
  }

  console.log(`\n📦 Building bounty-${name}...`);

  const outDir = path.join(STANDALONE_ROOT, "bin");
  await mkdir(outDir, { recursive: true });

  const outfile =
    os === "win32"
      ? path.join(outDir, `bounty-${name}.exe`)
      : path.join(outDir, `bounty-${name}`);

  const targetTriple = `bun-${os}-${arch}` as any;

  const buildResult = await Bun.build({
    conditions: ["import", "module", "default"],
    tsconfig: path.join(ROOT, "tsconfig.json"),
    entrypoints: [path.join(ROOT, "src", "bin", "bounty.ts")],
    root: ROOT,
    compile: {
      target: targetTriple,
      outfile,
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
    },
    define: {
      BOUNTY_VERSION: `"${TARGET_VERSION}"`,
      BOUNTY_CHANNEL: `"${CHANNEL}"`,
    },
    sourcemap: "none",
  });

  if (!buildResult.success) {
    console.log(`  ✗ Build failed`);
    for (const log of buildResult.logs) {
      console.log(`    [${log.level}] ${log.message}`);
    }
    return false;
  }

  if (os !== "win32") {
    await chmod(outfile, 0o755);
  }

  builtBinaries.push(name);
  console.log(`  ✓ Built ${path.relative(ROOT, outfile)}`);
  return true;
}

async function updateStandaloneVersion() {
  STANDALONE_PKG.version = TARGET_VERSION;
  await fs.promises.writeFile(
    STANDALONE_PKG_PATH,
    JSON.stringify(STANDALONE_PKG, null, 2) + "\n",
    "utf-8",
  );
  console.log(`\n📝 Updated bounty-standalone version to ${TARGET_VERSION}`);
}

async function publishStandalone() {
  console.log(
    `\n🚀 Publishing @ai-setting/agent-bounty-standalone@${TARGET_VERSION} to npmjs...`,
  );

  try {
    const result =
      await $`cd ${STANDALONE_ROOT} && npm publish --access public --no-git-checks --registry https://registry.npmjs.org/`.text();
    console.log(`\n✅ Published successfully!`);
    console.log(result);
    return true;
  } catch (error: any) {
    console.log(`\n❌ Publish failed:`);
    console.log(error.stdout || error.message);
    return false;
  }
}

async function packStandalone() {
  console.log(
    `\n📦 Packing @ai-setting/agent-bounty-standalone@${TARGET_VERSION} (dry-run)...`,
  );

  try {
    // --pack-destination 把 .tgz 放在 bounty-standalone/ 根目录，方便后续验证
    const result =
      await $`cd ${STANDALONE_ROOT} && npm pack --pack-destination=${STANDALONE_ROOT}`.text();
    const tgzName = result.trim().split("\n").pop()?.trim();
    console.log(`\n✅ Pack completed!`);
    if (tgzName) {
      console.log(`   ${path.join(STANDALONE_ROOT, tgzName)}`);
    }
    return true;
  } catch (error: any) {
    console.log(`\n❌ Pack failed:`);
    console.log(error.stdout || error.message);
    return false;
  }
}

async function verifyVersion() {
  console.log(`\n🔍 Verifying...`);

  // 检查当前平台二进制
  const platformName = `${process.platform}-${process.arch}`;
  const binaryCandidates = [
    path.join(STANDALONE_ROOT, "bin", `bounty-${platformName}`),
    path.join(STANDALONE_ROOT, "bin", `bounty-${platformName}.exe`),
  ];

  for (const bin of binaryCandidates) {
    if (fs.existsSync(bin)) {
      const stats = await fs.promises.stat(bin);
      const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`  ✓ Binary:    ${path.relative(ROOT, bin)} (${sizeMb} MB)`);
      break;
    }
  }

  console.log(`  ✓ Package:   @ai-setting/agent-bounty-standalone@${TARGET_VERSION}`);
  console.log(`  ✓ Channel:   ${CHANNEL}`);
  console.log(`  ✓ Built:     ${builtBinaries.length}, Skipped: ${skippedBinaries.length}`);
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`🏗️  Bounty Standalone Build Script`);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Version:    ${TARGET_VERSION}`);
  console.log(`  Channel:    ${CHANNEL}`);
  console.log(`  Platform:   ${process.platform}-${process.arch}`);
  console.log(`  Mode:       ${ALL_FLAG ? "all platforms" : "current platform only"}`);
  console.log(`  Publish:    ${PUBLISH_FLAG ? "yes (npmjs)" : DRY_RUN_FLAG ? "dry-run (npm pack)" : "no"}`);
  console.log("───────────────────────────────────────────────────────────────");

  // 确定要构建的平台
  const targets = ALL_FLAG
    ? TARGETS
    : TARGETS.filter((t) => t.os === process.platform && t.arch === process.arch);

  if (targets.length === 0) {
    console.log(
      `\n⚠️  No matching platform found for current system (${process.platform}-${process.arch})`,
    );
    console.log(`    Use --all to build all platforms`);
    process.exit(1);
  }

  // 更新版本号
  await updateStandaloneVersion();

  // 构建每个平台
  console.log(`\n📦 Building ${targets.length} platform(s)...`);

  for (const target of targets) {
    await buildPlatform(target);
  }

  // 验证
  await verifyVersion();

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`✅ Build complete!`);
  console.log(`   Built:    ${builtBinaries.length} (${builtBinaries.join(", ") || "none"})`);
  if (skippedBinaries.length > 0) {
    console.log(`   Skipped:  ${skippedBinaries.length} (${skippedBinaries.join(", ")})`);
  }
  console.log("───────────────────────────────────────────────────────────────");

  // 发布 / Pack
  if (PUBLISH_FLAG) {
    console.log("\n🚀 Starting publish...");
    const success = await publishStandalone();
    if (!success) {
      console.log("\n❌ Publish failed. Please check the error above.");
      process.exit(1);
    }
  } else if (DRY_RUN_FLAG) {
    console.log("\n📦 Starting dry-run pack...");
    const success = await packStandalone();
    if (!success) {
      console.log("\n❌ Pack failed. Please check the error above.");
      process.exit(1);
    }
    console.log("\n💡 To install locally for verification:");
    console.log(
      `   npm install -g ${path.join(STANDALONE_ROOT, "ai-setting-agent-bounty-standalone-" + TARGET_VERSION + ".tgz")}`,
    );
  } else {
    console.log("\n💡 Next steps:");
    console.log(`   • Dry-run:    bun run scripts/build-standalone.ts --dry-run`);
    console.log(`   • Publish:    bun run scripts/build-standalone.ts --publish`);
    console.log(`   • All + publish: bun run scripts/build-standalone.ts --all --publish`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
}

// Run
main().catch((err) => {
  console.error("\n❌ Unexpected error:", err);
  process.exit(1);
});