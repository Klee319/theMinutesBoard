const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 128];
const publicDir = path.join(__dirname, '../public');

// アイコンの色設定
const bgColor = '#1e40af'; // primary-800
const textColor = '#ffffff';

sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // 背景を描画
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);
  
  // 文字を描画
  ctx.fillStyle = textColor;
  ctx.font = `bold ${size * 0.4}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('M', size / 2, size / 2);
  
  // ファイルを保存
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(path.join(publicDir, `icon${size}.png`), buffer);
  console.log(`Generated icon${size}.png`);
});

console.log('All icons generated successfully!');