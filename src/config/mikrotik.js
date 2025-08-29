// src/config/mikrotik.js
const axios = require('axios');
const https = require('https' );

/**
 * Cria uma instância do cliente Axios para se conectar a um MikroTik específico.
 * @param {object} company - O objeto da empresa contendo as credenciais do MikroTik.
 * @returns uma instância do cliente Axios configurada.
 */
const createMikrotikClient = ({ mikrotikIp, mikrotikApiPort, mikrotikApiUser, mikrotikApiPass }) => {
  if (!mikrotikIp || !mikrotikApiUser || !mikrotikApiPass) {
    throw new Error('Credenciais da empresa para o MikroTik estão incompletas.');
  }

  const client = axios.create({
    // --- CORREÇÃO 1: Protocolo e Porta ---
    // Usa HTTPS por padrão, que é o correto para a API REST do MikroTik.
    baseURL: `https://${mikrotikIp}:${mikrotikApiPort || 443}/rest`,
    auth: {
      username: mikrotikApiUser,
      password: mikrotikApiPass,
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: false, // Permite certificados autoassinados, comum em MikroTiks.
    } ),
    timeout: 10000, // Timeout de 10 segundos para evitar que a aplicação fique presa.
    
    // --- CORREÇÃO 2 (A MAIS IMPORTANTE) ---
    // Define um cabeçalho padrão que não entra em conflito com a API do MikroTik.
    // Isso evita que o axios envie 'application/json' por padrão em requisições POST
    // e corrige o erro "Unsupported Media Type".
    headers: {
      'Content-Type': 'application/octet-stream',
    }
  });

  return client;
};

// A função 'collectUsageData' foi removida daqui, pois ela pertence ao mikrotik.service.js
module.exports = { createMikrotikClient };
