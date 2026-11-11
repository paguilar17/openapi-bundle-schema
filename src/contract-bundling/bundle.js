const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const governanceRoot = path.resolve(__dirname, '..', '..');
const projectRoot = path.resolve(governanceRoot, '..', '..');
const projectName = path.basename(projectRoot);

const inputFile = path.join(
  projectRoot,
  'design',
  `${projectName}-expanded.yaml`
);

const outputDirectory = path.join(projectRoot, 'api');
const outputFile = path.join(outputDirectory, `${projectName}.yaml`);

const normalizerFile = path.join(
  __dirname,
  'normalize-external-schemas.js'
);

const redoclyCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log(String.raw`
  █████╗ ██████╗ ██╗
 ██╔══██╗██╔══██╗██║
 ███████║██████╔╝██║
 ██╔══██║██╔═══╝ ██║
 ██║  ██║██║     ██║
 ╚═╝  ╚═╝╚═╝     ╚═╝

  ██████╗  ██████╗ ██╗   ██╗███████╗██████╗ ███╗   ██╗ █████╗ ███╗   ██╗ ██████╗███████╗
 ██╔════╝ ██╔═══██╗██║   ██║██╔════╝██╔══██╗████╗  ██║██╔══██╗████╗  ██║██╔════╝██╔════╝
 ██║  ███╗██║   ██║██║   ██║█████╗  ██████╔╝██╔██╗ ██║███████║██╔██╗ ██║██║     █████╗
 ██║   ██║██║   ██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██║╚██╗██║██╔══██║██║╚██╗██║██║     ██╔══╝
 ╚██████╔╝╚██████╔╝ ╚████╔╝ ███████╗██║  ██║██║ ╚████║██║  ██║██║ ╚████║╚██████╗███████╗
  ╚═════╝  ╚═════╝   ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝╚══════╝

  :: Contract Bundle ::
  :: Project: ${projectName}
  :: Starting contract expansion and packaging ::
`);

if (!fs.existsSync(inputFile)) {
  throw new Error(`No se encontró el contrato expandido: ${inputFile}`);
}

fs.mkdirSync(outputDirectory, { recursive: true });

const normalizationResult = spawnSync(
  process.execPath,
  [normalizerFile, inputFile, inputFile],
  {
    cwd: projectRoot,
    stdio: 'inherit'
  }
);

if (normalizationResult.error) {
  throw normalizationResult.error;
}

if (normalizationResult.status !== 0) {
  process.exit(normalizationResult.status ?? 1);
}

const result = spawnSync(
  redoclyCommand,
  [
    '@redocly/cli',
    'bundle',
    inputFile,
    '-o',
    outputFile,
    '--ext',
    'yaml'
  ],
  {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true
  }
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Bundle generado: ${outputFile}`);