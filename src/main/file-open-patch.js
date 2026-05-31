// Append vào cuối main.js — đọc file text qua native Open dialog
// Dùng cho TLS secret: user chọn .crt / .key / .pem từ disk

ipcMain.handle('file:open-text', async (_, opts = {}) => {
  const {
    title = 'Chọn file',
    filters = [
      { name: 'PEM / Cert / Key', extensions: ['pem', 'crt', 'key', 'cer', 'ca-bundle'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  } = opts

  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ['openFile'],
    filters,
  })

  if (result.canceled || !result.filePaths?.length) {
    return { ok: false, canceled: true }
  }

  const filePath = result.filePaths[0]
  try {
    // Giới hạn 2 MB — PEM cert / key không bao giờ lớn hơn thế
    const stat = fs.statSync(filePath)
    if (stat.size > 2 * 1024 * 1024) {
      return { ok: false, error: 'File quá lớn (giới hạn 2 MB)' }
    }
    const content = fs.readFileSync(filePath, 'utf8')
    const fileName = path.basename(filePath)
    return { ok: true, content, fileName, filePath }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
