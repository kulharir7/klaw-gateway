// Generate .ico from SVG using sharp
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function createIco() {
  const svgPath = path.join(__dirname, 'assets', 'icon.svg');
  const icoPath = path.join(__dirname, 'assets', 'icon.ico');
  const pngPath = path.join(__dirname, 'assets', 'icon.png');
  
  // Create 256x256 PNG first
  await sharp(svgPath)
    .resize(256, 256)
    .png()
    .toFile(pngPath);
  
  // Create multiple sizes for ICO
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = await Promise.all(
    sizes.map(size => sharp(svgPath).resize(size, size).png().toBuffer())
  );
  
  // Build ICO file manually
  const iconDir = Buffer.alloc(6 + 16 * pngBuffers.length);
  iconDir.writeUInt16LE(0, 0); // reserved
  iconDir.writeUInt16LE(1, 2); // type: icon
  iconDir.writeUInt16LE(pngBuffers.length, 4); // count
  
  let offset = 6 + 16 * pngBuffers.length;
  const entries = [];
  
  for (let i = 0; i < pngBuffers.length; i++) {
    const size = sizes[i] >= 256 ? 0 : sizes[i];
    const buf = pngBuffers[i];
    const entryOffset = 6 + 16 * i;
    
    iconDir.writeUInt8(size, entryOffset);      // width
    iconDir.writeUInt8(size, entryOffset + 1);  // height
    iconDir.writeUInt8(0, entryOffset + 2);     // color palette
    iconDir.writeUInt8(0, entryOffset + 3);     // reserved
    iconDir.writeUInt16LE(1, entryOffset + 4);  // color planes
    iconDir.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    iconDir.writeUInt32LE(buf.length, entryOffset + 8);  // size
    iconDir.writeUInt32LE(offset, entryOffset + 12);     // offset
    
    entries.push(buf);
    offset += buf.length;
  }
  
  const ico = Buffer.concat([iconDir, ...entries]);
  fs.writeFileSync(icoPath, ico);
  console.log(`Created ${icoPath} (${ico.length} bytes, ${sizes.length} sizes)`);
}

createIco().catch(console.error);
