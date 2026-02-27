const createWindowsInstaller = require('electron-winstaller').createWindowsInstaller;
const path = require('path');

async function build() {
  console.log('Building Root AI Windows Installer...');
  console.log('This may take a few minutes...\n');

  try {
    await createWindowsInstaller({
      appDirectory: path.join(__dirname, 'release', 'Root AI-win32-x64'),
      outputDirectory: path.join(__dirname, 'release', 'installer'),
      authors: 'Ravindra Kumar',
      exe: 'Root AI.exe',
      title: 'Root AI',
      name: 'RootAI',
      description: 'AI Desktop Agent - Root access to your digital life',
      version: '0.1.0',
      setupExe: 'RootAI-Setup-0.1.0.exe',
      setupIcon: path.join(__dirname, 'assets', 'icon.ico'),
      iconUrl: 'https://raw.githubusercontent.com/kulharir7/root-ai/main/electron/assets/icon.ico',
      noMsi: true,
      setupMsi: undefined,
    });
    
    console.log('\n✅ Installer created successfully!');
    console.log(`   📁 ${path.join(__dirname, 'release', 'installer', 'RootAI-Setup-0.1.0.exe')}`);
  } catch (e) {
    console.error('❌ Build failed:', e.message);
    process.exit(1);
  }
}

build();
