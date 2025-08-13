// src/config/database.js
const { Sequelize } = require('sequelize');

// As variáveis de ambiente foram removidas para este teste.
// Os dados de conexão estão inseridos diretamente.

const sequelize = new Sequelize(
  'hotspotbd', // DB_NAME
  'hotspotbd', // DB_USER
  'hotspotbd', // DB_PASS
  {
    host: '69.62.99.122', // DB_HOST
    port: 5437,            // DB_PORT - Adicionado para garantir a porta correta
    dialect: 'postgres',
    
    // Desativando SSL conforme a URL de conexão da sua imagem (sslmode=disable)
    dialectOptions: {
      ssl: false 
    },

    logging: console.log, // Mostra as queries SQL no console para depuração
  }
);

module.exports = sequelize;