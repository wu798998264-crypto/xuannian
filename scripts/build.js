const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveAzureSigningConfig } = require('./azure-signing-config');

const projectDir = path.resolve(__dirname, '..');
const targets = process.argv.slice(2).filter(Boolean);
const requestedTargets = targets.length ? targets : ['portable', 'nsis'];
const builderTargets = requestedTargets.includes('nsis')
  ? [...new Set(['portable', ...requestedTargets])]
  : requestedTargets;
const azureSigning = resolveAzureSigningConfig(process.env);
const nativeHelpers = [
  {
    source: path.join(projectDir, 'src', 'native', 'XuanNianClipboardHelper.cs'),
    output: path.join(projectDir, 'src', 'native', 'XuanNianClipboardHelper.exe'),
    references: ['System.Drawing.dll', 'System.Windows.Forms.dll'],
  },
  {
    source: path.join(projectDir, 'src', 'native', 'XuanNianFileSearchHelper.cs'),
    output: path.join(projectDir, 'src', 'native', 'XuanNianFileSearchHelper.exe'),
    references: ['System.Windows.Forms.dll', 'System.Web.Extensions.dll'],
  },
  {
    source: path.join(projectDir, 'src', 'native', 'XuanNianSearchSetup.cs'),
    output: path.join(projectDir, 'src', 'native', 'XuanNianSearchSetup.exe'),
    references: [],
    icon: path.join(projectDir, 'src', 'xuannian-logo.ico'),
  },
];
const frameworkRoots = [
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft Visual Studio', '2022', 'Enterprise', 'MSBuild', 'Current', 'Bin', 'Roslyn', 'csc.exe'),
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft Visual Studio', '2022', 'Professional', 'MSBuild', 'Current', 'Bin', 'Roslyn', 'csc.exe'),
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft Visual Studio', '2022', 'Community', 'MSBuild', 'Current', 'Bin', 'Roslyn', 'csc.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', '2022', 'BuildTools', 'MSBuild', 'Current', 'Bin', 'Roslyn', 'csc.exe'),
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft Visual Studio', '2022', 'BuildTools', 'MSBuild', 'Current', 'Bin', 'Roslyn', 'csc.exe'),
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

const skipHelperBuild = process.env.XUANNIAN_SKIP_HELPER_BUILD === '1';
const missingHelpers = nativeHelpers.filter(({ output }) => !fs.existsSync(output));
if (skipHelperBuild && missingHelpers.length) {
  throw new Error(`Native helper is required but missing: ${missingHelpers.map(({ output }) => output).join(', ')}`);
}

const helpersToBuild = skipHelperBuild
  ? []
  : nativeHelpers.filter(({ source, output }) => (
      !fs.existsSync(output) || fs.statSync(source).mtimeMs > fs.statSync(output).mtimeMs
    ));

if (helpersToBuild.length) {
  const csc = frameworkRoots.find((file) => fs.existsSync(file));
  if (!csc) {
    throw new Error('Windows C# compiler was not found.');
  }
  for (const helper of helpersToBuild) {
    run(csc, [
      '/nologo',
      '/target:winexe',
      '/optimize+',
      '/platform:anycpu',
      ...helper.references.map((reference) => `/reference:${reference}`),
      ...(helper.icon ? [`/win32icon:${helper.icon}`] : []),
      `/out:${helper.output}`,
      helper.source,
    ]);
  }
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
  const electronDistArg = fs.existsSync(electronDist) ? [`--config.electronDist=${electronDist}`] : [];
  const outputDir = process.env.XUANNIAN_BUILD_OUTPUT
    ? path.resolve(process.env.XUANNIAN_BUILD_OUTPUT)
    : '';
  run(builder, [
    '--win',
    ...builderTargets,
    '--publish',
    'never',
    ...electronDistArg,
    ...azureSigning.args,
    ...(outputDir ? [`--config.directories.output=${outputDir}`] : []),
  ], { shell: true });
} finally {
  fs.writeFileSync(portableTemplate, cleanTemplate, 'utf8');
}
