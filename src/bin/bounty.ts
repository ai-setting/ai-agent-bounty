#!/usr/bin/env bun

/**
 * Bounty CLI Binary Entry Point
 * 
 * This is the main executable for the bounty CLI.
 * Usage: bun run src/bin/bounty.ts <command>
 */

// Load environment variables from .env file
import 'dotenv/config';

import { runBountyCli } from '../cli/index.js';

runBountyCli();
