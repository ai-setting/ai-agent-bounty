# @ai-setting/agent-bounty-standalone

AI Agent Bounty System — Standalone native binaries for all platforms. No Bun or Node runtime required at install time (binaries embed all dependencies).

## Installation

```bash
npm install -g @ai-setting/agent-bounty-standalone
```

Or use directly with npx:

```bash
npx @ai-setting/agent-bounty-standalone --help
```

After global install, the `bounty` command is available everywhere:

```bash
bounty --help
bounty --version
bounty act "Hello, world!"
```

## Supported Platforms

| Platform | Architecture | Binary |
|----------|-------------|--------|
| Linux | x64 | `bounty-linux-x64` |
| Linux | arm64 | `bounty-linux-arm64` |
| macOS | x64 (Intel) | `bounty-darwin-x64` |
| macOS | arm64 (Apple Silicon) | `bounty-darwin-arm64` |
| Windows | x64 | `bounty-windows-x64.exe` |

The package's `bin/run.js` auto-detects your platform (`process.platform` + `process.arch`) and exec's the matching binary. If the platform-specific binary is missing, it falls back to any available `bounty-*` binary in the same directory.

## Usage

```bash
# Show version
bounty --version

# Show help
bounty --help

# Run interactive mode
bounty

# Run a one-shot command
bounty act "Write a hello world in Python"
```

## Development Build

This standalone package is built from the [ai-agent-bounty](https://github.com/ai-setting/ai-agent-bounty) monorepo root. To rebuild it locally:

```bash
cd /path/to/ai-agent-bounty

# Show help
bun run scripts/build-standalone.ts --help

# Build current platform only
bun run scripts/build-standalone.ts

# Build current platform + npm pack to .tgz (dry-run, no publish)
bun run scripts/build-standalone.ts --dry-run

# Build all platforms (linux, macOS, Windows)
bun run scripts/build-standalone.ts --all

# Build and publish to npmjs
bun run scripts/build-standalone.ts --publish

# Build all platforms and publish
bun run scripts/build-standalone.ts --all --publish

# Specify version
bun run scripts/build-standalone.ts --version 0.5.0 --publish
```

Or use the npm scripts in the root `package.json`:

```bash
# Build current platform
npm run build:standalone

# Build all platforms
npm run build:standalone:all

# Dry-run: build + npm pack (no publish)
npm run build:standalone:dry-run
npm run build:standalone:all:dry-run

# Build and publish to npmjs
npm run build:standalone:publish
npm run build:standalone:all:publish
```

### Notes

- The build uses [`Bun.build({ compile })`](https://bun.sh/docs/bundler/executables) to produce single-file native executables that embed all JavaScript dependencies (including private packages like `@ai-setting/roy-agent-cli`, `@ai-setting/roy-agent-core`, `@ai-setting/roy-agent-coder-harness`).
- **Windows binaries must be built on Windows.** Cross-compiling Linux → Windows with `bun build --compile` is not currently supported. Run `bun run build:standalone` on a Windows machine to produce the `bounty-windows-x64.exe` binary.
- Resulting binaries are ~100–150 MB each (private npm deps dominate the size).

## Repository

- Source: [github.com/ai-setting/ai-agent-bounty](https://github.com/ai-setting/ai-agent-bounty)
- Directory: `bounty-standalone/`

## License

MIT