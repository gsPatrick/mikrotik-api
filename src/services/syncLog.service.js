// src/services/syncLog.service.js
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../../sync_logs/sync_report.txt'); // Caminho para o arquivo de log
const LOG_DIR = path.join(__dirname, '../../../sync_logs'); // Diretório do log

// Garante que o diretório de logs existe
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const writeSyncLog = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${message}\n`;
  fs.appendFileSync(LOG_FILE, logMessage); // Adiciona a mensagem ao final do arquivo
};

const getSyncLogContent = () => {
  if (fs.existsSync(LOG_FILE)) {
    return fs.readFileSync(LOG_FILE, 'utf8');
  }
  return 'Nenhum log de sincronização encontrado ainda.';
};

module.exports = {
  writeSyncLog,
  getSyncLogContent,
};