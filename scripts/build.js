const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
const targets = process.argv.slice(2).filter(Boolean);
const requestedTargets = targets.length ? targets : ['portable', 'nsis'];
const builderTargets = requestedTargets.includes('nsis')
  ? [...new Set(['portable', ...requestedTargets])]
  : requestedTargets;
const helperSource = path.join(projectDir, 'src', 'native', 'XuanNianClipboardHelper.cs');
const helperOutput = path.join(projectDir, 'src', 'native', 'XuanNianClipboardHelper.exe');
const frameworkRoots = [
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

const shouldBuildHelper = !fs.existsSync(helperOutput)
  || fs.statSync(helperSource).mtimeMs > fs.statSync(helperOutput).mtimeMs;

if (shouldBuildHelper) {
  const csc = frameworkRoots.find((file) => fs.existsSync(file));
  if (!csc) {
    throw new Error('Windows C# compiler was not found.');
  }
  run(csc, [
    '/nologo',
    '/target:winexe',
    '/optimize+',
    '/platform:anycpu',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    `/out:${helperOutput}`,
    helperSource,
  ]);
}

const portableTemplate = path.join(
  projectDir,
  'node_modules',
  'app-builder-lib',
  'templates',
  'nsis',
  'portable.nsi',
);
const originalTemplate = fs.readFileSync(portableTemplate, 'utf8');
function stripXuanNianPortableMutex(template) {
  return String(template).replace(
    /  System::Call 'kernel32::CreateMutexW\(i 0, i 0, w "Local\\\\*XuanNian2PortableLauncher"\) p\.r1'\r?\n  System::Call 'kernel32::GetLastError\(\) i\.r0'\r?\n  \$\{If\} \$0 = 183\r?\n    Quit\r?\n  \$\{EndIf\}\r?\n/g,
    '',
  );
}
const cleanTemplate = stripXuanNianPortableMutex(originalTemplate);
const mutexBlock = [
  'Function .onInit',
  '  System::Call \'kernel32::CreateMutexW(i 0, i 0, w "Local\\XuanNian2PortableLauncher") p.r1\'',
  '  System::Call \'kernel32::GetLastError() i.r0\'',
  '  ${If} $0 = 183',
  '    Quit',
  '  ${EndIf}',
].join('\n');
const patchedTemplate = cleanTemplate.replace('Function .onInit', mutexBlock);

try {
  if (builderTargets.includes('portable')) {
    fs.writeFileSync(portableTemplate, patchedTemplate, 'utf8');
  }

  const builder = path.join(projectDir, 'node_modules', '.bin', 'electron-builder.cmd');
  const electronDist = path.join(projectDir, 'node_modules', 'electron', 'dist');
  const outputDir = process.env.XUANNIAN_BUILD_OUTPUT
    ? path.resolve(process.env.XUANNIAN_BUILD_OUTPUT)
    : '';
  run(builder, [
    '--win',
    ...builderTargets,
    '--publish',
    'never',
    `--config.electronDist=${electronDist}`,
    ...(outputDir ? [`--config.directories.output=${outputDir}`] : []),
  ], { shell: true });
} finally {
  fs.writeFileSync(portableTemplate, cleanTemplate, 'utf8');
}
