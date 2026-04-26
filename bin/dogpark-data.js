#!/usr/bin/env node

import { runDogparkDataCommand } from "../lib/release/index.js";

/**
 * @param {unknown} error
 */
const reportError = (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
};

void runDogparkDataCommand(process.argv.slice(2)).catch(reportError);
