// src/features/reports/reports.service.js
const { Company, HotspotUser, Profile } = require('../../models'); // Só precisamos de Company e HotspotUser
const { Op } = require('sequelize');

const getMainDashboardStats = async () => {
  try {
    // Total de Hotspot Users
    const totalHotspotUsers = await HotspotUser.count();

    // Empresas Online vs. Total de Empresas
    const totalCompanies = await Company.count();
    const onlineCompanies = await Company.count({ where: { status: 'online' } });

    // Total de Perfis
    const totalProfiles = await Profile.count();

    // Créditos Usados (GB)
    // Soma todos os 'creditsUsed' de todos os HotspotUsers.
    // O tipo BIGINT no Sequelize precisa ser tratado como string no retorno do raw query
    // e convertido para número para operações. Aqui, já é um número (BIGINT) no JS.
    const totalCreditsUsedBytes = await HotspotUser.sum('creditsUsed', {
      where: {
        creditsUsed: { // Apenas soma onde creditsUsed é maior que 0 para evitar null/undefined
          [Op.gt]: 0
        }
      }
    }) || 0; // Se não houver nenhum crédito usado, retorna 0.

    const totalCreditsUsedGB = totalCreditsUsedBytes / (1024 * 1024 * 1024); // Converte para GB

    return {
      totalHotspotUsers,
      totalCompanies,
      onlineCompanies,
      totalProfiles,
      totalCreditsUsed: totalCreditsUsedGB,
    };
  } catch (error) {
    console.error('Erro ao buscar estatísticas do dashboard:', error);
    throw new Error('Falha ao gerar estatísticas do dashboard.');
  }
};
const getUsageReport = async (filters) => {
  // Filtro base para o período de datas (aplicado no backend para desempenho)
  const whereClause = {};
  if (filters.startDate && filters.endDate) {
    const start = new Date(filters.startDate);
    const end = new Date(filters.endDate);
    end.setHours(23, 59, 59, 999); // Garante que a data final inclua o dia inteiro
    whereClause.createdAt = {
      [Op.between]: [start, end],
    };
  }

  // Busca todos os HotspotUsers dentro do período de datas, com os dados da empresa associada.
  // O frontend será responsável pela agregação e filtros adicionais para cada gráfico.
  const allHotspotUsageData = await HotspotUser.findAll({
    where: whereClause, // Aplica apenas o filtro de período aqui
    include: [
      { model: Company, as: 'company', attributes: ['id', 'name'] }, // Inclui nome da empresa
      // { model: Profile, as: 'profile', attributes: ['id', 'name'] } // Pode incluir Profile se precisar do nome do perfil para os gráficos
    ],
    attributes: [
      'id', 'username', 'creditsUsed', 'creditsTotal', 'turma', 'companyId', 'createdAt'
    ],
    raw: true, // Retorna dados brutos para facilitar o processamento no frontend
  });

  return { allHotspotUsageData };
};

module.exports = {
  getMainDashboardStats,
  getUsageReport,
};