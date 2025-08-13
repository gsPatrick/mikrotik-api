// src/features/user/user.service.js
const { Op } = require('sequelize');
const { User, Company } = require('../../models');
const bcrypt = require('bcryptjs');

const findAllUsers = async (options) => {
  const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'DESC', ...filters } = options;

  const where = {};
  if (filters.name) where.name = { [Op.iLike]: `%${filters.name}%` };
  if (filters.email) where.email = { [Op.iLike]: `%${filters.email}%` };
  if (filters.role) where.role = filters.role;
  if (filters.status) where.status = filters.status;
  if (filters.companyId) where.companyId = filters.companyId;

  const offset = (page - 1) * limit;

  return await User.findAndCountAll({
    where,
    include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
    attributes: { exclude: ['password'] }, // Excluir senha da listagem
    limit,
    offset,
    order: [[sortBy, sortOrder]],
  });
};

const createUser = async (userData) => {
  // Criptografar a senha antes de criar o usuário
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(userData.password, salt);
  userData.password = hashedPassword;

  return await User.create(userData);
};

const findUserById = async (id) => {
  return await User.findByPk(id, {
    attributes: { exclude: ['password'] },
    include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
  });
};

const updateUser = async (id, userData) => {
  const user = await User.findByPk(id);
  if (!user) return null;

  // Se uma nova senha for fornecida, criptografá-la
  if (userData.password) {
    const salt = await bcrypt.genSalt(10);
    userData.password = await bcrypt.hash(userData.password, salt);
  }

  return await user.update(userData);
};

const deleteUser = async (id) => {
  const user = await User.findByPk(id);
  if (!user) return null;
  await user.destroy();
  return user;
};

module.exports = {
  findAllUsers,
  createUser,
  findUserById,
  updateUser,
  deleteUser,
};