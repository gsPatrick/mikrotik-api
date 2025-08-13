// src/app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mainRouter = require('./routes');
const db = require('./models');
const { initScheduler } = require('./scheduler');
const bcrypt = require('bcryptjs'); // <-- IMPORTAR BCRYPTJS

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', mainRouter);

app.get('/', (req, res) => {
  res.send('Hotspot Manager API está no ar!');
});

const PORT = process.env.API_PORT || 3010;

// <-- INÍCIO DA NOVA FUNÇÃO DE SEEDING -->
const createDefaultAdmin = async () => {
  try {
    const { User } = db;
    // 1. Verifica se já existe algum usuário no banco
    const userCount = await User.count();

    // 2. Se não houver nenhum usuário, cria o administrador padrão
    if (userCount === 0) {
      console.log('Nenhum usuário encontrado. Criando administrador padrão...');
      
      // Criptografa a senha
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin', salt);

      await User.create({
        name: 'Admin',
        email: 'admin@admin.com',
        password: hashedPassword,
        role: 'admin',
        status: 'active',
      });
      console.log('✅ Usuário administrador padrão criado com sucesso!');
      console.log('Login: admin@admin.com | Senha: admin');
    }
  } catch (error) {
    console.error('❌ Falha ao criar o usuário administrador padrão:', error);
  }
};
// <-- FIM DA NOVA FUNÇÃO DE SEEDING -->


const startServer = async () => {
  try {
    await db.sequelize.authenticate();
    console.log('✅ Conexão com o banco de dados estabelecida com sucesso.');

    await db.sequelize.sync({ alter: true });
    console.log('🔄 Models sincronizados com o banco de dados.');

    // <-- CHAMA A FUNÇÃO DE SEEDING AQUI -->
    await createDefaultAdmin();

    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando na porta ${PORT}`);
      initScheduler();
      console.log('✅ API, Banco de Dados e Agendador prontos!');
    });
  } catch (error) {
    console.error('❌ Não foi possível iniciar o servidor:', error);
  }
};

startServer();