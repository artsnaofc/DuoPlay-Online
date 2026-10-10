import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Lê package.json
const pkgPath = path.join(rootDir, 'package.json');
let pkgVersion = '1.0.0';
try {
  const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgContent);
  pkgVersion = pkg.version || '1.0.0';
} catch {
  // Fallback seguro
}

const commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VITE_GIT_COMMIT_SHA || 'unavailable';
const branch = process.env.VERCEL_GIT_COMMIT_REF || process.env.VITE_GIT_BRANCH || 'unavailable';
const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || 'production';
const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || 'unavailable';
const buildTime = new Date().toISOString();

export interface VersionInfo {
  version: string;
  commit: string;
  branch: string;
  environment: string;
  buildTime: string;
  deploymentId: string;
}

export function generateVersionData(): VersionInfo {
  return {
    version: pkgVersion,
    commit,
    branch,
    environment,
    buildTime,
    deploymentId,
  };
}

export function writeVersionFile(): VersionInfo {
  const data = generateVersionData();
  const publicDir = path.join(rootDir, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const outputPath = path.join(publicDir, 'version.json');
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  return data;
}

// Se executado diretamente via CLI
if (process.argv[1] && process.argv[1].endsWith('generate-version.ts')) {
  const result = writeVersionFile();
  console.log('[generate-version] Arquivo public/version.json gerado com sucesso:');
  console.log(JSON.stringify(result, null, 2));
}
