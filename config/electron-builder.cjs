// electron-builder 打包配置(CommonJS:electron-builder 直接 require 此文件)。
// 打包:npm run build && electron-builder --win nsis --config config/electron-builder.cjs
// 二进制下载走 npmmirror:ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
module.exports = {
  appId: 'app.cutforge.desktop',
  productName: 'CutForge',
  directories: {
    output: 'release',
    buildResources: 'assets',
  },
  files: [
    'dist/**/*',
    'electron/**/*',
    'package.json',
  ],
  win: {
    icon: 'assets/icon.png',
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    artifactName: 'CutForge-Setup-${version}.${ext}',
  },
};
