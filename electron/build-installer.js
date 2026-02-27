const createWindowsInstaller = require('electron-winstaller').createWindowsInstaller;
const path = require('path');

async function build() {
  console.log('Building Klaw Windows Installer...');
  console.log('This may take a few minutes...\n');

  try {
    await createWindowsInstaller({
      appDirectory: path.join(__dirname, 'release', 'Klaw-win32-x64'),
      outputDirectory: path.join(__dirname, 'release', 'installer'),
      authors: 'Ravindra Kumar',
      exe: 'Klaw.exe',
      title: 'Klaw',
      name: 'Klaw',
      description: 'AI Desktop Agent - Root access to your digital life',
      version: '0.1.0',
      setupExe: 'Klaw-Setup-0.1.0.exe',
      setupIcon: path.join(__dirname, 'assets', 'icon.ico'),
      iconUrl: 'https://raw.githubusercontent.com/kulharir7/klaw/main/electron/assets/icon.ico',
      noMsi: true,
      setupMsi: undefined,
    });
    
    console.log('\n✅ Installer created successfully!');
    console.log(`   📁 ${path.join(__dirname, 'release', 'installer', 'Klaw-Setup-0.1.0.exe')}`);
  } catch (e) {
    console.error('❌ Build failed:', e.message);
    process.exit(1);
  }
}

build();

