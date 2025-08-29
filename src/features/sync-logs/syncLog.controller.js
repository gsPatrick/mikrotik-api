// src/features/sync-logs/syncLog.controller.js
const { getSyncLogContent } = require('../../services/syncLog.service');

const getSyncLog = (req, res) => {
  try {
    const logContent = getSyncLogContent();
    res.status(200).send(logContent); // Envia o conteúdo do arquivo TXT
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro ao buscar log de sincronização.', error: error.message });
  }
};

module.exports = { getSyncLog };