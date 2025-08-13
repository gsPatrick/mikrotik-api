// src/features/system/system.controller.js
const systemService = require('./system.service');
const fs = require('fs');

const downloadBackup = async (req, res) => {
  try {
    const { filePath, fileName } = await systemService.backupDatabase();
    
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Erro ao enviar o arquivo de backup:', err);
      }
      // Após o download (bem-sucedido ou não), apaga o arquivo do servidor
      fs.unlinkSync(filePath);
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao gerar backup.', error: error.message });
  }
};


const restoreFromBackup = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Nenhum arquivo de backup foi enviado.' });
    }

    try {
        // Antes de restaurar, faz um backup de segurança automático
        console.log('Criando backup de segurança antes da restauração...');
        await systemService.backupDatabase();
        console.log('Backup de segurança criado com sucesso.');

        const result = await systemService.restoreDatabase(req.file.path);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro ao restaurar o backup.', error: error.message });
    }
};


module.exports = {
  downloadBackup,
  restoreFromBackup,
};