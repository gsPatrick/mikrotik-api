// src/models/index.js
const sequelize = require('../config/database');
const Company = require('./Company');
const User = require('./User');
const Profile = require('./Profile');
const HotspotUser = require('./HotspotUser');
const ConnectionLog = require('./ConnectionLog');
const Settings = require('./Settings'); // <-- Adicionado
const ActivityLog = require('./ActivityLog'); // <-- Adicionar
const Notification = require('./Notification');

const db = {
  sequelize,
  Company,
  User,
  Profile,
  HotspotUser,
  ConnectionLog,
  Settings, // <-- Adicionado
    ActivityLog, 
    Notification// <-- Adicionar

};

// --- DEFINIÇÃO DAS RELAÇÕES ---

User.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Company.hasMany(User, { foreignKey: 'companyId', as: 'users' });

Profile.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Company.hasMany(Profile, { foreignKey: 'companyId', as: 'profiles' });

HotspotUser.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Company.hasMany(HotspotUser, { foreignKey: 'companyId', as: 'hotspotUsers' });

HotspotUser.belongsTo(Profile, { foreignKey: 'profileId', as: 'profile' });
Profile.hasMany(HotspotUser, { foreignKey: 'profileId', as: 'hotspotUsers' });

ConnectionLog.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });
Company.hasMany(ConnectionLog, { 
  foreignKey: 'companyId', 
  as: 'logs', 
  onDelete: 'CASCADE' // <-- ADICIONADO
});

Notification.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });

// Um Log de Atividade é realizado por um Usuário
ActivityLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(ActivityLog, { foreignKey: 'userId', as: 'activities' });

// O model Settings não precisa de relações diretas com outros models.

module.exports = db;