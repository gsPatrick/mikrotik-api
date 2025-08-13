// src/features/health/health.controller.js
const { createMikrotikClient } = require('../../config/mikrotik'); // Importa a função
// Não precisamos mais do Company model para este teste de saúde específico
// const { Company } = require('../../models'); 

const testMikrotikConnection = async (req, res) => {
  console.log('Recebida requisição para testar conexão com o MikroTik (via .env)...');
  
  // 1. Obter as credenciais do MikroTik das variáveis de ambiente
  const mikrotikConfig = {
    mikrotikIp: process.env.MIKROTIK_HOST,
    mikrotikApiPort: parseInt(process.env.MIKROTIK_PORT || '443', 10), // Garante que a porta seja um número, com fallback para 443
    mikrotikApiUser: process.env.MIKROTIK_USER,
    mikrotikApiPass: process.env.MIKROTIK_PASS,
  };

  // 2. Validar se as variáveis de ambiente foram fornecidas
  if (!mikrotikConfig.mikrotikIp || !mikrotikConfig.mikrotikApiUser || !mikrotikConfig.mikrotikApiPass) {
    return res.status(400).json({
      success: false,
      message: 'Variáveis de ambiente do MikroTik (.env) incompletas (MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASS são obrigatórias).',
    });
  }

  try {
    // 3. Criar uma instância do cliente Axios usando as credenciais das variáveis de ambiente
    const mikrotikClientInstance = createMikrotikClient(mikrotikConfig);
    
    // 4. Faz uma chamada simples para o endpoint de recursos do sistema usando a instância criada
    const response = await mikrotikClientInstance.get('/system/resource'); 
    
    console.log(`Conexão com MikroTik (via .env: ${mikrotikConfig.mikrotikIp}:${mikrotikConfig.mikrotikApiPort}) bem-sucedida!`);
    
    res.status(200).json({
      success: true,
      message: `Conexão com a API do MikroTik (${mikrotikConfig.mikrotikIp}) estabelecida com sucesso!`,
      data: response.data,
    });

  } catch (error) {
    console.error('Falha ao conectar com o MikroTik (via .env):', error.message);
    
    let friendlyMessage = `Falha ao conectar com a API do MikroTik configurada no .env (${mikrotikConfig.mikrotikIp}:${mikrotikConfig.mikrotikApiPort}).`;

    if (error.response) {
        // Erro de resposta HTTP do MikroTik (ex: 401 Unauthorized)
        friendlyMessage += ` Status: ${error.response.status}. Detalhes: ${error.response.data?.message || error.response.statusText}`;
    } else if (error.code === 'ENOTFOUND') {
        // Erro de DNS ou IP incorreto
        friendlyMessage += ' Host não encontrado. Verifique o MIKROTIK_HOST no seu arquivo .env.';
    } else if (error.code === 'ECONNREFUSED') {
        // Conexão recusada pela porta ou firewall
        friendlyMessage += ' Conexão recusada. Verifique se a API está ativa na porta correta (MIKROTIK_PORT) e se não há firewall bloqueando.';
    } else if (error.message.includes('Credenciais da empresa para o MikroTik estão incompletas')) {
        // Este erro viria da createMikrotikClient se as variáveis de ambiente fossem vazias
        friendlyMessage = error.message; 
    } else {
        // Outros erros
        friendlyMessage += ` Erro: ${error.message}`;
    }

    res.status(500).json({
      success: false,
      message: friendlyMessage,
      error: error.message,
    });
  }
};

module.exports = {
  testMikrotikConnection,
};