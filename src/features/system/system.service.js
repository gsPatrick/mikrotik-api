// src/features/system/system.service.js
const shell = require('shelljs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const backupDatabase = async () => {
  // Verifica se pg_dump está disponível no sistema
  if (!shell.which('pg_dump')) {
    throw new Error('Comando "pg_dump" não encontrado. Certifique-se de que o PostgreSQL client tools está instalado e no PATH do sistema.');
  }

  const { DB_USER, DB_HOST, DB_NAME, DB_PASS } = process.env;
  const backupDir = path.join(__dirname, '../../../backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `backup-${DB_NAME}-${timestamp}.sql`;
  const backupFilePath = path.join(backupDir, backupFileName);

  // Cria o diretório de backups se ele não existir
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  // Define a variável de ambiente para a senha para que não apareça no comando
  shell.env['PGPASSWORD'] = DB_PASS;
  
  const command = `pg_dump -U ${DB_USER} -h ${DB_HOST} -d ${DB_NAME} -F c -b -v -f "${backupFilePath}"`;
  
  console.log('Executando comando de backup...');
  const result = shell.exec(command, { silent: true });
  
  // Limpa a variável de ambiente após o uso
  delete shell.env['PGPASSWORD'];
  
  if (result.code !== 0) {
    console.error('Erro no pg_dump:', result.stderr);
    throw new Error(`Falha ao gerar o backup. Erro: ${result.stderr}`);
  }

  return { filePath: backupFilePath, fileName: backupFileName };
};


const restoreDatabase = async (filePath) => {
    if (!shell.which('pg_restore')) {
        throw new Error('Comando "pg_restore" não encontrado. Certifique-se de que o PostgreSQL client tools está instalado e no PATH do sistema.');
    }

    const { DB_USER, DB_HOST, DB_NAME, DB_PASS } = process.env;
    shell.env['PGPASSWORD'] = DB_PASS;

    // O comando --clean primeiro apaga os objetos do banco antes de recriá-los
    const command = `pg_restore -U ${DB_USER} -h ${DB_HOST} -d ${DB_NAME} --clean --if-exists -v "${filePath}"`;

    console.log('Executando comando de restauração...');
    const result = shell.exec(command, { silent: true });

    delete shell.env['PGPASSWORD'];

    if (result.code !== 0) {
        console.error('Erro no pg_restore:', result.stderr);
        // Remove o arquivo de upload para não deixar lixo
        fs.unlinkSync(filePath);
        throw new Error(`Falha ao restaurar o backup. Erro: ${result.stderr}`);
    }

    // Remove o arquivo de upload após o sucesso
    fs.unlinkSync(filePath);

    return { success: true, message: 'Banco de dados restaurado com sucesso a partir do backup.' };
};


module.exports = {
  backupDatabase,
  restoreDatabase,
};
