/**
 * Generate placeholder icons for Klaw desktop app.
 * Run: node electron/create-icons.js
 * 
 * Creates icon.png (256x256) and tray-icon.png (32x32)
 * using sharp (already in dependencies).
 */
const sharp = require('sharp');
const path = require('path');

async function createIcon(size, filename) {
  // Purple gradient K icon
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#7c3aed"/>
        <stop offset="100%" stop-color="#4f46e5"/>
      </linearGradient>
    </defs>
    <rect width="256" height="256" rx="48" fill="url(#bg)"/>
    <text x="128" y="185" font-family="Arial,sans-serif" font-size="180" font-weight="bold" 
          fill="white" text-anchor="middle">K</text>
    <path d="M180 55 L195 45 L200 55 L190 52Z" fill="#f59e0b" opacity="0.9"/>
    <path d="M195 60 L210 50 L215 60 L205 57Z" fill="#f59e0b" opacity="0.7"/>
    <path d="M205 70 L220 60 L225 70 L215 67Z" fill="#f59e0b" opacity="0.5"/>
  </svg>`;

  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(path.join(__dirname, filename));
  
  console.log(`Created ${filename} (${size}x${size})`);
}

async function main() {
  await createIcon(256, 'icon.png');
  await createIcon(32, 'tray-icon.png');
  console.log('Done!');
}

main().catch(console.error);
