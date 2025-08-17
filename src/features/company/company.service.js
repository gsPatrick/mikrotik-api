// src/features/company/company.service.js
const { Op } = require('sequelize');
const { Company, HotspotUser, ConnectionLog } = require('../../models');
const db = require('../../models');
const { createMikrotikClient } = require('../../config/mikrotik');
const { writeSyncLog } = require('../../services/syncLog.service');
const { createActivityLog } = require('../activity/activity.service');
const mikrotikService = require('../mikrotik/mikrotik.service');

const findAllCompanies = async (options) => {
  const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC', ...filters } = options;
  const where = {};
  if (filters.name) where.name = { [Op.iLike]: `%${filters.name}%` };
  if (filters.status) where.status = filters.status;
  const offset = (page - 1) * limit;
  return await Company.findAndCountAll({ where, limit, offset, order: [[sortBy, sortOrder]], });
};

const findCompanyById = async (id) => {
  return await Company.findByPk(id);
};

const createCompany = async (companyData, userId) => {
  const company = await Company.create(companyData);
  await createActivityLog({
    userId: userId,
    type: 'company',
    description: `Empresa '${company.name}' foi criada.`,
  });
  try {
    await module.exports.testCompanyConnection(company.id);
    await company.update({ status: 'online' });
  } catch (error) {
    await company.update({ status: 'offline' });
    console.warn(`[Status Sync] Falha ao conectar com a nova empresa '${company.name}'. Status: offline. Erro: ${error.message}`);
  }
  return company;
};

const updateCompany = async (id, companyData, userId) => {
  const company = await module.exports.findCompanyById(id);
  if (!company) return null;
  const updatedCompany = await company.update(companyData);
  await createActivityLog({
    userId: userId,
    type: 'company',
    description: `Empresa '${updatedCompany.name}' foi atualizada.`,
  });
  return updatedCompany;
};

const deleteCompany = async (id, userId) => {
  const company = await module.exports.findCompanyById(id);
  if (!company) return null;
  await company.destroy();
  await createActivityLog({
    userId: userId,
    type: 'company',
    description: `Empresa '${company.name}' foi deletada.`,
  });
  return company;
};

const testCompanyConnection = async (id) => {
  const company = await module.exports.findCompanyById(id);
  if (!company) throw new Error('Empresa não encontrada.');
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'testConnection';
  try {
    await mikrotikClient.get('/system/identity');
    await ConnectionLog.create({ action, status: 'success', message: 'Teste de conexão bem-sucedido.', responseTime: Date.now() - startTime, companyId: id, });
    return { success: true, message: 'Conexão com o MikroTik bem-sucedida!' };
  } catch (error) {
    let friendlyMessage = 'Erro desconhecido.';
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') { friendlyMessage = 'Não foi possível resolver o IP ou a porta está sendo recusada.'; }
    else if (error.response?.status === 401) { friendlyMessage = 'Credenciais inválidas.'; }
    else { friendlyMessage = error.response?.data?.message || error.message; }
    await ConnectionLog.create({ action, status: 'error', message: friendlyMessage, responseTime: Date.now() - startTime, companyId: id, });
    throw new Error(friendlyMessage);
  }
};

const setCompanyActiveTurma = async (companyId, newActiveTurma, userId) => {
  const company = await module.exports.findCompanyById(companyId);
  if (!company) throw new Error('Empresa não encontrada.');
  const oldActiveTurma = company.activeTurma;
  if (oldActiveTurma === newActiveTurma) return company;
  await company.update({ activeTurma: newActiveTurma });
  await createActivityLog({
    userId: userId,
    type: 'company',
    description: `Turma ativa da empresa '${company.name}' alterada de '${oldActiveTurma}' para '${newActiveTurma}'.`,
  });
  await module.exports.syncHotspotUserStatusByTurma(companyId, newActiveTurma);
  return company;
};

const syncHotspotUserStatusByTurma = async (companyId, activeTurma) => {
    const company = await module.exports.findCompanyById(companyId);
    if (!company) throw new Error('Empresa não encontrada.');
    const mikrotikClient = createMikrotikClient(company);
    const hotspotUsersInSystem = await db.HotspotUser.findAll({ where: { companyId } });
    for (const user of hotspotUsersInSystem) {
        if (!user.mikrotikId) continue;
        const userTurma = user.turma || 'Nenhuma';
        const shouldBeActive = activeTurma === 'Nenhuma' || userTurma === activeTurma;
        if (shouldBeActive) {
            if (user.status !== 'active') {
                await mikrotikClient.patch(`/ip/hotspot/user/${user.mikrotikId}`, { disabled: 'false' }, { headers: { 'Content-Type': 'application/json' } });
                await user.update({ status: 'active' });
            }
        } else {
            if (user.status === 'active') {
                await mikrotikClient.patch(`/ip/hotspot/user/${user.mikrotikId}`, { disabled: 'true' }, { headers: { 'Content-Type': 'application/json' } });
                await user.update({ status: 'inactive' });
            }
        }
    }
};

const syncAllDataForCompany = async (companyId) => {
    console.log(`[Sync Service] Orquestrando sincronização para a empresa ID: ${companyId}`);
    const profilesResult = await mikrotikService.importProfilesFromMikrotik(companyId);
    const usersResult = await mikrotikService.importUsersFromMikrotik(companyId);
    return { profilesResult, usersResult };
};

module.exports = {
  findAllCompanies,
  findCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  testCompanyConnection,
  setCompanyActiveTurma,
  syncHotspotUserStatusByTurma,
  syncAllDataForCompany,
};
