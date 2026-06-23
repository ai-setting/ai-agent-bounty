#!/usr/bin/env bun

/**
 * Bounty CLI Binary Entry Point
 * 
 * This is the main executable for the bounty CLI.
 * Usage: bun run src/bin/bounty.ts <command>
 */

// Load environment variables from .env file (quiet mode to suppress "injected env" log)
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { runBountyCli } from '../cli/index.js';

runBountyCli();
