#!/usr/bin/env node

/**
 * openshift-ci-tests.ts - Entrada principal do pipeline TypeScript
 *
 * Este script replica o comportamento do openshift-ci-tests.sh original:
 * - Lê a variável JOB_NAME do ambiente
 * - Executa o job correspondente
 * - Mantém compatibilidade total com o pipeline CI existente
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configurar timestamp nos logs
process.env.PS4 = '[$(date "+%Y-%m-%d %H:%M:%S")] ';

// Capturar erros globais
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

async function main() {
  const jobName = process.env.JOB_NAME;

  if (!jobName) {
    console.error('ERROR: JOB_NAME environment variable is required');
    process.exit(1);
  }

  console.log(`JOB_NAME: ${jobName}`);
  console.log('Starting TypeScript pipeline...');

  try {
    // Compilar e executar o pipeline principal
    console.log('Building TypeScript files...');
    execSync('npm run build', { stdio: 'inherit', cwd: __dirname });

    // Executar o main.ts com o JOB_NAME configurado e argumentos CLI
    console.log(`Executing job: ${jobName}`);
    const args = process.argv.slice(2).join(' ');
    execSync(`node dist/src/main.js ${args}`, {
      stdio: 'inherit',
      cwd: __dirname,
      env: {
        ...process.env,
        JOB_NAME: jobName,
      },
    });
  } catch (error) {
    console.error('Pipeline execution failed:', error);
    process.exit(1);
  }
}

// Executar
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
