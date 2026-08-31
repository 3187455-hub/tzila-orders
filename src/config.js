require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,

  yemot: {
    sharedSecret: process.env.YEMOT_SHARED_SECRET || '',
    apiToken: process.env.YEMOT_API_TOKEN || '',
    tokensFilePath: process.env.YEMOT_TOKENS_FILE_PATH || '',
  },

  nedarimPlus: {
    terminalNumber: process.env.NEDARIM_PLUS_TERMINAL_NUMBER || '',
    apiValid: process.env.NEDARIM_PLUS_API_VALID || '',
    category: process.env.NEDARIM_PLUS_CATEGORY || '',
    apiPassword: process.env.NEDARIM_PLUS_API_PASSWORD || '',
  },

  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || '',
  },

  sessionSecret: process.env.SESSION_SECRET || 'insecure-dev-secret',

  defaultBedPrice: 50,
};
