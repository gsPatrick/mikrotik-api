// src/features/profile/profile.service.js
const { Op } = require('sequelize');
const { Profile, Company, ConnectionLog } = require('../../models');
const { createMikrotikClient } = require('../../config/mikrotik'); // <-- IMPORTA A FUNÇÃO CORRETAMENTE
const findAllProfiles = async (options) => {
  const { page = 1, limit = 10, sortBy = 'name', sortOrder = 'ASC', ...filters } = options;

  const where = {};
  if (filters.name) {
    where.name = { [Op.iLike]: `%${filters.name}%` };
  }
  if (filters.companyId) {
    where.companyId = filters.companyId;
  }

  const offset = (page - 1) * limit;

  return await Profile.findAndCountAll({
    where,
    include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
    limit,
    offset,
    order: [[sortBy, sortOrder]],
  });
};

const createProfile = async (profileData) => {
  const company = await Company.findByPk(profileData.companyId);
  if (!company) {
    throw new Error('Empresa especificada não foi encontrada.');
  }

  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'createProfile_Mikrotik';

  try {
    // 1. Tenta criar o perfil de usuário do hotspot no MikroTik
    await mikrotikClient.put('/ip/hotspot/user/profile', {
      name: profileData.mikrotikName,
      rate_limit: profileData.rateLimit, // Corrigido para "rate_limit" que a API espera
      session_timeout: profileData.sessionTimeout, // Corrigido para "session_timeout"
    });

    await ConnectionLog.create({
      action,
      status: 'success',
      message: `Perfil ${profileData.mikrotikName} criado com sucesso no MikroTik da empresa ${company.name}.`,
      responseTime: Date.now() - startTime,
      companyId: company.id,
    });

    // 2. Se for bem-sucedido, cria no nosso banco de dados
    return await Profile.create(profileData);

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({
      action,
      status: 'error',
      message: `Falha ao criar perfil no MikroTik: ${errorMessage}`,
      responseTime: Date.now() - startTime,
      companyId: company.id,
    });
    // Lança um erro para que o controller possa capturá-lo
    throw new Error(`Falha ao criar perfil no MikroTik: ${errorMessage}`);
  }
};

const findProfileById = async (id) => {
  return await Profile.findByPk(id, {
    include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
  });
};

const updateProfile = async (id, profileData) => {
  const profile = await findProfileById(id);
  if (!profile) return null;

  const company = await Company.findByPk(profile.companyId);
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'updateProfile_Mikrotik';
  
  try {
    // Monta o payload apenas com os campos que podem ser alterados
    const payload = {
        rate_limit: profileData.rateLimit,
        session_timeout: profileData.sessionTimeout,
    };
    
    // Atualiza o perfil no MikroTik usando o nome do perfil no MikroTik (mikrotikName)
    await mikrotikClient.patch(`/ip/hotspot/user/profile/${profile.mikrotikName}`, payload);
    
    await ConnectionLog.create({
      action, status: 'success',
      message: `Perfil ${profile.mikrotikName} atualizado no MikroTik.`,
      responseTime: Date.now() - startTime, companyId: company.id
    });

    // Atualiza no nosso banco de dados
    return await profile.update(profileData);

  } catch(error) {
    const errorMessage = error.response?.data?.message || error.message;
    await ConnectionLog.create({ action, status: 'error', message: `Falha ao atualizar perfil no MikroTik: ${errorMessage}`, responseTime: Date.now() - startTime, companyId: company.id });
    throw new Error(`Falha ao atualizar perfil no MikroTik: ${errorMessage}`);
  }
};

const deleteProfile = async (id) => {
  const profile = await findProfileById(id);
  if (!profile) return null;

  const company = await Company.findByPk(profile.companyId);
  const mikrotikClient = createMikrotikClient(company);
  const startTime = Date.now();
  const action = 'deleteProfile_Mikrotik';

  try {
    // Tenta deletar do MikroTik.
    await mikrotikClient.delete(`/ip/hotspot/user/profile/${profile.mikrotikName}`);
    
    await ConnectionLog.create({
      action, status: 'success',
      message: `Perfil ${profile.mikrotikName} deletado do MikroTik.`,
      responseTime: Date.now() - startTime, companyId: company.id
    });

  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    // Se o perfil não existe mais lá, consideramos sucesso e apenas removemos do nosso banco
    if (errorMessage.includes('no such item')) {
      await ConnectionLog.create({ action, status: 'success', message: `Perfil ${profile.mikrotikName} já não existia no MikroTik.`, responseTime: Date.now() - startTime, companyId: company.id });
    } else {
      await ConnectionLog.create({ action, status: 'error', message: `Falha ao deletar perfil no MikroTik: ${errorMessage}`, responseTime: Date.now() - startTime, companyId: company.id });
      throw new Error(`Falha ao deletar perfil no MikroTik: ${errorMessage}`);
    }
  }

  await profile.destroy();
  return profile;
};


module.exports = {
  findAllProfiles,
  createProfile,
  findProfileById,
  updateProfile,
  deleteProfile,
};