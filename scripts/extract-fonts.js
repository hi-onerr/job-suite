const path = require('path')
const fs = require('fs')

const vfsModule = require('../node_modules/pdfmake/build/vfs_fonts.js')
const vfs = vfsModule.pdfMake?.vfs || vfsModule.vfs || vfsModule

const outDir = path.join(__dirname, '../public/fonts')
fs.mkdirSync(outDir, { recursive: true })

const fonts = [
  'Roboto-Regular.ttf',
  'Roboto-Medium.ttf',
  'Roboto-Italic.ttf',
  'Roboto-MediumItalic.ttf',
]
for (const font of fonts) {
  if (vfs[font]) {
    const buf = Buffer.from(vfs[font], 'base64')
    fs.writeFileSync(path.join(outDir, font), buf)
    console.log(`✓ ${font} (${(buf.length / 1024).toFixed(0)} KB)`)
  } else {
    console.warn(`✗ ${font} not found in VFS`)
  }
}
console.log('Done.')
