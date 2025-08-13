// src/config/mikrotik.js
const axios = require('axios');
const https = require('https');

/**
 * Cria uma instância do cliente Axios para se conectar a um MikroTik específico.
 * Esta função deve ser chamada SEMPRE que for interagir com um MikroTik,
 * passando as credenciais da empresa.
 * @param {object} company - O objeto da empresa contendo as credenciais do MikroTik.
 * @param {string} company.mikrotikIp - O IP do roteador.
 * @param {number} company.mikrotikApiPort - A porta da API REST (padrão 443).
 * @param {string} company.mikrotikApiUser - O usuário da API.
 * @param {string} company.mikrotikApiPass - A senha da API.
 * @returns uma instância do cliente Axios configurada.
 */
const createMikrotikClient = ({ mikrotikIp, mikrotikApiPort, mikrotikApiUser, mikrotikApiPass }) => {
  if (!mikrotikIp || !mikrotikApiUser || !mikrotikApiPass) {
    throw new Error('Credenciais da empresa para o MikroTik estão incompletas.');
  }

  const client = axios.create({
    baseURL: `https://${mikrotikIp}:${mikrotikApiPort || 443}/rest`,
    auth: {
      username: mikrotikApiUser,
      password: mikrotikApiPass,
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: false, // Permite certificados autoassinados
    }),
    timeout: 10000, // Timeout de 10 segundos
  });

  return client;
};

const collectUsageData = async (companyId) => {
  const company = await Company.findByPk(companyId);
  if (!company) throw new Error('Empresa não encontrada.');

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'collectUsageData';

  try {
    // 1. Pega TODOS os usuários do hotspot (para os dados históricos e mikrotikId)
    const allUsersResponse = await mikrotikClient.get('/ip/hotspot/user');
    const allUsersData = allUsersResponse.data;

    // 2. Pega todas as sessões ATIVAS do hotspot
    const activeSessionsResponse = await mikrotikClient.get('/ip/hotspot/active');
    const activeSessionsData = activeSessionsResponse.data;

    await ConnectionLog.create({ action, status: 'success', message: `Coletado dados de ${allUsersData.length} usuários e ${activeSessionsData.length} sessões ativas do MikroTik.`, responseTime: Date.now() - startTime, companyId });

    let updatedCount = 0;
    
    // Mapeia sessões ativas por username para facilitar a busca
    const activeSessionsMap = new Map();
    activeSessionsData.forEach(session => {
        // Usa o nome de usuário da sessão ativa
        if (session.user) {
            activeSessionsMap.set(session.user, {
                bytesIn: parseInt(session['bytes-in'], 10) || 0,
                bytesOut: parseInt(session['bytes-out'], 10) || 0,
            });
        }
    });

    for (const mikrotikUser of allUsersData) {
      const dbUser = await HotspotUser.findOne({ where: { mikrotikId: mikrotikUser['.id'], companyId } });
      if (!dbUser) continue;

      // Consumo histórico das sessões encerradas
      const historicalBytesIn = parseInt(mikrotikUser['bytes-in'], 10) || 0;
      const historicalBytesOut = parseInt(mikrotikUser['bytes-out'], 10) || 0;
      let totalBytesUsed = historicalBytesIn + historicalBytesOut;

      // Consumo da sessão ATIVA (se houver)
      const activeSessionData = activeSessionsMap.get(mikrotikUser.name);
      if (activeSessionData) {
        totalBytesUsed += activeSessionData.bytesIn + activeSessionData.bytesOut;
      }

      // Lógica de Desativação e Notificação (já existente, mas agora com o totalBytesUsed correto)
      const hadCredit = dbUser.creditsTotal > 0 && dbUser.creditsUsed < dbUser.creditsTotal;
      const creditExceeded = totalBytesUsed >= dbUser.creditsTotal && dbUser.creditsTotal > 0; // Se o total for 0, é ilimitado

      if (hadCredit && creditExceeded) {
        console.log(`Crédito excedido para ${dbUser.username}. Desativando no MikroTik...`);
        try {
          await mikrotikClient.post(`/ip/hotspot/user/${dbUser.mikrotikId}/disable`);
          await ConnectionLog.create({ action: 'disableUser', status: 'success', message: `Usuário ${dbUser.username} desativado por excesso de crédito.`, companyId });
          await dbUser.update({ status: 'expired' }); // Atualiza o status no nosso banco
          sendCreditExhaustedEmail({ ...dbUser.get({ plain: true }), creditsUsed: totalBytesUsed }, company);

        } catch(disableError) {
          console.error(`Falha ao tentar desativar o usuário ${dbUser.username} no MikroTik.`, disableError);
          await ConnectionLog.create({ action: 'disableUser', status: 'error', message: `Falha ao desativar usuário: ${disableError.message}`, companyId });
        }
      }
      
      const [affectedRows] = await HotspotUser.update(
        { creditsUsed: totalBytesUsed },
        { where: { id: dbUser.id } }
      );

      if (affectedRows > 0) updatedCount++;
    }

    return {
        totalUsersInMikrotik: allUsersData.length,
        syncedUsersInDB: updatedCount
    };
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({ action, status: 'error', message: errorMessage, responseTime: Date.now() - startTime, companyId });
    throw new Error(`Falha ao coletar dados de uso para a empresa ${companyId}: ${errorMessage}`);
  }
};

module.exports = { createMikrotikClient, collectUsageData };