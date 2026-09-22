#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stderr, stdin, stdout } from 'node:process';

import { runReleaseCli } from './release/release.lib.mjs';

const runner = {
  run(command, args, options = {}) {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) throw result.error;
    if (result.signal) {
      throw new Error(
        options.interruptionMessage ??
          `${command} ${args.join(' ')} was interrupted by ${result.signal}.`,
      );
    }
    const outcome = {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
    if (outcome.status !== 0 && !options.allowFailure) {
      const detail = (outcome.stderr || outcome.stdout).trim();
      throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : '.'}`);
    }
    return outcome;
  },
};

async function prompt(question) {
  const readline = createInterface({ input: stdin, output: stderr });
  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

try {
  const exitCode = await runReleaseCli(process.argv.slice(2), {
    cwd: process.cwd(),
    isTTY: Boolean(stdin.isTTY && stdout.isTTY),
    now: () => new Date(),
    prompt,
    runner,
    write: (message) => stdout.write(`${message}\n`),
  });
  process.exitCode = exitCode;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (process.argv.slice(2).includes('--json')) {
    stdout.write(`${JSON.stringify({ status: 'error', error: message }, null, 2)}\n`);
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}
